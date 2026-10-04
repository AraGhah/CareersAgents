// Offline checks for the AI form agent (lib/apply/agent): a scripted stand-in for the model drives a two-page fixture
// wizard through the agent's real tools in a real browser. No API call. Run: npm run agent:check
//
// What must hold: values land in the custom widgets and are recorded with their fact; a password box is never typed into;
// the final Submit is refused (only lib/apply/submit.ts presses it); only a CV the desk stored is uploaded; `finish`
// hands back "ready"; `ask_person` stops with the questions recorded for the candidate.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";
import { runFormAgent, type AgentInput } from "../lib/apply/agent";
import { buildCandidateProfile } from "../lib/apply/candidate";
import type { Answer } from "../lib/types";

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${!ok && detail !== undefined ? `\n       ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  if (!ok) failures += 1;
}

function serve(dir: string): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const file = path.join(dir, path.basename(new URL(req.url ?? "/", "http://x").pathname));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await readFile(file));
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` });
    });
  });
}

const answer = (key: string, en: string): Answer => ({ id: key, key, category: "green", answer_en: en, answer_fr: en, updated_at: new Date() });

type Call = { name: string; input: Record<string, unknown> };
type Script = Array<(page: string) => Call[]>;

/** The model's stand-in: each turn reads the latest control list and answers with the scripted tool calls. */
function fakeModel(script: Script, seen: string[]) {
  let turn = 0;
  return {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        const last = params.messages[params.messages.length - 1];
        const text =
          typeof last.content === "string"
            ? last.content
            : last.content
                .flatMap((b) => (b.type === "tool_result" ? (Array.isArray(b.content) ? b.content : []) : b.type === "text" ? [b] : []))
                .map((b) => ("text" in b ? b.text : ""))
                .join("\n");
        seen.push(text);
        const calls = (script[turn] ?? (() => [{ name: "ask_person", input: { reason: "script ended" } }]))(text);
        turn += 1;
        return {
          id: `msg_${turn}`,
          type: "message",
          role: "assistant",
          model: "fake",
          content: calls.map((c, i) => ({ type: "tool_use", id: `tu_${turn}_${i}`, name: c.name, input: c.input })),
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as Anthropic.Message;
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
}

/** The id of the first control whose line matches. */
function idOf(page: string, re: RegExp): number {
  for (const line of page.split("\n")) {
    const m = line.match(/^\[(\d+)\] (.*)$/);
    if (m && re.test(m[2])) return Number(m[1]);
  }
  throw new Error(`no control matches ${re} in:\n${page.slice(0, 1500)}`);
}

async function main() {
  const dir = path.join("applications", "_agent-check");
  await mkdir(dir, { recursive: true });
  const cv = path.join(dir, "cv.pdf");
  await writeFile(cv, "%PDF-1.4\n% fixture\n");

  const candidate = buildCandidateProfile({
    lang: "en",
    answers: [answer("full_name", "Ara Ghahramanyan"), answer("email", "ara@example.com"), answer("city", "Montréal, QC")],
    projects: [],
    resume: null,
  });
  const { server, base } = await serve(path.join(process.cwd(), "scripts", "fixtures", "portal"));
  const browser = await chromium.launch({ headless: true });
  const lines: string[] = [];
  const input = (page: AgentInput["page"], client: AgentInput["client"], resumePath: string | null): AgentInput => ({
    page,
    candidate,
    job: { companyName: "Acme", title: "Software Developer Intern", location: "Montréal, QC", description: null },
    files: { resumePath, coverLetter: async () => null },
    answers: { candidate, companyName: "Acme", roleTitle: "Software Developer Intern", posting: null, companyNotes: [], corpus: { facts: [], text: "" } as never, samples: [], llm: null },
    autoApprove: false,
    autoConfirm: false,
    memory: new Map(),
    log: (l) => lines.push(l),
    client,
  });

  try {
    console.log("the agent fills a custom-widget wizard, and stops short of Submit");
    {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${base}/agent-wizard.html`);
      const seen: string[] = [];
      const script: Script = [
        (p) => [
          { name: "fill_text", input: { id: idOf(p, /"First Name/), text: "Ara", fact: "first name" } },
          { name: "fill_text", input: { id: idOf(p, /"Email Address/), text: "ara@example.com", fact: "email" } },
          { name: "fill_text", input: { id: idOf(p, /password/i), text: "hunter2", fact: "none" } },
          { name: "choose", input: { id: idOf(p, /combobox "Country/), option: "Canada", fact: "country" } },
          { name: "click", input: { id: idOf(p, /button "Next"/), why: "next page" } },
        ],
        (p) => [
          { name: "upload", input: { id: idOf(p, /file "Resume/), document: "resume" } },
          { name: "choose", input: { id: idOf(p, /radio "Are you legally authorized.* › Yes/), option: "Yes", fact: "work authorization" } },
          { name: "click", input: { id: idOf(p, /button "Submit"/), why: "submit the application" } },
        ],
        () => [{ name: "finish", input: { summary: "both pages filled" } }],
      ];
      const out = await runFormAgent(input(page, fakeModel(script, seen), cv));
      const final = out.page;
      const all = seen.join("\n");
      check(out.state === "ready", "finish hands back 'ready'", out);
      check((await final.evaluate(() => localStorage.getItem("submitted"))) === null, "the final Submit was never pressed");
      check(/Refused: "Submit" is the final Submit/.test(all), "pressing Submit is refused with the reason", all.slice(-600));
      check(/Refused: password fields are never typed/.test(all), "typing into a password box is refused");
      check((await final.locator("#pw").inputValue()) === "", "…and the password box stayed empty");
      check((await final.locator("#country").innerText()).trim() === "Canada", "a custom dropdown is opened and its option picked");
      check(out.resumeAttached && (await final.locator("#cv").evaluate((n) => (n as HTMLInputElement).files?.[0]?.name)) === "cv.pdf", "the stored CV is attached");
      const byLabel = (re: RegExp) => out.decisions.find((d) => re.test(d.label));
      check(byLabel(/First Name/)?.value === "Ara" && /first name/.test(byLabel(/First Name/)?.reason ?? ""), "each value is recorded with the fact it came from", out.decisions);
      check(byLabel(/Resume/)?.intent === "resume", "the CV upload is recorded as the resume (the preflight looks for it)");
      check(!out.decisions.some((d) => /password/i.test(d.label)), "nothing is recorded for the password box");
      await final.context().close();
    }

    console.log("\nonly a CV the desk stored is uploaded");
    {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${base}/agent-wizard.html`);
      await page.locator("button", { hasText: "Next" }).click();
      const seen: string[] = [];
      const script: Script = [(p) => [{ name: "upload", input: { id: idOf(p, /file "Resume/), document: "resume" } }], () => [{ name: "ask_person", input: { reason: "no CV" } }]];
      const out = await runFormAgent(input(page, fakeModel(script, seen), ".env.local"));
      check(/No CV stored/.test(seen.join("\n")) && !out.resumeAttached, "a path outside resumes/ and applications/ is not uploaded", seen.join("\n").slice(-400));
      check((await out.page.locator("#cv").evaluate((n) => (n as HTMLInputElement).files?.length ?? 0)) === 0, "…and the file box stays empty");
      await out.page.context().close();
    }

    console.log("\nask_person stops with the questions recorded for you");
    {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${base}/agent-wizard.html`);
      const script: Script = [
        () => [{ name: "ask_person", input: { reason: "notice period is not in the facts", questions: [{ label: "What is your notice period?", options: ["Immediately", "2 weeks"] }] } }],
      ];
      const out = await runFormAgent(input(page, fakeModel(script, []), cv));
      const q = out.decisions.find((d) => /notice period/i.test(d.label));
      check(out.state === "needs_person" && /notice period/.test(out.reason), "the run stops with the reason", out);
      check(q?.status === "manual" && q.options.join() === "Immediately,2 weeks", "the question waits for you on the application page (answered once, remembered)", q);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) {
    console.log(`\n${failures} agent check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nagent-check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
