// Removes applications for roles you do not want, now that the match can tell: cybersecurity (never wanted) and roles
// outside software development (mechanical, tax, instructional design...). These were tracked when the score could not
// read a posting; they are skipped now and would only crowd the pipeline.
//   npx tsx scripts/prune-applications.ts           dry run: lists what it would remove, changes nothing
//   npx tsx scripts/prune-applications.ts --apply   removes them, and writes what it removed to cache/
//   npx tsx scripts/prune-applications.ts --all     also the ones skipped for a wrong term or place (summer roles...)
//
// Only applications you have not sent and have done nothing on are removed (see lib/apply/activity.ts). The job rows stay,
// and they are not tracked again: discovery no longer stores cybersecurity roles and scoring skips the rest.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../lib/db";
import { ACTIVITY_SQL, OPEN_STATUSES, SENT_STATUSES } from "../lib/apply/activity";
import { loadActiveCv } from "../lib/resumes";
import { scoreJob } from "../lib/score";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

type Row = {
  id: string;
  status: string;
  company: string;
  title: string;
  location: string | null;
  workplace_type: "onsite" | "hybrid" | "remote" | null;
  description: string | null;
  company_city: string | null;
  activity: number;
};

async function main() {
  console.log(APPLY ? "APPLY: removing the applications listed\n" : "DRY RUN: nothing is changed (add --apply)\n");
  await loadActiveCv();
  const { rows } = await pool.query<Row>(
    `SELECT a.id, a.status, c.name AS company, j.title, j.location, j.workplace_type, j.description, c.city AS company_city,
            ${ACTIVITY_SQL} AS activity
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      ORDER BY c.name, j.title`,
  );

  const groups = { cybersecurity: [] as Row[], offTarget: [] as Row[], term: [] as Row[], place: [] as Row[] };
  const sent: Row[] = [];
  const busy: Row[] = [];
  for (const r of rows) {
    const s = scoreJob({ title: r.title, location: r.location, workplaceType: r.workplace_type, description: r.description, companyCity: r.company_city });
    const unwanted = s.report.cybersecurity ? "cybersecurity" : s.components.role === 0 ? "offTarget" : s.components.timing === 0 ? "term" : s.components.location === 0 ? "place" : null;
    if (!unwanted) continue;
    if ((SENT_STATUSES as readonly string[]).includes(r.status)) sent.push(r);
    else if (!(OPEN_STATUSES as readonly string[]).includes(r.status)) continue;
    else if (r.activity > 0) busy.push(r);
    else groups[unwanted].push(r);
  }

  const show = (label: string, list: Row[], note = "") => {
    if (!list.length) return;
    console.log(`${label} (${list.length})${note}`);
    for (const r of list) console.log(`   ${r.company.slice(0, 16).padEnd(16)} ${r.title.slice(0, 84)}`);
    console.log();
  };
  show("Cybersecurity", groups.cybersecurity);
  show("Not software development", groups.offTarget);
  show("Wrong term or place", [...groups.term, ...groups.place], ALL ? "" : "  — left alone without --all");
  show("Already sent, never touched", sent, "  — check these: they are roles you said you do not want");
  show("Has work of yours on it, kept", busy);

  const remove = [...groups.cybersecurity, ...groups.offTarget, ...(ALL ? [...groups.term, ...groups.place] : [])];
  console.log(`${remove.length} application(s) to remove.`);

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
    const file = path.join("cache", `prune-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, JSON.stringify(remove.map(({ id, status, company, title }) => ({ id, status, company, title })), null, 2));
    console.log(`Removed ${ids.length}. What was removed is listed in ${file}.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
