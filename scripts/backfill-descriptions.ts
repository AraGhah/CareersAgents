// Fills jobs.description for postings that have none, without spending anything:
//   1. from the Apify results already saved in cache/discover/: an actor's description that arrived nested
//      ({ text, html }, Indeed's) used to be dropped by the parser and is read now;
//   2. from the copy of the same role on another source (Indeed's text for a LinkedIn posting).
//   npx tsx scripts/backfill-descriptions.ts           dry run: says what it would fill
//   npx tsx scripts/backfill-descriptions.ts --apply   fills them
// Then `npm run score` matches every posting against your CV again.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../lib/db";
import { normalizeJobItem } from "../lib/sources-external";
import { fillDescriptionsFromTwins } from "../lib/match/enrich";

const APPLY = process.argv.includes("--apply");
const DIR = path.join("cache", "discover");

async function main() {
  console.log(APPLY ? "APPLY: filling descriptions\n" : "DRY RUN: nothing is written (add --apply)\n");
  const files = (await readdir(DIR)).filter((f) => /^(indeed|linkedin)-apify-.*\.json$/.test(f));

  let fromCache = 0;
  for (const file of files) {
    const source = file.startsWith("indeed") ? "indeed" : "linkedin";
    const parsed = JSON.parse(await readFile(path.join(DIR, file), "utf8")) as { payload: unknown };
    const items = Array.isArray(parsed.payload) ? parsed.payload : ((parsed.payload as { items?: unknown[] })?.items ?? []);
    let usable = 0;
    let wouldFill = 0;
    for (const raw of items) {
      const job = normalizeJobItem(raw, source);
      if (!job?.description || job.description.length < 60) continue;
      usable += 1;
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM jobs WHERE external_id = $1 AND description IS NULL`,
        [job.externalId],
      );
      if (!rows[0]) continue;
      wouldFill += 1;
      if (APPLY) await pool.query(`UPDATE jobs SET description = $2 WHERE id = $1`, [rows[0].id, job.description]);
    }
    fromCache += wouldFill;
    console.log(`${file}: ${items.length} items, ${usable} with text, ${wouldFill} ${APPLY ? "filled" : "to fill"}`);
  }

  const twinsBefore = await pool.query<{ n: string }>(`SELECT count(*)::text n FROM jobs WHERE closed_at IS NULL AND description IS NULL`);
  const twins = APPLY ? await fillDescriptionsFromTwins() : null;
  const after = await pool.query<{ n: string; total: string }>(
    `SELECT count(*) FILTER (WHERE description IS NULL)::text n, count(*)::text total FROM jobs WHERE closed_at IS NULL`,
  );
  console.log(
    `\nFrom the saved results: ${fromCache} ${APPLY ? "filled" : "to fill"}.` +
      (APPLY ? ` From the same role on another source: ${twins} filled.` : " (the same-role copy step runs with --apply)") +
      `\nOpen postings with no description: ${twinsBefore.rows[0].n} before, ${after.rows[0].n} now, of ${after.rows[0].total}.`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
