// Automatic mode — one process that runs discovery, inbox sync, and
// follow-ups on their own schedule so nobody has to click "Find Internships"
// or run a script by hand. Every qualifying job is auto-tracked, researched,
// matched to a real published contact, and has a personalized email drafted
// — see lib/workflow.ts's runFindInternships. Nothing here ever sends an
// email or submits a form: drafts wait in Gmail for you to approve, exactly
// like the manual buttons in the app. Stop it any time with Ctrl+C.
//
//   npx tsx scripts/automate.ts
//   npm run automate

import cron from "node-cron";
import { spawn } from "node:child_process";
import { pool } from "../lib/db";
import { runFindInternships } from "../lib/workflow";

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

const runSyncInbox = () => runScript("sync-inbox", "scripts/sync-inbox.ts");
const runFollowups = () => runScript("followups", "scripts/process-followups.ts");

async function main() {
  console.log("Automatic mode.");
  console.log("  discover   — every 4h  (postings, matching, auto-track, research, draft)");
  console.log("  inbox sync — every 30m (Gmail replies matched to applications)");
  console.log("  follow-ups — daily 08:00 (day-7 / day-14 drafts)");
  console.log("Drafts wait for your approval in the app — nothing sends itself. Ctrl+C to stop.\n");

  // Run each once immediately so results show up right away, then schedule.
  await runDiscover();
  await runSyncInbox();
  await runFollowups();

  cron.schedule("0 */4 * * *", () => {
    runDiscover().catch((err) => console.error("[discover]", err));
  });
  cron.schedule("*/30 * * * *", () => {
    runSyncInbox().catch((err) => console.error("[sync-inbox]", err));
  });
  cron.schedule("0 8 * * *", () => {
    runFollowups().catch((err) => console.error("[followups]", err));
  });
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
