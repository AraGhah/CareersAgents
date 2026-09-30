// One portal application, end to end:
//   duplicate check → channel (email / portal / manual) → CV → company notes →
//   open the form → guards (login wall, CAPTCHA) → read the fields → cover letter
//   → plan every field (deterministic values + written answers) → keep earlier
//   approvals → [plan mode stops here]
//   → fill + read back → re-scan for questions that appeared → preflight →
//   submit only when every gate passes and PORTAL_ALLOW_SUBMIT=true → record.
// Everything is written to portal_runs / portal_fields / portal_errors as it goes,
// so a crash leaves a record of how far it got.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { pool } from "../db";
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
import { companyNotes, mergeApprovals, planField, planFields, type PlanContext } from "./planner";
import { gmailIsConnected } from "../gmail";
import { gmailVerificationLink } from "./account-mail";
import { accountCredentials, portalHost, redact } from "./account-config";
import { knownAccountState, passAccountWall } from "./account";
import { accountPortalReason, adapterFor, confirmationText, manualOnlyReason, neverDrivenReason, revealApplicationForm, scopeSelector, whyNoForm, wizardReason, type PlatformAdapter } from "./platforms";
import { preflightPasses, runPreflight } from "./preflight";
import { selectResume } from "./resume-select";
import { decideChannel, saveChannel } from "./route";
import {
  createRun,
  finishRun,
  latestPlannedRun,
  listApprovals,
  logPortalError,
  planIsComplete,
  saveFields,
  updateRun,
} from "./store";
import { submitApplication, submitEnabled } from "./submit";
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
  state: RunState | "email" | "skipped";
  reason: string;
  preflight: PreflightItem[];
  decisions: FieldDecision[];
};

const FILLABLE: ReadonlySet<FieldDecision["status"]> = new Set(["resolved", "approved", "generated"]);

function autoApproveAnswers(): boolean {
  return process.env.PORTAL_AUTO_APPROVE_ANSWERS?.trim().toLowerCase() === "true";
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
  await page.goto(adapter.formUrl(url, ctx), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  let current = await revealApplicationForm(page, adapter);
  // A company page often forwards to a real ATS (or opens it in a new tab): switch to that adapter.
  const landed = adapterFor(current.url());
  if (landed.id !== adapter.id && landed.id !== "generic") {
    adapter = landed;
    const wanted = adapter.formUrl(current.url(), ctx);
    if (current.url() !== wanted) await current.goto(wanted, { waitUntil: "domcontentloaded", timeout: 60000 });
    current = await revealApplicationForm(current, adapter);
  }
  await current.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  return { adapter, page: current };
}

async function readFields(page: Page, adapter: PlatformAdapter): Promise<FormField[]> {
  return extractFieldsWithOptions(page, await scopeSelector(page, adapter));
}

export async function runPortalApplication(applicationId: string, opts: RunOptions): Promise<RunResult> {
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
    page = await context.newPage();
    const opened = await openForm(page, target.url, { boardToken: board.board_token, externalId: board.external_id });
    const adapter = opened.adapter;
    page = opened.page;
    await updateRun(runId, { platform: adapter.id, form_url: page.url(), lang });
    log(`form: ${adapter.label} ${page.url()}`);

    stage = "guards";
    // "Apply" may have led to a portal that needs an account (a Phenom page handing off to Workday).
    const landedManual = (creds ? neverDrivenReason : manualOnlyReason)(page.url());
    if (landedManual) {
      await saveChannel(app.id, "manual");
      await finishRun(runId, "blocked", { blocked_reason: `${landedManual} (reached from ${target.url})`, screenshot_path: await screenshot(page, runId, "manual") });
      return { runId, state: "blocked", reason: landedManual, preflight: [], decisions: [] };
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
      });
      if (!outcome.ok) {
        await saveChannel(app.id, "manual");
        await finishRun(runId, "blocked", { blocked_reason: redact(outcome.reason, creds), screenshot_path: await screenshot(page, runId, "account") });
        return { runId, state: "blocked", reason: outcome.reason, preflight: [], decisions: [] };
      }
      log(outcome.action === "none" ? "no account step needed" : `account ${outcome.action === "created" ? "created" : "signed in"} on ${portalHost(page.url())}`);
      wall = await detectLoginWall(page);
      stage = "guards";
    }
    if (wall) {
      await saveChannel(app.id, "manual");
      await finishRun(runId, "blocked", { blocked_reason: wall, screenshot_path: await screenshot(page, runId, "blocked") });
      return { runId, state: "blocked", reason: wall, preflight: [], decisions: [] };
    }
    // One step of a wizard is not a whole application: stop before planning it as if it were.
    const wizard = await wizardReason(page);
    if (wizard) {
      await saveChannel(app.id, "manual");
      await finishRun(runId, "blocked", { blocked_reason: wizard, screenshot_path: await screenshot(page, runId, "wizard") });
      return { runId, state: "blocked", reason: wizard, preflight: [], decisions: [] };
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
        return { runId, state: "blocked", reason, preflight: [], decisions: [] };
      }
      const reason = earlyCaptcha.challenge
        ? `${earlyCaptcha.kind} challenge hides the form: open it in review mode and solve it yourself.`
        : await whyNoForm(page);
      // Nothing to plan or fill here: route it to a person so the queue stops retrying it.
      if (!earlyCaptcha.challenge) await saveChannel(app.id, "manual");
      await finishRun(runId, "blocked", { blocked_reason: reason, screenshot_path: await screenshot(page, runId, "noform") });
      return { runId, state: "blocked", reason, preflight: [], decisions: [] };
    }
    log(`${fields.length} fields (${fields.filter((f) => f.required).length} required)`);

    stage = "cover_letter";
    const clIntents = fields.map((f) => ({ f, intent: classifyField(f) })).filter((x) => x.intent === "cover_letter_file" || x.intent === "cover_letter_text");
    const clRequired = clIntents.some((x) => x.f.required);
    const coverLetter: CoverLetter | null =
      clIntents.length > 0
        ? await ensureCoverLetter({ app, dossier, lang, build: clRequired || process.env.PORTAL_COVER_LETTER === "always" }).catch(async (err) => {
            await logPortalError({ applicationId: app.id, runId, stage, error: err });
            return null;
          })
        : null;
    await updateRun(runId, {
      resume_id: resume.resume?.id ?? null,
      resume_path: resume.resume?.storage_path ?? null,
      resume_reason: resume.reason,
      cover_letter_path: coverLetter?.pdfPath ?? null,
      cover_letter_required: clRequired,
    });

    stage = "plan";
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
        resumePath: resume.resume && resume.fileExists ? resume.resume.storage_path : null,
        coverLetterPath: coverLetter?.pdfPath ?? null,
        coverLetterText: coverLetter?.text ?? null,
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
    };
    const decisions = mergeApprovals(await planFields(fields, ctx), previousFields);
    await saveFields(runId, decisions);
    const counts = () => ({
      field_count: decisions.length,
      required_count: decisions.filter((d) => d.required).length,
      manual_count: decisions.filter((d) => (d.status === "manual" && (d.required || d.value)) || (d.status === "generated" && !autoApprove)).length,
    });
    await updateRun(runId, counts());

    // Same rule as the preflight's cv_on_form, applied before anything is filled.
    if (!decisions.some((d) => d.intent === "resume")) {
      const reason =
        "This page has no CV upload: it is the first step of a multi-step portal, which the desk does not drive. Apply there yourself.";
      await saveChannel(app.id, "manual");
      await finishRun(runId, "blocked", { blocked_reason: reason, screenshot_path: await screenshot(page, runId, "no-cv") });
      await logWorkflow(app.id, "portal_plan", false, "no CV upload on the form");
      return { runId, state: "blocked", reason, preflight: [], decisions };
    }

    if (opts.mode === "plan") {
      const complete = await planIsComplete(runId, autoApprove);
      const state: RunState = complete ? "planned" : "needs_review";
      await finishRun(runId, state);
      await logWorkflow(app.id, "portal_plan", true, `${state}: ${counts().manual_count} to review`);
      return { runId, state, reason: complete ? "Every field is decided." : `${counts().manual_count} field(s) wait for you.`, preflight: [], decisions };
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
    await fillAll(fields);

    // Answering a question can reveal another ("If yes, please explain"). Two passes catch those.
    for (let pass = 0; pass < 2; pass++) {
      const again = await readFields(page, adapter);
      const known = new Set(decisions.map((d) => d.signature));
      const added = again.filter((f) => !known.has(f.signature));
      fields = again;
      if (added.length === 0) break;
      log(`${added.length} new field(s) appeared after filling`);
      const planned = mergeApprovals(await Promise.all(added.map((f) => planField(f, ctx))), previousFields);
      decisions.push(...planned);
      await fillAll(added);
    }

    stage = "validate";
    const requiredEmpty: string[] = [];
    for (const f of fields) {
      if (!f.required) continue;
      if (!(await currentValue(page, f))) requiredEmpty.push(f.label);
    }
    const captcha = await detectCaptcha(page);
    const formErrors = await visibleFormErrors(page);
    const freshApp = (await getApplication(app.id))!;
    const dupNow = await duplicateReason(freshApp, [target.url, page.url()]);

    let submitRequested = opts.mode === "submit";
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
      resumeFieldPresent: decisions.some((d) => d.intent === "resume"),
      coverLetter,
      coverLetterUsed: decisions.some((d) => (d.intent === "cover_letter_file" || d.intent === "cover_letter_text") && d.value),
      captcha,
      formErrors,
      duplicate: dupNow,
      isTarget: board.is_target,
      autoApprove,
      submitRequested,
      submitEnabled: submitEnabled(),
    });
    await saveFields(runId, decisions);
    const filledShot = await screenshot(page, runId, "filled");
    await updateRun(runId, { ...counts(), preflight, screenshot_path: filledShot });
    for (const item of preflight) log(`${item.ok ? "✓" : item.blocking ? "✗" : "!"} ${item.label}${item.detail ? `: ${item.detail}` : ""}`);

    const qualityOk = preflight.filter((i) => !["not_target", "submit_enabled"].includes(i.id)).every((i) => i.ok || !i.blocking);
    if (submitRequested && preflightPasses(preflight)) {
      stage = "submit";
      const outcome = await submitApplication(page, adapter, preflight);
      const shot = await screenshot(page, runId, outcome.state);
      if (outcome.state === "submitted") {
        await finishRun(runId, "submitted", { submitted_at: new Date(), confirmation_text: outcome.confirmation, screenshot_path: shot });
        await setApplicationStatus(app.id, "applied", `portal application submitted (${adapter.label})`);
        await logWorkflow(app.id, "portal_submit", true, outcome.confirmation);
        log(`submitted: ${outcome.confirmation}`);
        return { runId, state: "submitted", reason: outcome.confirmation, preflight, decisions };
      }
      // Never retried automatically: an unconfirmed click might have gone through.
      await finishRun(runId, "blocked", { blocked_reason: outcome.reason, screenshot_path: shot });
      await logWorkflow(app.id, "portal_submit", false, outcome.reason);
      if (opts.beforeClose) await opts.beforeClose(page);
      return { runId, state: "blocked", reason: outcome.reason, preflight, decisions };
    }

    const state: RunState = qualityOk ? "ready_to_submit" : "needs_review";
    const reason =
      limitNote ??
      (qualityOk
        ? "Filled and validated. Submit is left for you."
        : preflight.filter((i) => !i.ok && i.blocking).map((i) => i.label).join("; "));
    await updateRun(runId, { state, blocked_reason: qualityOk ? limitNote : reason });

    if (opts.beforeClose) {
      // The person may submit by hand in the open window: watch every page load for a confirmation,
      // since the page cannot be read any more once they close it.
      let confirmation: string | null = null;
      const watch = async () => {
        confirmation = confirmation ?? (await confirmationText(page!, adapter).catch(() => null));
      };
      page.on("load", () => void watch());
      await opts.beforeClose(page);
      await watch();
      if (confirmation) {
        await finishRun(runId, "submitted", { submitted_at: new Date(), confirmation_text: `${confirmation} (submitted by you)` });
        await setApplicationStatus(app.id, "applied", "portal application submitted by hand after assist");
        return { runId, state: "submitted", reason: confirmation, preflight, decisions };
      }
    }
    await finishRun(runId, state);
    return { runId, state, reason, preflight, decisions };
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
