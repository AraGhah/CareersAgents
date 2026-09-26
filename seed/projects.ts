// Writes my hand-written projects (seed/project-data.ts) to the database.
// Run with: npx tsx seed/projects.ts

import { pool } from "../lib/db";
import { projects } from "./project-data";

async function main() {
  for (const p of projects) {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM projects WHERE name = $1`, [
      p.name,
    ]);

    if (rows.length) {
      await pool.query(
        `UPDATE projects
            SET summary = $2, tech = $3, url = $4, highlight_for = $5
          WHERE id = $1`,
        [rows[0].id, p.summary, p.tech, p.url ?? null, p.highlight_for],
      );
    } else {
      await pool.query(
        `INSERT INTO projects (name, summary, tech, url, highlight_for)
         VALUES ($1, $2, $3, $4, $5)`,
        [p.name, p.summary, p.tech, p.url ?? null, p.highlight_for],
      );
    }
  }

  const incomplete = projects.filter((p) => !p.summary.trim() || p.tech.length === 0);
  console.log(`${projects.length} projects seeded.`);
  if (incomplete.length) {
    console.log(`\n${incomplete.length} need a summary or a tech list:`);
    for (const p of incomplete) console.log(`  ${p.name}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
