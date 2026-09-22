// Score every posting from text. Same keywords, same numbers, every run.
//   npx tsx scripts/score.ts
//   npx tsx scripts/score.ts --check     (no database, just the two invariants)

import {
  COMPONENT_NAMES,
  checkScoring,
  scoreJob,
  setHaveSkills,
  type ComponentName,
} from "../lib/score";
import type { WorkplaceType } from "../lib/types";

const CHECK = process.argv.includes("--check");

type JobToScore = {
  id: string;
  title: string;
  location: string | null;
  workplace_type: WorkplaceType | null;
  description: string | null;
  company_name: string;
  company_city: string | null;
};

async function run() {
  const { pool } = await import("../lib/db");
  const { getActiveSkills } = await import("../lib/resumes");
  const skills = await getActiveSkills();
  setHaveSkills(skills);
  console.log(`Using ${skills.length} skills from active resume profile`);

  const scoredAt = new Date();
  const { rows } = await pool.query<JobToScore>(
    `SELECT j.id, j.title, j.location, j.workplace_type, j.description,
            c.name AS company_name, c.city AS company_city
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      ORDER BY c.name, j.title`,
  );

  console.log(`Scoring ${rows.length} postings at ${scoredAt.toISOString()}`);

  let high = 0;
  let mid = 0;
  let ok = 0;
  let low = 0;
  let skipped = 0;

  for (const job of rows) {
    const result = scoreJob({
      title: job.title,
      location: job.location,
      workplaceType: job.workplace_type,
      description: job.description,
      companyCity: job.company_city,
    });

    for (const name of COMPONENT_NAMES) {
      await pool.query(
        `INSERT INTO job_scores (job_id, scored_at, component, raw_value, weight)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          job.id,
          scoredAt,
          name,
          result.components[name as ComponentName],
          result.weights[name as ComponentName],
        ],
      );
    }

    if (result.band === "high") high += 1;
    else if (result.band === "mid") mid += 1;
    else if (result.band === "ok") ok += 1;
    else if (result.band === "low") low += 1;
    else skipped += 1;

    const gate = result.gated ? " skip" : "";
    console.log(
      `${job.company_name} · ${job.title} → ${result.percent}${gate}` +
        `  (skills ${result.components.skills}, loc ${result.components.location}, ` +
        `time ${result.components.timing})`,
    );
  }

  console.log(
    `Done. ${high} first band, ${mid} second, ${ok} shown, ${low} hidden (<60), ${skipped} skipped.`,
  );
  await pool.end();
}

async function main() {
  if (CHECK) {
    for (const line of checkScoring()) console.log(line);
    return;
  }

  await run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
