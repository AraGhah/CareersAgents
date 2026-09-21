// My projects, written by hand. Run with: npx tsx seed/projects.ts
//
// highlight_for drives which projects a posting surfaces later:
// 'backend' | 'fullstack' | 'ai' | 'gamedev' | 'cloud'
//
// Summaries are shortened from the case studies on aragahramanyan.dev.

import { pool } from "../lib/db";

type SeedProject = {
  name: string;
  summary: string;
  tech: string[];
  url?: string;
  highlight_for: string[];
};

const projects: SeedProject[] = [
  {
    name: "Dossier",
    summary:
      "Research and personalization pipeline for outbound sales: ingest prospects, research the company, score the research, generate email variants, then deliver only what passes quality gates. PostgreSQL holds workflow state, with retries and dead-letter handling. A 100-prospect pilot reached about a 9.6% reply rate. Live at rundossier.co.",
    tech: ["TypeScript", "Node.js", "Express", "React", "PostgreSQL", "Supabase", "n8n", "Apify"],
    url: "https://rundossier.co",
    highlight_for: ["backend", "fullstack", "ai"],
  },
  {
    name: "TradeCatch",
    summary:
      "Lead recovery for contractors: engage a missed caller, qualify the job, alert the contractor, and follow up on estimates until the customer answers, books, or opts out. Messaging can vary; scheduling, pricing, and opt-out are deterministic rules. In development.",
    tech: ["Next.js", "React", "TypeScript", "Cloudflare Workers", "OpenNext", "Twilio", "Stripe"],
    url: "https://github.com/AraGhah/TradeCatch",
    highlight_for: ["fullstack", "backend"],
  },
  {
    name: "SentinelOps",
    summary:
      "Cloud-native incident desk: ingest security events from AWS, normalize them, and put analysts on a ranked queue instead of a firehose. ASP.NET Core API, React dashboard, PostgreSQL, Lambda workers, CDK. In development.",
    tech: ["AWS", "ASP.NET Core", "C#", "React", "PostgreSQL", "REST APIs"],
    url: "https://github.com/AraGhah/SentinelOps",
    highlight_for: ["backend", "cloud"],
  },
  {
    name: "Travel Express",
    summary:
      "Team travel site. I owned the Node.js backend: REST routes, JWT auth, and the contract the React front consumed. MongoDB plus Oracle/PL-SQL for persistence. Academic, 2026.",
    tech: ["React", "Vite", "Node.js", "Express", "MongoDB", "Oracle", "SQL", "PL/SQL", "JWT"],
    highlight_for: ["backend", "fullstack"],
  },
  {
    name: "VAMP2 Survivors",
    summary:
      "Unity 3D survival game. Enemy behaviour is a state machine plus Observer events; a decoy mechanic targets through an ICibleEnnemi interface instead of a hardcoded list. Unit tests on the gameplay logic. Academic, 2026.",
    tech: ["C#", "Unity"],
    highlight_for: ["gamedev"],
  },
];

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
