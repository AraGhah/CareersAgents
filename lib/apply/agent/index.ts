// The AI form agent (ApplyPilot's idea: an LLM drives the browser through any form), for the portals the desk's own
// reader cannot take: Workday's and SuccessFactors' wizards, "first step" portals, forms built from custom widgets.
// Claude sees a numbered list of the page's controls (snapshot.ts) and the candidate's facts (facts.ts), and acts through
// a few tools. The desk's rules hold here as everywhere:
//   - it types only facts it was given; a required question it has no fact for stops the run (ask_person)
//   - it never presses a final Submit: `finish` hands back to the runner, whose preflight and lib/apply/submit.ts decide
//   - it never types a password, never touches a CAPTCHA, never leaves for this machine's network (net-guard)
//   - it uploads only the CV and letter the desk stored (safeDeskPath)
// Every value it writes is recorded as a portal field with the fact it came from.

import Anthropic from "@anthropic-ai/sdk";
import type { BrowserContext, Locator, Page } from "playwright";
import { createMessage, pickModel, tokenLimit } from "../../claude";
import { safeDeskPath } from "../../safe-path";
import { answerQuestion, type AnswerContext } from "../answers/engine";
import { blockingFailures, type LintCheck } from "../answers/humanize";
import { ensureEvalShim } from "../browser/shim";
import type { CandidateProfile } from "../candidate";
import type { RememberedAnswer } from "../memory";
import { matchOption } from "../options";
import { cleanLabel, fieldSignature, norm } from "../text";
import type { FieldDecision, FieldIntent, FieldKind, FieldSource } from "../types";
import { factsFor, type AgentJob } from "./facts";
import { renderSnapshot, takeSnapshot } from "./snapshot";

export type AgentInput = {
  page: Page;
  candidate: CandidateProfile;
  job: AgentJob;
  /** The CV chosen for this role; the cover letter is built the first time a form asks for one. */
  files: { resumePath: string | null; coverLetter: () => Promise<string | null> };
  answers: AnswerContext;
  autoApprove: boolean;
  autoConfirm: boolean;
  memory: Map<string, RememberedAnswer>;
  log: (line: string) => void;
  /** Injected in tests; the Anthropic client otherwise. */
  client?: Pick<Anthropic, "messages">;
  maxActions?: number;
};

export type AgentOutcome = {
  /** ready: every page filled, the final Submit is in view. needs_person: a question or a step only a person can take. */
  state: "ready" | "needs_person" | "failed";
  reason: string;
  decisions: FieldDecision[];
  actions: number;
  page: Page;
  /** The CV was attached somewhere in the form. */
  resumeAttached: boolean;
};

/** Enabled with an API key unless PORTAL_AI_AGENT=false. */
export function agentEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim() && process.env.PORTAL_AI_AGENT?.trim().toLowerCase() !== "false";
}

/** The final Submit and its translations: never the agent's to press (after norm()). */
const FINAL_SUBMIT =
  /^(submit|submit (my |your )?application|send( my)? application|send|finish|finish application|complete( (my )?application)?|soumettre|soumettre (ma )?candidature|envoyer|envoyer (ma )?candidature|terminer|confirmer (ma )?candidature)$/;
/** Words that open a form from a posting page: fine to press there, a final Submit on a filled form. */
const APPLY_WORDS = /^(apply|apply now|apply online|postuler|postuler maintenant)$/;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "fill_text",
    description: "Type a value into a text box (input or textarea). Replaces what is there.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        text: { type: "string" },
        fact: { type: "string", description: "Which fact the value comes from, e.g. 'phone', 'answer bank \"links\"', 'earlier form answer'." },
      },
      required: ["id", "text", "fact"],
    },
  },
  {
    name: "choose",
    description:
      "Pick an option: in a <select>, a combobox / dropdown / prompt list (it is opened, searched and the option clicked), a radio button, or a button-style choice. Give the option's text as shown.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" }, option: { type: "string" }, fact: { type: "string" } },
      required: ["id", "option", "fact"],
    },
  },
  {
    name: "set_checked",
    description: "Tick or untick a checkbox / switch.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" }, checked: { type: "boolean" }, fact: { type: "string" } },
      required: ["id", "checked", "fact"],
    },
  },
  {
    name: "click",
    description:
      "Press a button or link that moves the form along or opens a part of it: Apply (on the posting), Apply Manually, Next, Continue, Save and Continue, Add (another entry), a tab, a section. Never the final Submit: call finish instead.",
    input_schema: { type: "object", properties: { id: { type: "integer" }, why: { type: "string" } }, required: ["id", "why"] },
  },
  {
    name: "upload",
    description: "Attach the candidate's CV or cover letter to a file field (or to the button that opens the file picker).",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" }, document: { type: "string", enum: ["resume", "cover_letter"] } },
      required: ["id", "document"],
    },
  },
  {
    name: "write_answer",
    description:
      "For an open written question (why this company, about you, a project...): the desk writes a grounded answer from the candidate's material and types it into the field.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" }, question: { type: "string" }, max_words: { type: "integer" } },
      required: ["id", "question"],
    },
  },
  {
    name: "look",
    description: "Get a screenshot of the visible page, for a widget the control list does not make clear.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "ask_person",
    description:
      "Stop: a required question has no fact to answer it, a sign-in or CAPTCHA appeared, or the form asks for something only the candidate can decide. List the questions that need the candidate.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        questions: {
          type: "array",
          items: { type: "object", properties: { label: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["label"] },
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "finish",
    description: "Every page is filled and checked, and the page in front shows the final Submit button (do not press it).",
    input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
  },
];

function systemPrompt(facts: string, opts: { autoConfirm: boolean }): string {
  return [
    "You fill in a job application form in a web browser for the candidate, using only the facts below.",
    "Each turn you get the page as a numbered list of controls. Act with the tools; several tools per turn are fine on one page.",
    "",
    "RULES",
    "1. Type only what the facts say. Never invent a value, a date, an employer, a grade or an answer. Reuse an earlier form answer when the question is the same.",
    "2. A required question you have no fact for: call ask_person with that question. An optional one: leave it.",
    "3. Self-identification (gender, race, disability, veteran, orientation): leave blank if optional; if required, the 'decline to answer' option.",
    opts.autoConfirm
      ? "4. A required box consenting to the processing of this application (privacy notice, 'information is accurate') may be ticked. Never tick marketing, job alerts or anything beyond the application."
      : "4. Consent, terms, declarations and signatures are the candidate's: if one is required, ask_person. Never tick marketing or job alerts.",
    "5. Never press the final Submit / Send / Soumettre. When every page is complete and the final Submit is in view, call finish.",
    "6. A password field or a sign-in page: ask_person. Never type a password. A CAPTCHA: never touch it and keep filling the rest; the candidate solves it before Submit. Only when a CAPTCHA hides the whole form, ask_person.",
    "7. Upload the CV where a CV/resume is asked (document 'resume'); the cover letter only where a cover letter is asked.",
    "8. Workday: on 'Autofill with Resume / Apply Manually', choose Apply Manually. Add experience/education entries only from the facts. Save and Continue moves to the next page.",
    "9. After acting, check the next snapshot: a value that did not stick, or an error shown, is fixed before moving on.",
    "10. Written questions (why us, about you, a project, a challenge): use write_answer, not fill_text.",
    "",
    "FACTS",
    facts,
  ].join("\n");
}

type ActionResult = { text: string; image?: { data: string } };

const kindOf = (k: string): FieldKind =>
  (["text", "email", "tel", "url", "number", "textarea", "date", "month", "select", "combobox", "radio", "checkbox", "file"] as string[]).includes(k) ? (k as FieldKind) : "text";

export async function runFormAgent(input: AgentInput): Promise<AgentOutcome> {
  const log = input.log;
  const maxActions = input.maxActions ?? Number(process.env.PORTAL_AI_AGENT_MAX_ACTIONS ?? 90);
  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const pick = pickModel("hard", process.env.ANTHROPIC_AGENT_MODEL);
  let page = input.page;
  const context: BrowserContext = page.context();
  // A click that opens the form in a new tab: follow it.
  context.on("page", (p) => {
    page = p;
  });

  const decisions = new Map<string, FieldDecision>();
  let resumeAttached = false;
  let actions = 0;
  const facts = factsFor(input.candidate, input.job, input.memory, { autoConfirm: input.autoConfirm });
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: systemPrompt(facts, { autoConfirm: input.autoConfirm }), cache_control: { type: "ephemeral" } }];

  let snapshot = await takeSnapshot(page);
  const labels = () => new Map(snapshot.elements.map((e) => [e.id, e]));
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Apply to "${input.job.title}" at ${input.job.companyName}. The page now:\n\n${renderSnapshot(snapshot)}` },
  ];

  const record = (id: number, value: string, opts: { source: FieldSource; fact: string; intent?: FieldIntent; status?: FieldDecision["status"]; checks?: FieldDecision["checks"] }) => {
    const el = labels().get(id);
    const label = cleanLabel(el?.label ?? `control ${id}`);
    const kind = kindOf(el?.kind ?? "text");
    const signature = fieldSignature(label, kind, null);
    decisions.set(signature, {
      signature,
      label,
      kind,
      required: !!el?.required,
      options: el?.options ?? [],
      intent: opts.intent ?? "unknown",
      source: opts.source,
      value,
      status: opts.status ?? "filled",
      reason: `AI form agent, from: ${opts.fact}`,
      checks: opts.checks ?? [],
    });
  };
  const sourceOf = (fact: string): FieldSource => (/earlier form|remembered/i.test(fact) ? "user" : /cv|resume|experience|project/i.test(fact) ? "profile" : "bank");
  const target = (id: number): Locator => page.locator(`[data-desk-agent="${id}"]`).first();
  const settle = async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  };

  const act = async (name: string, a: Record<string, unknown>): Promise<ActionResult> => {
    const id = Number(a.id);
    const el = Number.isInteger(id) ? labels().get(id) : undefined;
    if (["fill_text", "choose", "set_checked", "click", "upload", "write_answer"].includes(name) && !el) return { text: `No control [${a.id}] on this page.` };
    const loc = Number.isInteger(id) ? target(id) : null;
    if (loc && (await loc.count().catch(() => 0)) === 0) return { text: `Control [${id}] is gone (the page changed): act on the new list.` };

    switch (name) {
      case "fill_text": {
        if (/password/i.test(el!.kind) || /password field/.test(el!.value)) return { text: "Refused: password fields are never typed by the agent." };
        const text = String(a.text ?? "");
        await loc!.scrollIntoViewIfNeeded().catch(() => undefined);
        // Workday redraws a field after it is typed in: the stamped node can be replaced by a new one with the same id,
        // so the value is read back from the field as it is now (by its id), after the redraw.
        const domId = await loc!.getAttribute("id").catch(() => null);
        await loc!.fill(text, { timeout: 8000 });
        await loc!.blur().catch(() => undefined);
        let back = await loc!.inputValue().catch(() => "");
        if (norm(back) !== norm(text) && domId) {
          await page.waitForTimeout(700);
          back = await page.locator(`[id="${domId.replace(/"/g, '\\"')}"]`).first().inputValue().catch(() => back);
        }
        const ok = norm(back) === norm(text);
        if (ok) record(id, text, { source: sourceOf(String(a.fact)), fact: String(a.fact) });
        return { text: ok ? `[${id}] now "${back.slice(0, 80)}".` : `[${id}] reads back "${back.slice(0, 80)}" instead.` };
      }
      case "choose": {
        const option = String(a.option ?? "");
        await loc!.scrollIntoViewIfNeeded().catch(() => undefined);
        const tag = await loc!.evaluate((n) => n.tagName).catch(() => "");
        if (tag === "SELECT") {
          const m = matchOption(option, el!.options ?? []);
          if (!m) return { text: `No option of [${id}] matches "${option}". Options: ${(el!.options ?? []).join(" | ")}` };
          await loc!.selectOption({ index: m.index }, { timeout: 8000 });
          record(id, m.option, { source: sourceOf(String(a.fact)), fact: String(a.fact) });
          return { text: `[${id}] set to "${m.option}".` };
        }
        if (["radio", "checkbox", "button", "option"].includes(el!.kind) || /yesno|toggle/.test(el!.label)) {
          await loc!.click({ timeout: 5000 }).catch(() => loc!.evaluate((n) => (n as HTMLElement).click()));
          record(id, option || el!.label, { source: sourceOf(String(a.fact)), fact: String(a.fact) });
          await settle();
          return { text: `Pressed [${id}] "${el!.label.slice(0, 60)}".` };
        }
        // A dropdown or search list: open it, type to filter when it is a text box, click the option.
        await loc!.click({ timeout: 5000 }).catch(() => loc!.evaluate((n) => (n as HTMLElement).click()));
        if (tag === "INPUT") {
          await loc!.fill(option.split(",")[0].trim()).catch(() => undefined);
          await page.keyboard.press("Enter").catch(() => undefined);
        }
        const list = page.locator("[role='option']:visible, [data-automation-id='promptOption']:visible, [role='listbox'] li:visible");
        await list.first().waitFor({ timeout: 5000 }).catch(() => undefined);
        const texts = (await list.allInnerTexts().catch(() => [] as string[])).map((t) => t.replace(/\s+/g, " ").trim());
        // A list often renders each option twice (a visible copy and an accessible one): one text is one option.
        const unique = [...new Set(texts.filter(Boolean))];
        const m = matchOption(option, unique) ?? matchOption(option.replace(/^[^\p{L}\d]+/u, ""), unique.map((t) => t.replace(/^[^\p{L}\d(]+/u, "").replace(/^\(\+\d+\)\s*/, "")));
        if (!m) {
          await page.keyboard.press("Escape").catch(() => undefined);
          return { text: `No listed option matches "${option}". Listed: ${unique.slice(0, 15).join(" | ") || "(none)"}` };
        }
        const at = texts.indexOf(unique[m.index]);
        await list.nth(at).click({ timeout: 5000 }).catch(() => list.nth(at).evaluate((n) => (n as HTMLElement).click()));
        await page.waitForTimeout(400);
        record(id, unique[m.index], { source: sourceOf(String(a.fact)), fact: String(a.fact) });
        return { text: `Chose "${unique[m.index]}" in [${id}].` };
      }
      case "set_checked": {
        const want = Boolean(a.checked);
        const isInput = await loc!.evaluate((n) => n.tagName === "INPUT").catch(() => false);
        if (isInput) {
          if (want) await loc!.check({ force: true });
          else await loc!.uncheck({ force: true });
        } else if ((el!.checked ?? false) !== want) {
          await loc!.click({ timeout: 5000 }).catch(() => loc!.evaluate((n) => (n as HTMLElement).click()));
        }
        record(id, want ? "Yes" : "No", { source: sourceOf(String(a.fact)), fact: String(a.fact), intent: /consent|privacy|terms|agree|accept/i.test(el!.label) ? "consent" : "unknown" });
        return { text: `[${id}] ${want ? "checked" : "unchecked"}.` };
      }
      case "click": {
        const info = await loc!
          .evaluate((n) => {
            const form = n.closest("form");
            const filled = form
              ? Array.from(form.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea")).filter((i) => !!(i as HTMLInputElement).value).length
              : 0;
            return {
              text: ((n as HTMLElement).innerText || (n as HTMLInputElement).value || n.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
              submitType: (n.getAttribute("type") ?? "").toLowerCase() === "submit",
              filled,
              automation: n.getAttribute("data-automation-id") ?? "",
            };
          })
          .catch(() => ({ text: "", submitType: false, filled: 0, automation: "" }));
        const t = norm(info.text);
        if (FINAL_SUBMIT.test(t) || (APPLY_WORDS.test(t) && info.submitType && info.filled > 1)) {
          return { text: `Refused: "${info.text}" is the final Submit. If the form is complete, call finish; the desk submits after its own checks.` };
        }
        await loc!.scrollIntoViewIfNeeded().catch(() => undefined);
        await loc!.click({ timeout: 6000 }).catch(() => loc!.evaluate((n) => (n as HTMLElement).click()));
        await settle();
        return { text: `Pressed "${info.text.slice(0, 60)}" (${String(a.why ?? "")}).` };
      }
      case "upload": {
        const which = a.document === "cover_letter" ? "cover_letter" : "resume";
        const file = safeDeskPath(which === "resume" ? input.files.resumePath : await input.files.coverLetter());
        if (!file) return { text: `No ${which === "resume" ? "CV" : "cover letter"} stored for this application: skip it if optional, else ask_person.` };
        const isFileInput = await loc!.evaluate((n) => n.tagName === "INPUT" && (n as HTMLInputElement).type === "file").catch(() => false);
        if (isFileInput) {
          await loc!.setInputFiles(file);
        } else {
          // The file box behind an "Upload" button: the nearest one in the same section, set directly.
          const near = loc!.locator("xpath=ancestor::*[.//input[@type='file']][1]//input[@type='file']").first();
          if ((await near.count().catch(() => 0)) > 0) {
            await near.setInputFiles(file);
          } else {
            // Otherwise the button opens the file picker; a DOM click reaches it when a layer covers the button.
            const chooser = page.waitForEvent("filechooser", { timeout: 8000 });
            await loc!.click({ timeout: 4000 }).catch(() => loc!.evaluate((n) => (n as HTMLElement).click()));
            await (await chooser).setFiles(file);
          }
        }
        await page.waitForTimeout(1500);
        if (which === "resume") resumeAttached = true;
        record(id, file, { source: "file", fact: which === "resume" ? "the CV chosen for this role" : "the cover letter for this application", intent: which === "resume" ? "resume" : "cover_letter_file" });
        return { text: `Attached the ${which === "resume" ? "CV" : "cover letter"} to [${id}].` };
      }
      case "write_answer": {
        const question = String(a.question ?? el!.label);
        const maxWords = Number(a.max_words) > 0 ? Number(a.max_words) : null;
        const field = {
          index: id,
          signature: fieldSignature(question, "textarea", null),
          label: question,
          kind: "textarea" as const,
          required: el!.required,
          options: [],
          name: null,
          placeholder: null,
          maxLength: null,
          rows: null,
          hint: maxWords ? `${maxWords} words max` : null,
          accept: null,
        };
        const drafted = await answerQuestion(field, input.answers);
        if (!drafted.value || drafted.status !== "generated") return { text: `No grounded answer could be written (${drafted.reason}). If required, ask_person.` };
        const passes = blockingFailures(drafted.checks as LintCheck[]).length === 0;
        await loc!.fill(drafted.value);
        const status = input.autoApprove && passes ? "approved" : "generated";
        const signature = fieldSignature(cleanLabel(el!.label), "textarea", null);
        decisions.set(signature, {
          signature,
          label: cleanLabel(el!.label),
          kind: "textarea",
          required: el!.required,
          options: [],
          intent: "open_question",
          source: "generated",
          value: drafted.value,
          status,
          reason: `${drafted.reason}${status === "generated" ? " Waits for your approval before any submit." : ""}`,
          checks: drafted.checks,
          questionType: drafted.questionType,
        });
        return { text: `Wrote an answer of ${drafted.value.split(/\s+/).length} words into [${id}].` };
      }
      case "look": {
        const shot = await page.screenshot({ type: "jpeg", quality: 50 });
        return { text: "Screenshot of the visible page:", image: { data: shot.toString("base64") } };
      }
      default:
        return { text: `Unknown tool ${name}.` };
    }
  };

  const keepRecent = () => {
    // Older page snapshots are dropped from the conversation (only the latest page matters), keeping the action lines.
    const userTurns = messages.filter((m) => m.role === "user");
    for (const m of userTurns.slice(0, -2)) {
      if (!Array.isArray(m.content)) continue;
      m.content = m.content.map((b) => {
        if (b.type !== "tool_result") return b;
        const text = (Array.isArray(b.content) ? b.content : [])
          .filter((c): c is Anthropic.TextBlockParam => c.type === "text")
          .map((c) => c.text.split("\n\nThe page now:")[0])
          .join(" ");
        return { ...b, content: [{ type: "text" as const, text: text || "(done)" }] };
      });
    }
  };

  try {
    for (let turn = 0; actions < maxActions; turn++) {
      keepRecent();
      const response = await createMessage(client as Anthropic, pick, {
        max_tokens: tokenLimit(2500, pick.tier),
        system,
        tools: TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });
      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) {
        const said = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
        return done("needs_person", `The agent stopped without finishing${said ? `: ${said.slice(0, 300)}` : "."}`);
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      let terminal: AgentOutcome | null = null;
      let moved = false;
      for (const use of uses) {
        const args = (use.input ?? {}) as Record<string, unknown>;
        if (terminal) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Skipped: the run already stopped." });
          continue;
        }
        // The numbers belong to the page before the click: anything after it waits for the new list.
        if (moved && use.name !== "ask_person") {
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Skipped: the page changed after the click; act on the new list." });
          continue;
        }
        if (use.name === "ask_person") {
          const qs = Array.isArray(args.questions) ? (args.questions as Array<{ label?: string; options?: string[] }>) : [];
          for (const q of qs) {
            if (!q.label) continue;
            const label = cleanLabel(q.label);
            const signature = fieldSignature(label, q.options?.length ? "radio" : "text", null);
            decisions.set(signature, {
              signature,
              label,
              kind: q.options?.length ? "radio" : "text",
              required: true,
              options: q.options ?? [],
              intent: "unknown",
              source: "none",
              value: null,
              status: "manual",
              reason: "The AI form agent has no fact for this: answer it once, it is remembered for the next forms.",
              checks: [],
            });
          }
          log(`agent asks for you: ${String(args.reason ?? "")}`);
          terminal = outcome("needs_person", String(args.reason ?? "The agent needs you."));
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Stopped for the candidate." });
          continue;
        }
        if (use.name === "finish") {
          log(`agent: form complete (${String(args.summary ?? "")})`);
          terminal = outcome("ready", String(args.summary ?? "Every page is filled."));
          results.push({ type: "tool_result", tool_use_id: use.id, content: "The desk takes over for its checks." });
          continue;
        }
        actions += 1;
        let result: ActionResult;
        try {
          result = await act(use.name, args);
        } catch (err) {
          result = { text: `Failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
        }
        log(`agent ${use.name} ${args.id ?? ""}: ${result.text.slice(0, 140)}`);
        if (use.name === "click") moved = true;
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result.image
            ? [{ type: "text", text: result.text }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: result.image.data } }]
            : [{ type: "text", text: result.text }],
        });
      }
      if (terminal) return terminal;

      // The page after this turn's actions, attached to the last result.
      await ensureEvalShim(page).catch(() => undefined);
      snapshot = await takeSnapshot(page);
      const last = results[results.length - 1];
      const content = Array.isArray(last.content) ? last.content : [{ type: "text" as const, text: String(last.content ?? "") }];
      last.content = [...content, { type: "text", text: `\n\nThe page now:\n${renderSnapshot(snapshot)}` }];
      messages.push({ role: "user", content: results });
    }
    return done("needs_person", `The agent used its ${maxActions} actions without reaching the final Submit.`);
  } catch (err) {
    return done("failed", `The AI form agent failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }

  function outcome(state: AgentOutcome["state"], reason: string): AgentOutcome {
    return { state, reason, decisions: [...decisions.values()], actions, page, resumeAttached };
  }
  function done(state: AgentOutcome["state"], reason: string): AgentOutcome {
    return outcome(state, reason);
  }
}
