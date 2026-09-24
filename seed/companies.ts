// Target companies. Run with: npx tsx seed/companies.ts
//
// board_token is the slug in the careers URL:
//   Greenhouse  job-boards.greenhouse.io/<token>        -> ats 'greenhouse'
//   Lever       jobs.lever.co/<token>  (case sensitive) -> ats 'lever'
//   Workable    apply.workable.com/<token>              -> ats 'workable'
// Workday and in-house portals stay manual-entry: leave ats 'workday' or 'other'
// and board_token null, and discovery will skip them.
//
// Every token below was confirmed by calling the endpoint and getting the company's own
// postings back. is_target false means I found the board, not that I decided to apply.

import { pool } from "../lib/db";

type SeedCompany = {
  name: string;
  website?: string;
  ats?: "greenhouse" | "lever" | "workable" | "workday" | "other";
  board_token?: string;
  city?: string;
  is_target?: boolean;
  notes?: string;
};

const companies: SeedCompany[] = [
  {
    name: "Genetec",
    website: "https://www.genetec.com",
    ats: "workable",
    board_token: "genetec-inc",
    city: "Saint-Laurent",
    is_target: true,
    notes: "Winter internship posting is a single catch-all req, department 'Internship'.",
  },
  {
    name: "Coveo",
    website: "https://www.coveo.com",
    ats: "greenhouse",
    board_token: "coveoen",
    city: "Montr\u00e9al",
    is_target: true,
  },
  {
    name: "CAE",
    website: "https://www.cae.com",
    ats: "workday",
    city: "Saint-Laurent",
    is_target: true,
    notes: "Workday (wd3.myworkdayjobs.com). Manual entry, by hand and on purpose.",
  },

  // Boards I found while looking for the three above. Mine to triage, not yet targets.
  {
    name: "AlayaCare",
    website: "https://www.alayacare.com",
    ats: "greenhouse",
    board_token: "alayacare",
    city: "Montr\u00e9al",
    is_target: false,
  },
  {
    name: "Poka",
    website: "https://www.poka.io",
    ats: "greenhouse",
    board_token: "poka",
    city: "Qu\u00e9bec",
    is_target: false,
  },
  {
    name: "Workleap",
    website: "https://www.workleap.com",
    ats: "greenhouse",
    board_token: "workleap",
    city: "Qu\u00e9bec",
    is_target: false,
  },
  {
    name: "Hivestack",
    website: "https://www.hivestack.com",
    ats: "greenhouse",
    board_token: "hivestack",
    city: "Montr\u00e9al",
    is_target: false,
    notes: "Board is live but empty.",
  },
  {
    name: "Spiria",
    website: "https://www.spiria.com",
    ats: "lever",
    board_token: "spiria",
    city: "Montr\u00e9al",
    is_target: false,
  },
  {
    name: "Osedea",
    website: "https://www.osedea.com",
    ats: "lever",
    board_token: "osedea",
    city: "Montr\u00e9al",
    is_target: false,
  },
  {
    name: "Plusgrade",
    website: "https://www.plusgrade.com",
    ats: "lever",
    board_token: "plusgrade",
    city: "Montr\u00e9al",
    is_target: false,
    notes: "Board is live but empty.",
  },
  {
    name: "Mistplay",
    website: "https://www.mistplay.com",
    ats: "lever",
    board_token: "mistplay",
    city: "Toronto",
    is_target: false,
    notes: "Toronto, kept for the board only.",
  },

  // Priority employers (see lib/priority-companies.ts): declared targets, not
  // boards. None run Greenhouse/Lever/Workable/Ashby, so board_token stays
  // null and discovery skips direct fetch — they're boosted/highlighted
  // instead when the general LinkedIn/Indeed search surfaces them.
  { name: "Hydro-Québec", city: "Montréal", is_target: true },
  { name: "Bombardier", city: "Montréal", is_target: true },
  { name: "Desjardins", city: "Lévis", is_target: true },
  { name: "RBC", city: "Montréal", is_target: true },
  { name: "TD", city: "Montréal", is_target: true },
  { name: "BMO", city: "Montréal", is_target: true },
  { name: "Scotiabank", city: "Montréal", is_target: true },
  { name: "National Bank of Canada", city: "Montréal", is_target: true },
  { name: "CIBC", city: "Montréal", is_target: true },
  { name: "Bell", city: "Montréal", is_target: true },
  { name: "CGI", city: "Montréal", is_target: true },
  { name: "Ericsson", city: "Montréal", is_target: true },
  { name: "Ubisoft", city: "Montréal", is_target: true },
  { name: "SAP", city: "Montréal", is_target: true },
  { name: "Morgan Stanley", city: "Montréal", is_target: true },
];

async function main() {
  for (const c of companies) {
    await pool.query(
      `INSERT INTO companies (name, website, ats, board_token, city, is_target, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE
          SET website     = COALESCE(EXCLUDED.website, companies.website),
              ats         = COALESCE(EXCLUDED.ats, companies.ats),
              board_token = COALESCE(EXCLUDED.board_token, companies.board_token),
              city        = COALESCE(EXCLUDED.city, companies.city),
              is_target   = EXCLUDED.is_target,
              notes       = COALESCE(EXCLUDED.notes, companies.notes)`,
      [
        c.name,
        c.website ?? null,
        c.ats ?? null,
        c.board_token ?? null,
        c.city ?? null,
        c.is_target ?? true,
        c.notes ?? null,
      ],
    );
  }

  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM companies WHERE board_token IS NULL ORDER BY name`,
  );

  console.log(`${companies.length} companies seeded.`);
  if (rows.length) {
    console.log(`\n${rows.length} have no board_token, so discovery will skip them:`);
    for (const r of rows) console.log(`  ${r.name}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
