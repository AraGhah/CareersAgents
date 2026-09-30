// The Offres list against the database: the minimum score and the order really do what they say, on your own postings.
// Needs the database (and scores: npm run score). Changes nothing.
//   npm run jobs:check

import { pool } from "../lib/db";
import { listJobs } from "../lib/queries";

let failed = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${!ok && detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failed += 1;
}

/** The scores of the jobs that have one and are not skipped, in list order. */
const scored = (jobs: Array<{ score: string | null; gated: boolean | null }>) => jobs.filter((j) => !j.gated && j.score != null).map((j) => Number(j.score));
const nonIncreasing = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] >= x - 1e-9);
const nonDecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] <= x + 1e-9);

async function main() {
  const base = { includeSkipped: false };
  const byDefault = await listJobs(base);
  const all = await listJobs({ ...base, minScore: 0 });
  console.log(`default list: ${byDefault.length} jobs · every score: ${all.length} jobs\n`);

  console.log("the default");
  check(scored(byDefault).every((s) => s >= 0.6), "hides what scores under 60", scored(byDefault).filter((s) => s < 0.6));
  check(nonIncreasing(scored(byDefault)), "is ordered best to worst");
  check(all.length >= byDefault.length, "'every score' shows at least as many");
  check(scored(all).some((s) => s < 0.6) || all.length === byDefault.length, "…and brings back the ones under 60");

  console.log("\nminimum score");
  let previous = all.length;
  for (const min of [50, 70, 80, 85, 90]) {
    const jobs = await listJobs({ ...base, minScore: min, sort: "best" });
    const low = jobs.filter((j) => j.score != null && Number(j.score) < min / 100);
    check(low.length === 0, `${min} and over: nothing under ${min}`, low.map((j) => [j.title, j.score]));
    check(jobs.length <= previous, `…and never more than the looser cut (${jobs.length} ≤ ${previous})`);
    previous = jobs.length;
  }
  const strict = await listJobs({ includeSkipped: true, minScore: 70, sort: "best" });
  check(strict.every((j) => j.score == null || Number(j.score) >= 0.7), "an explicit minimum also applies to skipped jobs when they are shown", strict.filter((j) => j.score != null && Number(j.score) < 0.7).map((j) => j.score));

  console.log("\nthe order");
  const best = await listJobs({ ...base, minScore: 0, sort: "best" });
  const worst = await listJobs({ ...base, minScore: 0, sort: "worst" });
  check(nonIncreasing(scored(best)), "best first: scores never go up down the list");
  check(nonDecreasing(scored(worst)), "worst first: scores never go down down the list");
  check(best.length === worst.length && new Set(best.map((j) => j.id)).size === new Set(worst.map((j) => j.id)).size, "the same jobs either way, only the order differs");
  const skippedLast = (jobs: typeof best) => jobs.findIndex((j) => j.gated) === -1 || jobs.slice(jobs.findIndex((j) => j.gated)).every((j) => j.gated || j.score == null);
  const withSkipped = await listJobs({ includeSkipped: true, minScore: 0, sort: "worst" });
  check(skippedLast(withSkipped), "skipped jobs stay after the scored ones even when worst comes first");
  const recent = await listJobs({ ...base, minScore: 0, sort: "recent" });
  const seen = recent.map((j) => new Date(j.first_seen_at).getTime());
  check(seen.every((t, i) => i === 0 || seen[i - 1] >= t), "most recent first: first-seen dates never go up");
  const company = await listJobs({ ...base, minScore: 0, sort: "company" });
  const names = company.filter((j) => !j.gated && j.score != null).map((j) => j.company_name.toLowerCase());
  check(names.every((n, i) => i === 0 || names[i - 1] <= n || names[i - 1].localeCompare(n, "en") <= 0), "company A to Z");

  const top = best.filter((j) => !j.gated).slice(0, 3).map((j) => `${Math.round(Number(j.score) * 100)} ${j.company_name} · ${j.title.slice(0, 50)}`);
  console.log(`\nbest three: ${top.join("  |  ")}`);

  await pool.end();
  if (failed) {
    console.log(`\n${failed} list check(s) failed`);
    process.exit(1);
  }
  console.log("\njobs-list-check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
