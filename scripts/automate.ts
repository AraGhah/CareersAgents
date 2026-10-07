// Automatic mode — one process that runs discovery, inbox sync, and
// follow-ups on their own schedule so nobody has to click "Find Internships"
// or run a script by hand. Every morning (DAILY_AT, default 09:00, until DAILY_UNTIL, default 15:00) the careers-page
// run finds new companies, reads every careers board and fills the best forms,
// which then wait on /approvals for you (scripts/daily.ts); forms you approve are
// submitted by the approved queue, checked every 15 minutes too. Every qualifying job is auto-tracked, researched,
// matched to a real published contact, and has a personalized email drafted
// — see lib/workflow.ts's runFindInternships. Jobs with no published contact
// get their online form read and their answers drafted (portal plan, headless,
// read-only). Nothing here sends an email; a portal form is submitted only when
// PORTAL_SUBMIT=auto (or you approved it on /approvals) AND every field of its plan was decided (approved by
// you) AND the preflight passes. Stop it any time with Ctrl+C.
//
//   npx tsx scripts/automate.ts
//   npm run automate

import cron from "node-cron";
import { spawn } from "node:child_process";
import { pool } from "../lib/db";
import { runFindInternships } from "../lib/workflow";
import { submitMode } from "../lib/apply/submit";
import { museConfigured, notifyMuse } from "../lib/notify/muse";

function runScript(label: string, file: string): Promise<void> {
  return new Promise((resolve) => {
    console.log(`[${label}] starting…`);
    const child = spawn("npx", ["tsx", file], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    child.on("exit", (code) => {
      console.log(`[${label}] exited (code ${code ?? "?"})`);
      resolve();
    });
    child.on("error", (err) => {
      console.error(`[${label}] failed to start:`, err.message);
      resolve();
    });
  });
}

async function runDiscover() {
  console.log("[discover] starting…");
  try {
    const summary = await runFindInternships({ fresh: false });
    console.log(
      `[discover] done. new=${summary.inserted} updated=${summary.updated} ` +
        `qualified=${summary.qualified} prepared=${summary.prepared}`,
    );
    for (const note of summary.errors) console.log(`[discover]   note: ${note}`);
  } catch (err) {
    console.error("[discover] failed:", err instanceof Error ? err.message : err);
  }
}

const portalPlanOn = () => process.env.PORTAL_AUTO_PLAN?.trim().toLowerCase() !== "false";
// Only with PORTAL_SUBMIT=auto: with approve (the default) the approved queue below submits what you approved.
const portalSubmitOn = () => submitMode() === "auto";

async function runPortal() {
  if (portalPlanOn()) await runScript("portal-plan", "scripts/portal-apply.ts --queue plan");
  if (portalSubmitOn()) await runScript("portal-submit", "scripts/portal-apply.ts --queue submit");
}

const runSyncInbox = () => runScript("sync-inbox", "scripts/sync-inbox.ts");
const dailyUntil = () => process.env.DAILY_UNTIL?.trim() || "15:00";
const runDaily = () => runScript("daily", `scripts/daily.ts --until ${dailyUntil()}`);
const runApproved = () => runScript("approved", "scripts/portal-apply.ts --queue approved");
const dailyAt = () => process.env.DAILY_AT?.trim() || "0 9 * * *";
const runFollowups = () => runScript("followups", "scripts/process-followups.ts");

// With a Muse gadget (muse/README.md): keeps what `desk-status` shows on the Pi fresh between the runs that post news.
async function runMuseSnapshot() {
  const sent = await notifyMuse({ kind: "snapshot" });
  if (!sent.ok) console.error(`[muse] snapshot not delivered: ${sent.detail}`);
}

async function main() {
  console.log("Automatic mode.");
  console.log("  discover   — every 4h  (postings, matching, auto-track, research, draft)");
  console.log(`  portal     — after each discover: plan forms ${portalPlanOn() ? "on" : "off"}, submit approved plans ${portalSubmitOn() ? "ON" : "off"}`);
  console.log("  inbox sync — every 30m (Gmail replies matched to applications)");
  console.log("  follow-ups — daily 08:00 (day-7 / day-14 drafts)");
  console.log(`  careers    — ${dailyAt()} (cron) until ${dailyUntil()} or the tokens run out: new companies, every careers board, forms filled for /approvals`);
  console.log("  approved   — every 15m: submits the forms you approved on /approvals");
  if (museConfigured()) console.log("  muse       — hourly: the desk's snapshot to the Muse gadget (desk-status)");
  console.log("Drafts wait for your approval in the app. Ctrl+C to stop.\n");

  // Run each once immediately so results show up right away, then schedule.
  await runDiscover();
  await runPortal();
  await runSyncInbox();
  await runFollowups();

  cron.schedule("0 */4 * * *", () => {
    runDiscover()
      .then(runPortal)
      .catch((err) => console.error("[discover]", err));
  });
  cron.schedule("*/30 * * * *", () => {
    runSyncInbox().catch((err) => console.error("[sync-inbox]", err));
  });
  cron.schedule("0 8 * * *", () => {
    runFollowups().catch((err) => console.error("[followups]", err));
  });
  cron.schedule(dailyAt(), () => {
    runDaily().catch((err) => console.error("[daily]", err));
  });
  cron.schedule("*/15 * * * *", () => {
    runApproved().catch((err) => console.error("[approved]", err));
  });
  if (museConfigured()) {
    await runMuseSnapshot();
    cron.schedule("5 * * * *", () => {
      runMuseSnapshot().catch((err) => console.error("[muse]", err));
    });
  }
}

process.on("SIGINT", async () => {
  console.log("\nStopping automatic mode.");
  await pool.end();
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
