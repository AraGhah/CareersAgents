// The daily careers-page run (lib/registry/daily.ts): new companies, every careers board read, the best forms filled and
// left on /approvals for your yes. `npm run automate` runs it every morning; this runs it now.
//   npm run daily                      find, prepare, and fill DAILY_APPLY_COUNT (default 10) forms for approval
//   npm run daily -- --count 5         fill 5
//   npm run daily -- --count 0         find and prepare only, no browser
//   npm run daily -- --lookups 40      read 40 careers sites of companies with no board yet (default 25)
//   npm run daily -- --until 15:00     keep filling forms, batch after batch, until 15:00 or until the Claude tokens are
//                                      finished (DAILY_TOKEN_BUDGET, or the account's credit); DAILY_UNTIL sets the default
// The scheduled task (scripts/daily-task.ps1) and `npm run automate` start it at 9:00 with --until 15:00.
// Nothing is submitted here with PORTAL_SUBMIT=approve (the default): approving on /approvals does that.
// With MUSE_BRIDGE_URL set, the summary also goes to your Muse chat (lib/notify/muse.ts, muse/README.md).

import { pool } from "../lib/db";
import { usageSummary } from "../lib/claude";
import { dailyCount, runDaily, todayAt } from "../lib/registry/daily";
import { registryReady } from "../lib/registry/store";
import { dailyRunMessage, museConfigured, notifyMuse } from "../lib/notify/muse";

function argText(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return (i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)) ?? null;
}

function intArg(name: string, fallback: number, min: number, max: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const raw = i >= 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be a whole number from ${min} to ${max} (got ${raw})`);
  return n;
}

async function main() {
  if (!(await registryReady())) {
    throw new Error("The careers registry is missing: apply schema-v17.sql first (see README, \"Careers page first\").");
  }
  const untilText = argText("until") ?? process.env.DAILY_UNTIL?.trim() ?? null;
  const until = untilText ? todayAt(untilText) : null;
  if (untilText && !until) {
    console.log(`It is already past ${untilText} (or "${untilText}" is not a time like 15:00): nothing to do today.`);
    return;
  }
  const started = Date.now();
  const options = {
    until,
    count: intArg("count", dailyCount(), 0, 50),
    lookups: intArg("lookups", 25, 0, 200),
    log: (line: string) => console.log(line),
  };
  let summary: Awaited<ReturnType<typeof runDaily>>;
  try {
    summary = await runDaily(options);
  } catch (err) {
    // A run that never started (another one holds the lock) is not news; one that broke is.
    if (museConfigured() && !/already working/.test(err instanceof Error ? err.message : "")) {
      await notifyMuse({ kind: "daily_failed", text: `Internship desk: today's careers run stopped with an error: ${err instanceof Error ? err.message : String(err)}` });
    }
    throw err;
  }
  const r = summary.registry;
  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 60000)} min. Registry: ${r.active} active board(s) at ${r.companies} compan${r.companies === 1 ? "y" : "ies"} ` +
      `(${r.byPlatform.map((p) => `${p.platform} ${p.n}`).join(", ")}).`,
  );
  console.log(`Ended: ${summary.ended}.${summary.filled ? ` ${summary.filled.counted} form(s) filled in ${summary.filled.batches} batch(es).` : ""}`);
  console.log(`${summary.waitingApproval} careers form(s) wait for your approval: http://127.0.0.1:3001/approvals`);
  if (summary.discovery.notes.length) {
    console.log(`\nNotes (${summary.discovery.notes.length}):`);
    for (const n of summary.discovery.notes.slice(0, 15)) console.log(`  ${n}`);
  }
  if (museConfigured()) {
    const sent = await notifyMuse({
      kind: "daily_run",
      text: dailyRunMessage({
        newCompanies: summary.expand.newCompanies.length,
        newJobs: summary.discovery.inserted,
        filled: summary.filled?.counted ?? null,
        waitingApproval: summary.waitingApproval,
        ended: summary.ended,
      }),
    });
    console.log(sent.ok ? "Summary sent to Muse." : `Muse: not delivered (${sent.detail}).`);
  }
}

// A long batch drives many employer pages; one that closes itself mid-read can leave a stray rejected promise behind (a page
// listener, a background read). The application it belonged to is already recorded as failed: the batch goes on.
process.on("unhandledRejection", (err) => {
  console.error(`(ignored, the batch goes on) ${err instanceof Error ? err.message : String(err)}`);
});

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    const used = usageSummary();
    if (used) console.log(`\n${used}`);
    return pool.end().catch(() => undefined);
  });
