// A CV can only be matched against a posting's text. Many postings arrive without any (LinkedIn's actor returns
// none unless it opens every listing), so before scoring the text is filled from what is already known, free:
//   - the copy of the same role on another source (Indeed nearly always carries the full text)
// The descriptions Apify already returned and the desk dropped are recovered by scripts/backfill-descriptions.ts.

import { pool } from "../db";
import { twinKey } from "../apply/dedupe";

/**
 * Gives every open posting with no description the text of its twin: the same role at the same company on another
 * source. Only postings without a text are touched, and only from a twin that has one. Returns how many were filled.
 */
export async function fillDescriptionsFromTwins(): Promise<number> {
  const { rows } = await pool.query<{ id: string; company_id: string; title: string; description: string | null }>(
    `SELECT id, company_id, title, description FROM jobs WHERE closed_at IS NULL`,
  );

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = twinKey(row.company_id, row.title);
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let filled = 0;
  for (const group of groups.values()) {
    const source = group
      .filter((r) => (r.description?.length ?? 0) > 200)
      .sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0];
    if (!source) continue;
    for (const row of group) {
      if (row.description) continue;
      await pool.query(`UPDATE jobs SET description = $2 WHERE id = $1 AND description IS NULL`, [row.id, source.description]);
      filled += 1;
    }
  }
  return filled;
}
