"use server";

// The "Postuler automatiquement" button. The work runs in its own process (scripts/auto-apply.ts), not in the Next
// server: a batch takes minutes, drives a browser for online forms, and has to outlive the request that started it.
// Progress is written to the database as it goes and the page reads it from there.

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gmailWorks } from "../lib/gmail";
import { isGmailAuthError } from "../lib/auto-apply/apply";
import { configuredMinScore } from "../lib/auto-apply/select";
import { syncSentDrafts } from "../lib/auto-apply/sent";
import { createRun, finishRun, requestStop } from "../lib/auto-apply/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function launch(runId: string): void {
  // The id goes on a command line: only a well-formed UUID is accepted.
  if (!UUID.test(runId)) throw new Error("invalid run id");
  const dir = path.join("applications", "_auto-apply");
  mkdirSync(dir, { recursive: true });
  const logFile = openSync(path.join(dir, `${runId}.log`), "a");
  const child = spawn("npx", ["tsx", "scripts/auto-apply.ts", "--run", runId], {
    cwd: process.cwd(),
    shell: true,
    detached: true,
    stdio: ["ignore", logFile, logFile],
    // Unattended: online forms are filled in a hidden browser, so no window pops up while you work.
    env: { ...process.env, PORTAL_HEADLESS: "true" },
    windowsHide: true,
  });
  child.unref();
}

/** Asks how many (a whole number from 1 to 50), then starts the batch in the background and shows its progress. */
export async function startAutoApplyAction(form: FormData) {
  const raw = form.get("count");
  const count = typeof raw === "string" && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!(count >= 1 && count <= 50)) redirect("/auto-apply?error=count");

  // Asks Google, not just the token file: an expired authorization would otherwise fail on the first email.
  if (!(await gmailWorks()).ok) redirect("/auto-apply?error=gmail");

  let runId: string | null = null;
  try {
    runId = await createRun(count, configuredMinScore());
  } catch {
    // Only "a batch is already running" is expected here.
    redirect("/auto-apply?error=busy");
  }

  try {
    launch(runId);
  } catch (err) {
    await finishRun(runId, "failed", `Le processus n'a pas pu démarrer : ${err instanceof Error ? err.message : String(err)}`);
  }
  revalidatePath("/auto-apply");
  redirect(`/auto-apply?run=${runId}`);
}

export async function stopAutoApplyAction(form: FormData) {
  const runId = form.get("runId");
  if (typeof runId !== "string" || !UUID.test(runId)) throw new Error("invalid run id");
  await requestStop(runId);
  revalidatePath("/auto-apply");
  redirect(`/auto-apply?run=${runId}`);
}

export type SentCheck = { checked: number; sent: number; waiting: number; deleted: number; error?: string };

/** Looks in Gmail for drafts you have sent since, and moves those applications to "Envoyé". Called by the page itself while it is open. */
export async function checkSentAction(): Promise<SentCheck> {
  try {
    const r = await syncSentDrafts();
    if (r.sent > 0) {
      revalidatePath("/auto-apply");
      revalidatePath("/pipeline");
      revalidatePath("/board");
      revalidatePath("/");
    }
    return { checked: r.checked, sent: r.sent, waiting: r.waiting, deleted: r.deleted, error: r.errors[0] };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return {
      checked: 0,
      sent: 0,
      waiting: 0,
      deleted: 0,
      error: isGmailAuthError(err) ? "l’autorisation a expiré : lance « npm run gmail:auth »." : raw,
    };
  }
}
