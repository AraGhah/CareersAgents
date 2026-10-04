// One portal application, end to end:
//   duplicate check → channel (email / portal / manual) → CV → company notes →
//   open the form → guards (login wall, CAPTCHA) → read the fields → cover letter
//   → plan every field (deterministic values + written answers) → keep earlier
//   approvals → [plan mode stops here]
//   → fill + read back → re-scan for questions that appeared → on a multi-step
//   form, press Next once the page is complete and read, plan and fill the next
//   page, until the last one → preflight →
//   submit only when every gate passes and PORTAL_ALLOW_SUBMIT=true → record.
// When something needs a person, the run records the page it stopped on and why; a
// run in a window you watch leaves you on that page.
// Everything is written to portal_runs / portal_fields / portal_errors as it goes,
// so a crash leaves a record of how far it got.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { pool } from "../db";
import { withLock } from "../db-lock";
import { detectLetterLang } from "../letter";
import { getApplication, setApplicationStatus } from "../queries";
import { logWorkflow } from "../recruiter";
import { getLatestDossier, researchCompanyForApplication, type CompanyDossier } from "../research";
import type { ApplicationDetail } from "../types";
import { anthropicLLM, type AnswerLLM } from "./answers/engine";
import { buildCorpus } from "./answers/grounding";
import { loadWritingSamples } from "./answers/style";
import { currentValue, fillField, markField, COLORS, type FillResult } from "./browser/fill";
import { extractFieldsWithOptions } from "./browser/extract";
import { detectCaptcha, detectClosedPosting, detectLoginWall, visibleFormErrors } from "./browser/guards";
import { loadCandidateProfile } from "./candidate";
import { classifyField } from "./classify";
import { ensureCoverLetter, type CoverLetter } from "./cover-letter";
import { resolveApplyTarget } from "./apply-url";
import { duplicateReason } from "./dedupe";
import { loadAnswerMemory, noteMemoryUse } from "./memory-store";
import { companyNotes, mergeApprovals, planField, planFields, type PlanContext } from "./planner";
import { gmailIsConnected } from "../gmail";
import { gmailVerificationLink } from "./account-mail";
import { accountCredentials, portalHost, redact } from "./account-config";
import { knownAccountState, passAccountWall } from "./account";
import {
  accountPortalReason,
  adapterFor,
  advanceStep,
  confirmationText,
  findNextStep,
  manualOnlyReason,
  neverDrivenReason,
  printedStep,
  revealApplicationForm,
  scopeSelector,
  whyNoForm,
  wizardReason,
  type PlatformAdapter,
} from "./platforms";
import { preflightPasses, runPreflight } from "./preflight";
import { agentEnabled, runFormAgent } from "./agent";
import { tailoredCvEnabled } from "../cv-tailor";
import { safeDeskPath } from "../safe-path";
import { assertPublicUrl, blockPrivateNetwork } from "../net-guard";
import { selectResume } from "./resume-select";
import { decideChannel, saveChannel } from "./route";
import {
  createRun,
  finishRun,
  latestPlannedRun,
  listApprovals,
  logPortalError,
  markSubmitClicked,
  planIsComplete,
  saveFields,
  updateRun,
} from "./store";
import { submitApplication, submitEnabled, type SubmitOutcome } from "./submit";
import type { FieldDecision, FormField, PreflightItem, RunMode, RunState } from "./types";

export type RunOptions = {
  mode: RunMode;
  /** Show the browser. Plan runs are headless unless this is set. */
  headed?: boolean;
  forcePortal?: boolean;
  /**
   * May this run sign in to, or create, an account on the employer's portal (lib/apply/account.ts)? True only for a run you
   * started for one application; the queue and `automate` leave it off, so nothing opens accounts by itself. Also needs
   * PORTAL_CREATE_ACCOUNTS=true and the account email and password in .env.local.
   */
  allowAccounts?: boolean;
  /** Called with the page before closing, e.g. the CLI waiting for Enter so a person can finish by hand. */
  beforeClose?: (page: Page) => Promise<void>;
  llm?: AnswerLLM | null;
  log?: (line: string) => void;
};

export type RunResult = {
  runId: string | null;
  /** "busy": another run is working on this application right now; nothing was done. */
  state: RunState | "email" | "skipped" | "busy";
  reason: string;
  preflight: PreflightItem[];
  decisions: FieldDecision[];
  /** The page of the form that needs you (1 = the first); null once submitted or when there is nothing to continue. */
  step?: number | null;
  /** Fields written into the form and read back. */
  filled?: number;
};

const FILLABLE: ReadonlySet<FieldDecision["status"]> = new Set(["resolved", "approved", "generated"]);

function autoApproveAnswers(): boolean {
  return process.env.PORTAL_AUTO_APPROVE_ANSWERS?.trim().toLowerCase() === "true";
}

function autoConfirmPersonal(): boolean {
  return process.env.PORTAL_AUTO_CONFIRM_PERSONAL?.trim().toLowerCase() === "true";
}

/** A form with more pages than this is not an internship application the desk should keep clicking through. */
const MAX_STEPS = 10;

/**
 * Leaves the window to the person (until they close it, or press Enter in a terminal) and watches every page load for a
 * confirmation, since the page cannot be read any more once it is closed. Returns the confirmation text, if one appeared.
 */
async function waitForPerson(page: Page, adapter: PlatformAdapter, beforeClose: (page: Page) => Promise<void>): Promise<string | null> {
  let confirmation: string | null = null;
  const watch = async () => {
    confirmation = confirmation ?? (await confirmationText(page, adapter).catch(() => null));
  };
  page.on("load", () => void watch());
  await beforeClose(page);
  await watch();
  return confirmation;
}

function dailyLimit(): number {
  const n = Number(process.env.PORTAL_DAILY_LIMIT ?? 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

async function submittedToday(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM portal_runs WHERE state = 'submitted' AND submitted_at >= date_trunc('day', now())`,
  );
  return Number(rows[0].n);
}

async function boardContext(app: ApplicationDetail) {
  const { rows } = await pool.query<{ board_token: string | null; external_id: string | null; source: string | null; is_target: boolean }>(
    `SELECT c.board_token, j.external_id, j.source, c.is_target
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1`,
    [app.job_id],
  );
  return rows[0] ?? { board_token: null, external_id: null, source: null, is_target: false };
}

async function screenshot(page: Page, runId: string, suffix: string): Promise<string | null> {
  try {
    const dir = path.join("applications", "_portal");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${runId}-${suffix}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}

async function openForm(
  page: Page,
  url: string,
  ctx: { boardToken: string | null; externalId: string | null },
): Promise<{ adapter: PlatformAdapter; page: Page }> {
  let adapter = adapterFor(url);
  // The form's address comes from a posting or a job board: only a public web page is opened.
  await page.goto((await assertPublicUrl(adapter.formUrl(url, ctx))).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  let current = await revealApplicationForm(page, adapter);
  // A company page often forwards to a real ATS (or opens it in a new tab): switch to that adapter.
  const landed = adapterFor(current.url());
  if (landed.id !== adapter.id && landed.id !== "generic") {
    adapter = landed;
    const wanted = adapter.formUrl(current.url(), ctx);
    if (current.url() !== wanted) await current.goto((await assertPublicUrl(wanted)).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    current = await revealApplicationForm(current, adapter);
  }
  await current.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  return { adapter, page: current };
}

async function readFields(page: Page, adapter: PlatformAdapter): Promise<FormField[]> {
  return extractFieldsWithOptions(page, await scopeSelector(page, adapter));
}

/**
 * One run per application at a time, whichever process starts it (the auto-apply batch, a button on the application
 * page, `npm run portal`): two browsers on the same form would fill it, and maybe submit it, twice.
 */
export async function runPortalApplication(applicationId: string, opts: RunOptions): Promise<RunResult> {
  const held = await withLock("portal-run", applicationId, () => runPortalApplicationLocked(applicationId, opts), { wait: false });
  if (held.ok) return held.value;
  const reason = "Another run is already working on this application (a browser window may still be open on it): finish or close that one first.";
  (opts.log ?? (() => undefined))(reason);
  return { runId: null, state: "busy", reason, preflight: [], decisions: [] };
}

async function runPortalApplicationLocked(applicationId: string, opts: RunOptions): Promise<RunResult> {
  const creds = opts.allowAccounts ? accountCredentials() : null;
  // Whatever is logged may carry the account's password (a page error quoting what was typed): it never does.
  const log = (line: string) => (opts.log ?? (() => undefined))(redact(line, creds));
  const app = await getApplication(applicationId);
  if (!app) throw new Error(`application not found: ${applicationId}`);
  const board = await boardContext(app);

  const target = await resolveApplyTarget(app);
  const dup = await duplicateReason(app, [target.url]);
  if (dup) {
    const runId = await createRun({ applicationId, mode: opts.mode, postingUrl: app.url, companyName: app.company_name, roleTitle: app.title });
    await finishRun(runId, "duplicate", { blocked_reason: dup });
    log(`duplicate: ${dup}`);
    return { runId, state: "duplicate", reason: dup, preflight: [], decisions: [] };
  }

  const channel = await decideChannel(app, { forcePortal: opts.forcePortal, applyUrl: target.url, hint: target.hint, allowAccountPortals: !!creds });
  await saveChannel(app.id, channel.channel);
  if (channel.channel === "email") {
    log(`email channel: ${channel.reason}`);
    return { runId: null, state: "email", reason: channel.reason, preflight: [], decisions: [] };
  }

  const previousFields = await listApprovals(app.id);
  const runId = await createRun({ applicationId, mode: opts.mode, postingUrl: app.url, companyName: app.company_name, roleTitle: app.title });
  await logWorkflow(app.id, "portal_start", true, `${opts.mode} run ${runId}`);

  if (channel.channel === "manual") {
    await finishRun(runId, "blocked", { blocked_reason: channel.reason });
    return { runId, state: "blocked", reason: channel.reason, preflight: [], decisions: [] };
  }

  let browser: Browser | null = null;
  let page: Page | null = null;
  let stage = "prepare";
  try {
    const lang = detectLetterLang(app.title, app.description);
    const resume = await selectResume(lang, app.title, app.description);
    log(`CV: ${resume.resume?.label ?? "none"} (${resume.reason})`);

    stage = "research";
    let dossier: CompanyDossier | null = await getLatestDossier(app.company_id, app.id);
    if (!dossier) dossier = await researchCompanyForApplication({ app, companyId: app.company_id }).catch(() => null);
    const notes = companyNotes(dossier, app.company_name, lang);

    const candidate = await loadCandidateProfile(lang, resume.resume);
    const samples = await loadWritingSamples(lang);
    const corpus = buildCorpus({
      candidate,
      job: { companyName: app.company_name, title: app.title, description: app.description, location: app.location },
      companyNotes: notes,
      samples: samples.map((s) => s.answer),
    });

    stage = "open";
    log(`form source: ${target.via} (${target.note}) ${target.url}`);
    const manualOnly = (creds ? neverDrivenReason : manualOnlyReason)(target.url);
    if (manualOnly) {
      await finishRun(runId, "blocked", { blocked_reason: manualOnly, lang });
      return { runId, state: "blocked", reason: manualOnly, preflight: [], decisions: [] };
    }
    // Fill runs are visible so a person can take over; PORTAL_HEADLESS=true forces headless (servers, tests).
    const forceHeadless = process.env.PORTAL_HEADLESS?.trim().toLowerCase() === "true";
    browser = await chromium.launch({ headless: forceHeadless || (opts.mode === "plan" ? !opts.headed : false) });
    const context = await browser.newContext({ locale: lang === "fr" ? "fr-CA" : "en-CA" });
    // Nothing the employer's page loads may reach this machine's own network.
    await blockPrivateNetwork(context);
    page = await context.newPage();
    const opened = await openForm(page, target.url, { boardToken: board.board_token, externalId: board.external_id });
    const adapter = opened.adapter;
    page = opened.page;
    await updateRun(runId, { platform: adapter.id, form_url: page.url(), lang });
    log(`form: ${adapter.label} ${page.url()}`);

    // A window you are watching (review runs) is never closed on a stop: it stays on the page that needs you, and an
    // application you finish there is recorded as submitted.
    const handOver = async (reason: string, suffix: string): Promise<RunResult | null> => {
      if (!opts.beforeClose || !page) return null;
      await updateRun(runId, { state: "needs_review", blocked_reason: reason, stop_step: 1, screenshot_path: await screenshot(page, runId, suffix) });
      log(`waiting for you in the browser: ${reason}`);
      const confirmation = await waitForPerson(page, adapter, opts.beforeClose);
      if (!confirmation) return null;
      await finishRun(runId, "submitted", { submitted_at: new Date(), confirmation_text: `${confirmation} (submitted by you)` });
      await setApplicationStatus(app.id, "applied", "portal application submitted by hand after the desk stopped");
      return { runId, state: "submitted", reason: confirmation, preflight: [], decisions: [], step: null, filled: 0 };
    };

    // The end of every run that filled a form, whoever filled it (the desk's own planner, or the AI form agent): the checks
    // on the page in front, then the gated Submit, or the hand-over to a person.
    type Conclusion = {
      decisions: FieldDecision[];
      fills: Map<string, FillResult>;
      requiredEmpty: string[];
      resumeFieldPresent: boolean;
      coverLetter: CoverLetter | null;
      step: number;
      stopReason: string | null;
      counts: { field_count: number; required_count: number; manual_count: number };
      /** Added to the status reason: " via the AI form agent" or nothing. */
      via: string;
    };
    const baseAdapter = adapter;
    const livePage = () => page!;
    const conclude = async (c: Conclusion): Promise<RunResult> => {
      const { decisions, fills, requiredEmpty, step, stopReason } = c;
      const page = livePage();
      const adapter = adapterFor(page.url()).id === "generic" ? baseAdapter : adapterFor(page.url());
      const autoApprove = autoApproveAnswers();
      stage = "validate";
      const captcha = await detectCaptcha(page);
      const formErrors = await visibleFormErrors(page);
      const freshApp = (await getApplication(app.id))!;
      const dupNow = await duplicateReason(freshApp, [target.url, page.url()]);

      let submitRequested = opts.mode === "submit" && !stopReason;
      let limitNote: string | null = null;
      if (submitRequested && (await submittedToday()) >= dailyLimit()) {
        submitRequested = false;
        limitNote = `Daily limit of ${dailyLimit()} automatic submissions reached (PORTAL_DAILY_LIMIT).`;
      }
      const preflight = runPreflight({
        decisions,
        fills,
        requiredEmpty,
        resume,
        resumeFieldPresent: c.resumeFieldPresent,
        coverLetter: c.coverLetter,
        coverLetterUsed: decisions.some((d) => (d.intent === "cover_letter_file" || d.intent === "cover_letter_text") && d.value),
        captcha,
        formErrors,
        duplicate: dupNow,
        isTarget: board.is_target,
        autoApprove,
        submitRequested,
        submitEnabled: submitEnabled(),
        stoppedEarly: stopReason,
      });
      await saveFields(runId, decisions);
      const filledShot = await screenshot(page, runId, "filled");
      await updateRun(runId, { ...c.counts, preflight, screenshot_path: filledShot, step_count: step });
      for (const item of preflight) log(`${item.ok ? "✓" : item.blocking ? "✗" : "!"} ${item.label}${item.detail ? `: ${item.detail}` : ""}`);

      const qualityOk = preflight.filter((i) => !["not_target", "submit_enabled"].includes(i.id)).every((i) => i.ok || !i.blocking);
      let submitted: { outcome: SubmitOutcome; shot: string | null } | null = null;
      if (submitRequested && preflightPasses(preflight)) {
        stage = "submit";
        // One submit at a time across every process, with the daily count read again inside: two runs that both saw
        // "9 of 10" earlier cannot both send the 10th. A submitted run is recorded before the lock is let go.
        const submitPage = page;
        submitted = (
          await withLock(
            "portal-submit",
            "daily-limit",
            async () => {
              if ((await submittedToday()) >= dailyLimit()) return null;
              const outcome = await submitApplication(submitPage, adapter, preflight, { beforeClick: () => markSubmitClicked(runId, true) });
              const shot = await screenshot(submitPage, runId, outcome.state);
              if (outcome.state === "submitted") {
                await finishRun(runId, "submitted", { submitted_at: new Date(), confirmation_text: outcome.confirmation, screenshot_path: shot });
              } else if (!outcome.maybeSent) {
                await markSubmitClicked(runId, false);
              }
              return { outcome, shot };
            },
            { wait: true },
          ).then((r) => (r.ok ? r.value : null))
        );
        if (!submitted) limitNote = `Daily limit of ${dailyLimit()} automatic submissions reached (PORTAL_DAILY_LIMIT).`;
      }
      if (submitted) {
        const { outcome, shot } = submitted;
        if (outcome.state === "submitted") {
          await setApplicationStatus(app.id, "applied", `portal application submitted (${adapter.label}${c.via})`);
          await logWorkflow(app.id, "portal_submit", true, outcome.confirmation);
          log(`submitted: ${outcome.confirmation}`);
          return { runId, state: "submitted", reason: outcome.confirmation, preflight, decisions, step: null, filled: fills.size };
        }
        // Never retried automatically: an unconfirmed click might have gone through.
        const why = `Page ${step}: ${outcome.reason}`;
        await finishRun(runId, "blocked", { blocked_reason: why, screenshot_path: shot, stop_step: step });
        await logWorkflow(app.id, "portal_submit", false, outcome.reason);
        if (opts.beforeClose) await opts.beforeClose(page);
        return { runId, state: "blocked", reason: why, preflight, decisions, step, filled: fills.size };
      }

      const state: RunState = qualityOk ? "ready_to_submit" : "needs_review";
      const failing = preflight
        .filter((i) => !i.ok && i.blocking && (qualityOk || !["not_target", "submit_enabled"].includes(i.id)))
        .map((i) => (i.detail ? `${i.label} (${i.detail})` : i.label));
      const reason =
        stopReason ??
        limitNote ??
        (qualityOk
          ? opts.mode === "submit"
            ? `Page ${step}: filled and validated, not submitted: ${failing.join("; ") || "automatic submit is off"}.`
            : `Page ${step}: filled and validated. Submit is left for you.`
          : `Page ${step}: ${failing.join("; ")}.`);
      await updateRun(runId, { state, blocked_reason: reason, stop_step: step });

      if (opts.beforeClose) {
        // The person may submit by hand in the open window: watch every page load for a confirmation,
        // since the page cannot be read any more once they close it.
        const confirmation = await waitForPerson(page, adapter, opts.beforeClose);
        if (confirmation) {
          await finishRun(runId, "submitted", { submitted_at: new Date(), confirmation_text: `${confirmation} (submitted by you)` });
          await setApplicationStatus(app.id, "applied", "portal application submitted by hand after assist");
          return { runId, state: "submitted", reason: confirmation, preflight, decisions, step: null, filled: fills.size };
        }
      }
      await finishRun(runId, state);
      return { runId, state, reason, preflight, decisions, step, filled: fills.size };
    };

    // The AI form agent (lib/apply/agent): for a portal the desk's own reader stops on (Workday's wizard, a first-step
    // portal, a page with no form it can read). Off with PORTAL_AI_AGENT=false or without an API key; never on a plan run,
    // which only reads.
    const viaAgent = async (trigger: string): Promise<RunResult | null> => {
      if (!agentEnabled()) return null;
      if (opts.mode === "plan") {
        const reason = `${trigger} The AI form agent fills this portal when the application is run (Remplir, or the batch).`;
        await finishRun(runId, "needs_review", { blocked_reason: reason, stop_step: 1, lang });
        return { runId, state: "needs_review", reason, preflight: [], decisions: [], step: 1, filled: 0 };
      }
      stage = "agent";
      log(`AI form agent takes over: ${trigger}`);
      await updateRun(runId, { state: "filling" });
      let agentLetter: CoverLetter | null = null;
      const out = await runFormAgent({
        page: page!,
        candidate,
        job: { companyName: app.company_name, title: app.title, location: app.location, description: app.description },
        files: {
          resumePath: tailoredCvEnabled() && safeDeskPath(app.tailored_cv_path) ? app.tailored_cv_path! : resume.resume && resume.fileExists ? resume.resume.storage_path : null,
          coverLetter: async () => {
            agentLetter ??= await ensureCoverLetter({ app, dossier, lang, build: true }).catch(() => null);
            return agentLetter?.pdfPath ?? null;
          },
        },
        answers: {
          candidate,
          companyName: app.company_name,
          roleTitle: app.title,
          posting: app.description,
          companyNotes: notes,
          corpus,
          samples,
          llm: opts.llm === undefined ? anthropicLLM() : opts.llm,
          applicationId: app.id,
        },
        autoApprove: autoApproveAnswers(),
        autoConfirm: autoConfirmPersonal(),
        memory: await loadAnswerMemory(),
        log,
      });
      page = out.page;
      const decisions = out.decisions.map((d) => ({ ...d, step: 1 }));
      await saveFields(runId, decisions);
      const counts = {
        field_count: decisions.length,
        required_count: decisions.filter((d) => d.required).length,
        manual_count: decisions.filter((d) => d.status === "manual" || (d.status === "generated" && !autoApproveAnswers())).length,
      };
      if (out.state !== "ready") {
        await logWorkflow(app.id, "portal_agent", false, out.reason);
        const byYou = await handOver(out.reason, "agent");
        if (byYou) return byYou;
        const state: RunState = out.state === "failed" ? "failed" : "needs_review";
        await finishRun(runId, state, { ...counts, blocked_reason: out.reason, screenshot_path: await screenshot(page, runId, "agent") });
        return { runId, state, reason: out.reason, preflight: [], decisions, step: null, filled: decisions.filter((d) => d.status === "filled").length };
      }
      // Ready: the desk reads the page in front again and runs its own checks before anything is submitted.
      const onPage = await readFields(page, adapterFor(page.url()));
      const requiredEmpty: string[] = [];
      for (const f of onPage) if (f.required && !(await currentValue(page, f))) requiredEmpty.push(f.label);
      const fills = new Map<string, FillResult>(
        decisions.filter((d) => d.status !== "manual").map((d) => [d.signature, { ok: true, detail: "written by the AI form agent and read back", readBack: d.value }]),
      );
      return conclude({
        decisions,
        fills,
        requiredEmpty,
        resumeFieldPresent: out.resumeAttached,
        coverLetter: agentLetter,
        step: 1,
        stopReason: null,
        counts,
        via: ", filled by the AI form agent",
      });
    };

    stage = "guards";
    // "Apply" may have led to a portal that needs an account (a Phenom page handing off to Workday).
    const landedManual = (creds ? neverDrivenReason : manualOnlyReason)(page.url());
    if (landedManual) {
      await saveChannel(app.id, "manual");
      const byYou = await handOver(landedManual, "manual");
      if (byYou) return byYou;
      await finishRun(runId, "blocked", { blocked_reason: `${landedManual} (reached from ${target.url})`, screenshot_path: await screenshot(page, runId, "manual"), stop_step: 1 });
      return { runId, state: "blocked", reason: landedManual, preflight: [], decisions: [], step: 1, filled: 0 };
    }
    let wall = await detectLoginWall(page);
    // An employer's portal that wants an account: sign in, or create it, with the account in .env.local. Only on a run you
    // started for this application; anything it should not decide (a CAPTCHA, a form wanting more) stops here with why.
    if ((wall || accountPortalReason(page.url())) && creds) {
      stage = "account";
      const outcome = await passAccountWall(page, {
        creds,
        log,
        known: await knownAccountState(portalHost(page.url())),
        verificationLink: (await gmailIsConnected().catch(() => false)) ? gmailVerificationLink : undefined,
        profile: { firstName: candidate.firstName, lastName: candidate.lastName, phone: candidate.phone, country: candidate.country },
      });
      if (!outcome.ok) {
        await saveChannel(app.id, "manual");
        const byYou = await handOver(redact(outcome.reason, creds), "account");
        if (byYou) return byYou;
        await finishRun(runId, "blocked", { blocked_reason: redact(outcome.reason, creds), screenshot_path: await screenshot(page, runId, "account"), stop_step: 1 });
        return { runId, state: "blocked", reason: outcome.reason, preflight: [], decisions: [], step: 1, filled: 0 };
      }
      log(outcome.action === "none" ? "no account step needed" : `account ${outcome.action === "created" ? "created" : "signed in"} on ${portalHost(page.url())}`);
      wall = await detectLoginWall(page);
      stage = "guards";
    }
    if (wall) {
      await saveChannel(app.id, "manual");
      const byYou = await handOver(wall, "blocked");
      if (byYou) return byYou;
      await finishRun(runId, "blocked", { blocked_reason: wall, screenshot_path: await screenshot(page, runId, "blocked"), stop_step: 1 });
      return { runId, state: "blocked", reason: wall, preflight: [], decisions: [], step: 1, filled: 0 };
    }
    // Workday's wizard is not one the desk can fill and read back: it stops before planning it.
    const wizard = await wizardReason(page);
    if (wizard) {
      const agentRun = await viaAgent(`a multi-step wizard: ${wizard}`);
      if (agentRun) return agentRun;
      await saveChannel(app.id, "manual");
      const byYou = await handOver(wizard, "wizard");
      if (byYou) return byYou;
      await finishRun(runId, "blocked", { blocked_reason: wizard, screenshot_path: await screenshot(page, runId, "wizard"), stop_step: 1 });
      return { runId, state: "blocked", reason: wizard, preflight: [], decisions: [], step: 1, filled: 0 };
    }
    // A CAPTCHA only stands between the form and Submit: the form is still read and filled, the preflight's
    // "no CAPTCHA" item keeps the submit for a person, who solves it in the open window. Never solved here.
    const earlyCaptcha = await detectCaptcha(page);
    if (earlyCaptcha.challenge) log(`${earlyCaptcha.kind} on the page: you will solve it before submitting.`);

    stage = "extract";
    let fields = await readFields(page, adapter);
    if (fields.length < 2) {
      const closed = await detectClosedPosting(page);
      if (closed) {
        // Discovery clears closed_at again if the posting ever reappears on its board.
        await pool.query(`UPDATE jobs SET closed_at = COALESCE(closed_at, now()) WHERE id = $1`, [app.job_id]);
        const reason = `The posting is closed: the portal says "${closed}".`;
        await finishRun(runId, "blocked", { blocked_reason: reason, screenshot_path: await screenshot(page, runId, "closed") });
        await logWorkflow(app.id, "portal_closed", true, closed);
        return { runId, state: "blocked", reason, preflight: [], decisions: [], step: null, filled: 0 };
      }
      const reason = earlyCaptcha.challenge
        ? `${earlyCaptcha.kind} challenge hides the form: solve it yourself, then the form appears.`
        : await whyNoForm(page);
      if (!earlyCaptcha.challenge) {
        const agentRun = await viaAgent(`no form the desk's reader can take: ${reason}`);
        if (agentRun) return agentRun;
      }
      // Nothing to plan or fill here: route it to a person so the queue stops retrying it.
      if (!earlyCaptcha.challenge) await saveChannel(app.id, "manual");
      const byYou = await handOver(reason, "noform");
      if (byYou) return byYou;
      await finishRun(runId, "blocked", { blocked_reason: reason, screenshot_path: await screenshot(page, runId, "noform"), stop_step: 1 });
      return { runId, state: "blocked", reason, preflight: [], decisions: [], step: 1, filled: 0 };
    }
    log(`${fields.length} fields (${fields.filter((f) => f.required).length} required)`);

    const autoApprove = autoApproveAnswers();
    const ctx: PlanContext = {
      candidate,
      job: {
        companyName: app.company_name,
        title: app.title,
        description: app.description,
        location: app.location,
        workplaceType: app.workplace_type,
        source: board.source,
        url: app.url,
      },
      files: {
        resumePath: tailoredCvEnabled() && safeDeskPath(app.tailored_cv_path) ? app.tailored_cv_path! : resume.resume && resume.fileExists ? resume.resume.storage_path : null,
        coverLetterPath: null,
        coverLetterText: null,
      },
      answers: {
        candidate,
        companyName: app.company_name,
        roleTitle: app.title,
        posting: app.description,
        companyNotes: notes,
        corpus,
        samples,
        llm: opts.llm === undefined ? anthropicLLM() : opts.llm,
        applicationId: app.id,
      },
      autoApprove,
      autoConfirm: autoConfirmPersonal(),
      step: 1,
      memory: await loadAnswerMemory(),
    };
    await updateRun(runId, { resume_id: resume.resume?.id ?? null, resume_path: resume.resume?.storage_path ?? null, resume_reason: resume.reason, step_count: 1 });

    // The cover letter is built the first time a page asks for one (it may be on page 3 of a multi-step form).
    let coverLetter: CoverLetter | null = null;
    let clRequired = false;
    let clAttempted: "none" | "light" | "full" = "none";
    const prepareCoverLetter = async (list: FormField[]) => {
      const asked = list.filter((f) => ["cover_letter_file", "cover_letter_text"].includes(classifyField(f)));
      if (asked.length === 0 || coverLetter) return;
      clRequired = clRequired || asked.some((f) => f.required);
      const build = clRequired || process.env.PORTAL_COVER_LETTER === "always";
      const want = build ? "full" : "light";
      if (clAttempted === "full" || clAttempted === want) return;
      clAttempted = want;
      const was = stage;
      stage = "cover_letter";
      coverLetter = await ensureCoverLetter({ app, dossier, lang, build }).catch(async (err) => {
        await logPortalError({ applicationId: app.id, runId, stage, error: err });
        return null;
      });
      stage = was;
      ctx.files.coverLetterPath = coverLetter?.pdfPath ?? null;
      ctx.files.coverLetterText = coverLetter?.text ?? null;
      await updateRun(runId, { cover_letter_path: coverLetter?.pdfPath ?? null, cover_letter_required: clRequired });
    };
    await prepareCoverLetter(fields);

    stage = "plan";
    const decisions = mergeApprovals(await planFields(fields, ctx), previousFields);
    await saveFields(runId, decisions);
    await noteMemoryUse(decisions.flatMap((d) => (d.memoryKey && d.status === "resolved" ? [d.memoryKey] : [])));
    const isPending = (d: FieldDecision) => (d.status === "manual" && (d.required || !!d.value)) || (d.status === "generated" && !autoApprove);
    const counts = () => ({
      field_count: decisions.length,
      required_count: decisions.filter((d) => d.required).length,
      manual_count: decisions.filter(isPending).length,
    });
    await updateRun(runId, counts());

    let next = await findNextStep(page);
    // A single page with nowhere to put a CV is the first step of something the desk cannot see. On a multi-step form the
    // CV is often on a later page: the preflight checks, at the end, that one was attached somewhere.
    if (!decisions.some((d) => d.intent === "resume") && !next) {
      const agentRun = await viaAgent("the first page has no CV upload and no Next button (a first-step portal).");
      if (agentRun) return agentRun;
      const reason =
        "This page has no CV upload and no Next button: it is the first step of a portal the desk cannot see the rest of. Apply there yourself.";
      await saveChannel(app.id, "manual");
      await logWorkflow(app.id, "portal_plan", false, "no CV upload on the form");
      const byYou = await handOver(reason, "no-cv");
      if (byYou) return byYou;
      await finishRun(runId, "blocked", { blocked_reason: reason, screenshot_path: await screenshot(page, runId, "no-cv"), stop_step: 1 });
      return { runId, state: "blocked", reason, preflight: [], decisions, step: 1, filled: 0 };
    }

    if (opts.mode === "plan") {
      const complete = await planIsComplete(runId, autoApprove);
      const state: RunState = complete ? "planned" : "needs_review";
      await finishRun(runId, state);
      await logWorkflow(app.id, "portal_plan", true, `${state}: ${counts().manual_count} to review`);
      const more = next ? " This is page 1 of a multi-step form: the next pages are read while filling." : "";
      return {
        runId,
        state,
        reason: `${complete ? "Every field is decided." : `${counts().manual_count} field(s) wait for you.`}${more}`,
        preflight: [],
        decisions,
        step: 1,
        filled: 0,
      };
    }

    stage = "fill";
    await updateRun(runId, { state: "filling" });
    const fills = new Map<string, FillResult>();
    const fillAll = async (list: FormField[]) => {
      for (const f of list) {
        const d = decisions.find((x) => x.signature === f.signature);
        if (!d) continue;
        if (!FILLABLE.has(d.status) || !d.value) {
          await markField(page!, f, d.status === "skipped" ? COLORS.skipped : COLORS.manual);
          continue;
        }
        const r = await fillField(page!, f, d);
        fills.set(f.signature, r);
        d.status = r.ok ? (d.status === "generated" ? "generated" : "filled") : "failed";
        if (!r.ok) d.reason = `${d.reason} Fill failed: ${r.detail}`;
        log(`${r.ok ? "✓" : "✗"} ${f.label.slice(0, 60)}: ${r.detail}`);
      }
    };
    // Fills one page, then catches questions that answering revealed ("If yes, please explain"). Returns the page's fields.
    const fillPage = async (list: FormField[]): Promise<FormField[]> => {
      await fillAll(list);
      let current = list;
      for (let pass = 0; pass < 2; pass++) {
        const again = await readFields(page!, adapter);
        const known = new Set(decisions.map((d) => d.signature));
        const added = again.filter((f) => !known.has(f.signature));
        current = again;
        if (added.length === 0) break;
        log(`${added.length} new field(s) appeared after filling`);
        await prepareCoverLetter(added);
        const planned = mergeApprovals(await Promise.all(added.map((f) => planField(f, ctx))), previousFields);
        decisions.push(...planned);
        await fillAll(added);
      }
      await saveFields(runId, decisions);
      await updateRun(runId, counts());
      return current;
    };
    const requiredEmptyOn = async (list: FormField[]) => {
      const empty: string[] = [];
      for (const f of list) if (f.required && !(await currentValue(page!, f))) empty.push(f.label);
      return empty;
    };

    // Page by page: fill, check, press Next, until the page that carries the final Submit. "Next" is pressed only when
    // this page is complete and nothing so far waits for you, so the form is never pushed past a question it needs.
    let step = 1;
    let stopReason: string | null = null;
    fields = await fillPage(fields);
    for (;;) {
      next = await findNextStep(page);
      if (!next) break;
      stage = `page ${step}`;
      const empty = await requiredEmptyOn(fields);
      const waiting = decisions.filter(isPending).map((d) => d.label);
      const notFilled = decisions.filter((d) => d.status === "failed").map((d) => d.label);
      const challenge = await detectCaptcha(page);
      if (empty.length) stopReason = `Page ${step}: required field(s) still empty: ${empty.join("; ")}.`;
      else if (waiting.length) stopReason = `Page ${step}: answer(s) waiting for you before going on: ${waiting.join("; ")}.`;
      else if (notFilled.length) stopReason = `Page ${step}: could not fill ${notFilled.join("; ")}.`;
      else if (challenge.challenge) stopReason = `Page ${step}: ${challenge.kind} challenge to solve before going on.`;
      else if (next.disabled) stopReason = `Page ${step}: the form does not let you go on yet (its Next button is disabled).`;
      else if (step >= MAX_STEPS) stopReason = `The form has more than ${MAX_STEPS} pages: the desk stops on page ${step}.`;
      if (stopReason) break;

      const moved = await advanceStep(page, next.button);
      if (!moved.moved) {
        stopReason = `Page ${step}: ${moved.reason}.`;
        break;
      }
      step += 1;
      const printed = await printedStep(page);
      log(`page ${step}${printed ? ` (the form says ${printed.at} of ${printed.of})` : ""}: ${page.url()}`);
      await updateRun(runId, { step_count: step, form_url: page.url() });

      stage = "extract";
      fields = await readFields(page, adapter);
      // "Continue" was the last button after all: the portal confirms with no form left. Recorded, never retried.
      const early = fields.length < 2 ? await confirmationText(page, adapter) : null;
      if (early) {
        await finishRun(runId, "submitted", { submitted_at: new Date(), confirmation_text: early, screenshot_path: await screenshot(page, runId, "submitted"), step_count: step });
        await setApplicationStatus(app.id, "applied", `portal application submitted (${adapter.label}; its last button read "Continue")`);
        await logWorkflow(app.id, "portal_submit", true, early);
        return { runId, state: "submitted", reason: early, preflight: [], decisions, step: null, filled: fills.size };
      }
      ctx.step = step;
      await prepareCoverLetter(fields);
      stage = "plan";
      const known = new Set(decisions.map((d) => d.signature));
      const fresh = fields.filter((f) => !known.has(f.signature));
      if (fresh.length) decisions.push(...mergeApprovals(await planFields(fresh, ctx), previousFields));
      log(`${fields.length} fields on page ${step} (${fields.filter((f) => f.required).length} required)`);
      stage = "fill";
      fields = await fillPage(fields);
    }

    return conclude({
      decisions,
      fills,
      requiredEmpty: await requiredEmptyOn(fields),
      resumeFieldPresent: decisions.some((d) => d.intent === "resume"),
      coverLetter,
      step,
      stopReason,
      counts: counts(),
      via: "",
    });
  } catch (err) {
    await logPortalError({ applicationId: app.id, runId, stage, error: err, detail: { url: page?.url() } });
    const shot = page ? await screenshot(page, runId, "error") : null;
    await finishRun(runId, "failed", { error: redact(`${stage}: ${err instanceof Error ? err.message : String(err)}`, creds).slice(0, 1000), screenshot_path: shot });
    await logWorkflow(app.id, "portal_error", false, redact(`${stage}: ${err instanceof Error ? err.message : String(err)}`, creds));
    throw err;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Applications that go through a portal and still need a plan, or whose plan is complete and ready to execute. */
export async function portalQueue(kind: "plan" | "execute", limit = 20): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    kind === "plan"
      ? `SELECT a.id FROM applications a
          WHERE a.status IN ('qualified', 'ready') AND COALESCE(a.channel, 'portal') = 'portal'
            AND EXISTS (SELECT 1 FROM jobs oj WHERE oj.id = a.job_id AND oj.closed_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM contacts ct JOIN jobs j ON j.company_id = ct.company_id
                             WHERE j.id = a.job_id AND ct.email IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM portal_runs r WHERE r.application_id = a.id
                             AND (r.state IN ('submitted', 'duplicate') OR r.started_at > now() - interval '7 days'))
          ORDER BY a.id LIMIT $1`
      : `SELECT DISTINCT ON (r.application_id) r.application_id AS id
           FROM portal_runs r JOIN applications a ON a.id = r.application_id
          WHERE a.status IN ('qualified', 'ready') AND a.channel = 'portal'
            AND EXISTS (SELECT 1 FROM jobs oj WHERE oj.id = a.job_id AND oj.closed_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM portal_runs s WHERE s.application_id = a.id AND s.state = 'submitted')
          ORDER BY r.application_id, r.started_at DESC LIMIT $1`,
    [limit],
  );
  if (kind === "plan") return rows.map((r) => r.id);
  // Only those whose newest run is a complete plan.
  const ready: string[] = [];
  for (const r of rows) {
    const run = await latestPlannedRun(r.id);
    if (run && run.state === "planned") ready.push(r.id);
  }
  return ready;
}
