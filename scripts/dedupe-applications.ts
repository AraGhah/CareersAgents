// Discovery used to track one application per posting, so a role listed on both Indeed and LinkedIn (or
// re-posted) became several applications. This finds those groups (same company, same role) among the
// applications you have not sent, keeps the most advanced one and removes the rest.
//   npx tsx scripts/dedupe-applications.ts           dry run: prints the groups, changes nothing
//   npx tsx scripts/dedupe-applications.ts --apply   removes the extras and writes what it removed to cache/
//
// An application with any activity (an email you approved, put in Gmail or sent, a portal run that went past
// planning, an answer you approved, a reply, a follow-up) is never removed. What the desk did by itself does
// not count: a plan-only portal run (read the form, nothing filled) and an email draft nobody approved. If you already sent one of a role, its unsent copies are removed: applying again is the mistake.
// The job rows stay; only the extra application rows go, and they are not created again (workflow.ts).
// Files under applications/ are left where they are.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../lib/db";
import { twinKey } from "../lib/apply/dedupe";
import { ACTIVITY_SQL, OPEN_STATUSES, SENT_STATUSES } from "../lib/apply/activity";

const APPLY = process.argv.includes("--apply");
const SENT = new Set<string>(SENT_STATUSES);
const OPEN: string[] = [...OPEN_STATUSES];

type Row = {
  id: string;
  status: string;
  channel: string | null;
  job_id: string;
  company_id: string;
  company: string;
  title: string;
  source: string | null;
  location: string | null;
  apply_url: string | null;
  first_seen_at: Date;
  activity: number;
};

/** Higher is better: more progress, then a form we can drive, then the earlier find. */
function rank(r: Row): [number, number, number, number] {
  return [
    r.activity > 0 ? 1 : 0,
    OPEN.indexOf(r.status),
    (r.apply_url ? 1 : 0) + (r.channel && r.channel !== "manual" ? 1 : 0),
    -new Date(r.first_seen_at).getTime(),
  ];
}

function better(a: Row, b: Row): number {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
  return a.id.localeCompare(b.id);
}

const label = (r: Row) => `${r.id.slice(0, 8)}  ${r.status.padEnd(10)} ${(r.channel ?? "-").padEnd(7)} ${(r.source ?? "?").padEnd(9)} ${r.location ?? ""}`;

async function main() {
  console.log(APPLY ? "APPLY: removing the extra applications\n" : "DRY RUN: nothing is changed (add --apply)\n");

  const { rows } = await pool.query<Row>(
    `SELECT a.id, a.status, a.channel, j.id AS job_id, j.company_id, c.name AS company, j.title, j.source,
            j.location, j.apply_url, j.first_seen_at,
            ${ACTIVITY_SQL} AS activity
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id`,
  );

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = twinKey(r.company_id, r.title);
    if (key) groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const remove: Row[] = [];
  let kept = 0;
  let groupsFound = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sent = list.filter((r) => SENT.has(r.status));
    const open = list.filter((r) => OPEN.includes(r.status)).sort(better);
    if (open.length === 0 || (sent.length === 0 && open.length < 2)) continue;

    groupsFound += 1;
    const keeper = sent.length ? null : open[0];
    const extras = open.filter((r) => r !== keeper);
    const removable = extras.filter((r) => r.activity === 0);
    const busy = extras.filter((r) => r.activity > 0);

    console.log(`${list[0].company} · ${list[0].title}`);
    for (const s of sent) console.log(`   sent    ${label(s)}`);
    if (keeper) console.log(`   keep    ${label(keeper)}`);
    for (const r of removable) console.log(`   remove  ${label(r)}`);
    for (const r of busy) console.log(`   kept    ${label(r)}  (has activity: an approved or sent email, a fill or submit run, an approved answer, a reply or a follow-up)`);
    remove.push(...removable);
    kept += busy.length;
  }

  console.log(`\n${groupsFound} role(s) tracked more than once: ${remove.length} extra application(s) to remove, ${kept} left alone because they have activity.`);

  if (APPLY && remove.length) {
    const ids = remove.map((r) => r.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM status_events WHERE application_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM applications WHERE id = ANY($1::uuid[])`, [ids]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    await mkdir("cache", { recursive: true });
    const file = path.join("cache", `dedupe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, JSON.stringify(remove, null, 2));
    console.log(`Removed ${ids.length}. What was removed is listed in ${file}.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
