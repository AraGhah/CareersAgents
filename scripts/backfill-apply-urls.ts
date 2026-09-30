// Fills jobs.apply_url for postings discovered before discovery kept it: reads the
// cached LinkedIn/Indeed actor results in cache/discover/ and stores each posting's
// link to the company's own application form. Shows what it would do; --apply writes.
//   npx tsx scripts/backfill-apply-urls.ts [--apply]

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../lib/db";
import { resolveApplyTarget } from "../lib/apply/apply-url";
import { manualOnlyReason } from "../lib/apply/platforms";
import { getApplication } from "../lib/queries";
import { normalizeJobItem } from "../lib/sources-external";

const DIR = path.join("cache", "discover");

async function main() {
  const apply = process.argv.includes("--apply");
  const files = (await readdir(DIR)).filter((f) => /^(linkedin|indeed)-apify-.*\.json$/.test(f));
  let found = 0;
  let updated = 0;
  for (const file of files) {
    const source = file.split("-")[0];
    const { payload } = JSON.parse(await readFile(path.join(DIR, file), "utf8")) as { payload: unknown[] };
    for (const raw of payload ?? []) {
      const job = normalizeJobItem(raw, source);
      if (!job?.applyUrl) continue;
      found++;
      if (!apply) continue;
      const res = await pool.query(`UPDATE jobs SET apply_url = $2 WHERE external_id = $1 AND apply_url IS DISTINCT FROM $2`, [
        job.externalId,
        job.applyUrl,
      ]);
      updated += res.rowCount ?? 0;
    }
  }
  console.log(`${found} cached posting(s) link to a company form${apply ? `; ${updated} job row(s) updated` : " (dry run: add --apply to store)"}.`);

  // What that means for the applications still waiting, whichever way the link was found.
  const { rows } = await pool.query<{ id: string }>(
    `SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.status IN ('qualified', 'ready')
        AND NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.company_id = j.company_id AND ct.email IS NOT NULL)`,
  );
  const tally = new Map<string, number>();
  for (const { id } of rows) {
    const app = await getApplication(id);
    if (!app) continue;
    const target = await resolveApplyTarget(app);
    const manual = manualOnlyReason(target.url);
    const bucket = manual ? `manual: ${manual.split(":")[0].split(" need")[0]}` : `portal via ${target.via}`;
    tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
  }
  console.log(`\n${rows.length} waiting application(s) without a published contact:`);
  for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => undefined));
