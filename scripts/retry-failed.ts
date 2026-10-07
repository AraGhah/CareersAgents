// Runs again the applications whose last run stopped on something the desk can now get past: an employer account step
// (a Workday / portal account wall, a create-account that "did not go through" because the portal was slow), or a crash of
// the AI form agent (browser crash, out of API credit). Each is run like the daily batch does it: headless, accounts
// allowed, the form filled and left on /approvals. Nothing is submitted without your approval there.
// Not retried: CAPTCHAs, closed postings, "already applied", and questions only you can answer.
//   npm run retry:failed -- --dry        which applications, and why (changes nothing)
//   npm run retry:failed                 run them, one at a time; log in applications/_daily/retry-<date>.log

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pool } from "../lib/db";
import { runPortalApplication } from "../lib/apply/runner";
import { setApplicationStatus } from "../lib/queries";

const RETRYABLE =
  /creating the account did not go through|requires creating an account|asks you to sign in or create an account|requires signing in or creating an account|requires creating an account with a password|the ai form agent failed|browserType\.launch|target page, context or browser has been closed|target crashed|interrupted|could not sign in with the configured account|exists but is not verified/i;
// A closed posting, not a closed browser ("Target page, context or browser has been closed" is a crash, retried).
const NEVER = /captcha|posting is closed|(job|position|posting) (is |has been )?closed|a ferm[ée]|no longer|n'acceptons plus|pas disponible|already applied|d[ée]j[àa] postul/i;

type Row = { application_id: string; company_name: string; role_title: string; why: string; status: string };

async function candidates(): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `WITH latest AS (
       SELECT DISTINCT ON (r.application_id) r.application_id, r.company_name, r.role_title, r.state,
              COALESCE(r.blocked_reason, r.error, '') AS why
         FROM portal_runs r ORDER BY r.application_id, r.started_at DESC)
     SELECT l.application_id, l.company_name, l.role_title, l.why, a.status
       FROM latest l JOIN applications a ON a.id = l.application_id
      WHERE l.state IN ('blocked', 'failed', 'needs_review') AND a.status IN ('qualified', 'ready')
        AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = a.job_id AND j.closed_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM portal_runs s WHERE s.application_id = l.application_id AND s.state = 'submitted')`,
  );
  return rows.filter((r) => RETRYABLE.test(r.why) && !NEVER.test(r.why));
}

async function main() {
  const dry = process.argv.includes("--dry");
  const rows = await candidates();
  const dir = path.join("applications", "_daily");
  mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, `retry-${new Date().toISOString().slice(0, 10)}.log`);
  const out = (line: string) => {
    console.log(line);
    if (!dry) appendFileSync(logFile, `${line}\n`);
  };
  out(`${new Date().toISOString()} ${rows.length} application(s) to run again${dry ? " (dry run)" : ""}`);
  for (const [i, r] of rows.entries()) out(`  [${i + 1}] ${r.company_name} | ${r.role_title}\n      last stop: ${r.why.slice(0, 140)}`);
  if (dry) return;

  const tally: Record<string, number> = {};
  for (const [i, r] of rows.entries()) {
    out(`\n[${i + 1}/${rows.length}] ${r.company_name} | ${r.role_title}`);
    try {
      const run = await runPortalApplication(r.application_id, { mode: "review", headless: true, allowAccounts: true, log: (l) => out(`    ${l}`) });
      if (run.state === "ready_to_submit" && ["discovered", "qualified"].includes(r.status)) {
        await setApplicationStatus(r.application_id, "ready", "careers form filled again after the account fix, waiting for your approval");
      }
      tally[run.state] = (tally[run.state] ?? 0) + 1;
      out(`    → ${run.state}${run.filled ? ` (${run.filled} fields filled)` : ""}: ${run.reason.slice(0, 300)}`);
    } catch (err) {
      tally.error = (tally.error ?? 0) + 1;
      out(`    → error: ${(err as Error).message.split("\n")[0].slice(0, 300)}`);
    }
  }
  out(`\n${new Date().toISOString()} done: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
