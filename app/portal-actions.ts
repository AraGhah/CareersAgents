"use server";

// Buttons of the portal panel on an application page. The browser work runs in
// its own process (scripts/portal-apply.ts) rather than inside the Next server:
// Playwright does not belong in the app bundle, and a visible browser has to
// outlive the request that opened it.

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isJobBoardUrl } from "../lib/apply/apply-url";
import { decideChannel, saveChannel } from "../lib/apply/route";
import { approveField, getRun, pendingCount, planIsComplete, updateRun } from "../lib/apply/store";
import type { Lang } from "../lib/apply/types";
import { pool } from "../lib/db";
import { getApplication } from "../lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = new Set(["plan", "review", "submit"]);

function field(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`${key} is required`);
  return v.trim();
}

function uuid(form: FormData, key: string): string {
  const v = field(form, key);
  // The id goes on a command line: only a well-formed UUID is accepted.
  if (!UUID.test(v)) throw new Error(`${key} is not a valid id`);
  return v;
}

function launch(applicationId: string, mode: string, opts: { wait: boolean }): Promise<number | null> {
  if (!UUID.test(applicationId) || !MODES.has(mode)) throw new Error("invalid portal launch");
  const dir = path.join("applications", "_portal");
  mkdirSync(dir, { recursive: true });
  const logFile = openSync(path.join(dir, `${applicationId}-${mode}.log`), "a");
  const args = ["tsx", "scripts/portal-apply.ts", "--application", applicationId, "--mode", mode, ...(mode === "plan" ? [] : ["--keep-open"])];
  const child = spawn("npx", args, {
    cwd: process.cwd(),
    shell: true,
    detached: !opts.wait,
    stdio: ["ignore", logFile, logFile],
    env: process.env,
    windowsHide: mode === "plan",
  });
  if (!opts.wait) {
    child.unref();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 6 * 60 * 1000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/** Read the form and draft every answer, headless. Waits for the result (a minute or two with written answers). */
export async function planPortalAction(form: FormData) {
  const applicationId = uuid(form, "applicationId");
  const code = await launch(applicationId, "plan", { wait: true });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/portal");
  redirect(`/applications/${applicationId}?portal=${code === 0 ? "planned" : "plan-failed"}#portail`);
}

/**
 * The company's own posting, pasted by hand for a role the desk could not find on the company's site. It is kept
 * on the job, the application is re-routed, and the form is read from there. A LinkedIn or Indeed link is refused:
 * those are the copies this exists to get away from.
 */
export async function setFormUrlAction(form: FormData) {
  const applicationId = uuid(form, "applicationId");
  let url: URL | null = null;
  try {
    url = new URL(field(form, "formUrl"));
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || isJobBoardUrl(url.toString())) {
    redirect(`/applications/${applicationId}?portal=form-invalid#portail`);
  }
  const app = await getApplication(applicationId);
  if (!app) throw new Error("application not found");

  await pool.query(`UPDATE jobs SET apply_url = $2 WHERE id = $1`, [app.job_id, url.toString()]);
  const decision = await decideChannel(app, { applyUrl: url.toString() });
  await saveChannel(applicationId, decision.channel);
  // A portal form is read now; an account portal only records why it stays yours (with this link).
  const code = await launch(applicationId, "plan", { wait: true });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/portal");
  const flash = decision.channel !== "portal" ? "form-manual" : code === 0 ? "planned" : "plan-failed";
  redirect(`/applications/${applicationId}?portal=${flash}#portail`);
}

/** Open a visible browser that fills the form. "review" leaves Submit to you; "submit" submits only if every gate passes. */
export async function runPortalAction(form: FormData) {
  const applicationId = uuid(form, "applicationId");
  const mode = field(form, "mode");
  if (mode !== "review" && mode !== "submit") throw new Error("mode must be review or submit");
  await launch(applicationId, mode, { wait: false });
  redirect(`/applications/${applicationId}?portal=launched-${mode}#portail`);
}

/**
 * "Continuer à la main": a visible browser re-opens the form, fills again everything already decided, goes through the
 * pages that were complete, and stops on the page that needs you, leaving the window to you. An application you submit
 * there is recorded. Back to the page the button was on (the auto-apply batch, or the application).
 */
export async function continuePortalAction(form: FormData) {
  const applicationId = uuid(form, "applicationId");
  const back = typeof form.get("back") === "string" ? String(form.get("back")) : "";
  await launch(applicationId, "review", { wait: false });
  revalidatePath("/auto-apply");
  // Only a path inside the desk is followed back to.
  if (/^\/auto-apply(\?run=[0-9a-f-]{36})?$/i.test(back)) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}continued=${applicationId}#lot`);
  }
  redirect(`/applications/${applicationId}?portal=launched-review#portail`);
}

/** Approve one field (a drafted answer as-is or rewritten, or a value you typed for a manual question). */
export async function approvePortalFieldAction(form: FormData) {
  const applicationId = uuid(form, "applicationId");
  const runId = uuid(form, "runId");
  const fieldId = uuid(form, "fieldId");
  const lang = (field(form, "lang") === "fr" ? "fr" : "en") as Lang;
  const raw = form.get("value");
  const value = typeof raw === "string" ? raw : "";
  if (!value.trim()) throw new Error("An empty answer cannot be approved: leave the field for the form or write something.");
  await approveField({ fieldId, value, applicationId, lang });

  const run = await getRun(runId);
  if (run && ["needs_review", "planned"].includes(run.state)) {
    const autoApprove = process.env.PORTAL_AUTO_APPROVE_ANSWERS?.trim().toLowerCase() === "true";
    const complete = await planIsComplete(runId, autoApprove);
    await updateRun(runId, { state: complete ? "planned" : "needs_review", manual_count: await pendingCount(runId, autoApprove) });
  }
  revalidatePath(`/applications/${applicationId}`);
  redirect(`/applications/${applicationId}?portal=approved#portail`);
}
