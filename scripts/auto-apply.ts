// "Postuler automatiquement" from the command line (the desk's button starts this same script in the background).
//   npm run auto-apply -- --dry [--count 5]     who would be picked, best score first. Changes nothing.
//   npm run auto-apply -- --count 5             apply to 5 postings, best score first
//   npm run auto-apply -- --run <uuid>          work through a run the desk already created (what the button does)
// Flags: --min 70 (lowest match score, default AUTO_APPLY_MIN_SCORE or 60), --headed (show the browser for online forms).
//
// Email postings become Gmail DRAFTS with the CV and cover letter attached: you press Send. Online forms are submitted
// only with PORTAL_ALLOW_SUBMIT=true and when every preflight gate passes. Nothing is ever sent by this script.

import { pool } from "../lib/db";
import { usageSummary } from "../lib/claude";
import { gmailWorks } from "../lib/gmail";
import { submitEnabled } from "../lib/apply/submit";
import { configuredMinScore, rankedCandidates } from "../lib/auto-apply/select";
import { createRun } from "../lib/auto-apply/store";
import { lookLimit, runAutoApply } from "../lib/auto-apply/run";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function intArg(name: string, fallback: number, min: number, max: number): number {
  const raw = arg(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be a whole number from ${min} to ${max} (got ${raw})`);
  return n;
}

async function main() {
  // An unattended batch should not pop browser windows; --headed brings them back.
  if (!flag("headed")) process.env.PORTAL_HEADLESS ??= "true";

  const runId = arg("run");
  if (runId) {
    const { counted, note } = await runAutoApply(runId, { log: (line) => console.log(line) });
    console.log(`\n${counted} application(s). ${note}`);
    return;
  }

  const count = intArg("count", 5, 1, 50);
  const minPercent = intArg("min", configuredMinScore(), 0, 100);

  if (flag("dry")) {
    const list = await rankedCandidates({ minPercent, limit: lookLimit(count) });
    console.log(`Best-scored postings at ${minPercent}+ (${list.length} looked at; ${count} wanted). Nothing is changed.\n`);
    for (const c of list) {
      const where = c.channel ?? (c.application_id ? "?" : "new");
      console.log(`${String(Math.round(c.score * 100)).padStart(3)}  ${where.padEnd(6)} ${c.company_name} | ${c.title}`);
    }
    const gmail = await gmailWorks();
    console.log(
      `\nGmail: ${gmail.ok ? "working" : `NOT working (${gmail.reason}): run npm run gmail:auth`} · online forms: ${submitEnabled() ? "submitted" : "not submitted (PORTAL_ALLOW_SUBMIT is off)"}`,
    );
    return;
  }

  const gmail = await gmailWorks();
  if (!gmail.ok) throw new Error(`Gmail refuses the connection (${gmail.reason}): run \`npm run gmail:auth\` first, so the drafts can be made.`);
  const id = await createRun(count, minPercent);
  console.log(`Run ${id}: applying to ${count}, best score first (${minPercent}+).\n`);
  const { counted, note } = await runAutoApply(id, { log: (line) => console.log(line) });
  console.log(`\n${counted} application(s). ${note}`);
}

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
