// Public careers inboxes only — each row needs the page where the address was published.
//   npx tsx seed/contacts.ts

import { pool } from "../lib/db";

type SeedContact = {
  company: string;
  name?: string;
  role?: string;
  email: string;
  source_url: string;
  verified?: boolean;
};

const contacts: SeedContact[] = [
  {
    company: "Genetec",
    role: "Careers inbox",
    email: "careers@genetec.com",
    source_url: "https://www.genetec.com/careers",
    verified: false,
  },
  {
    company: "AlayaCare",
    role: "Talent acquisition",
    email: "careers@alayacare.com",
    source_url: "https://alayacare.com/open-positions/",
    verified: false,
  },
  {
    company: "Coveo",
    role: "HR",
    email: "HR@Coveo.com",
    source_url: "https://www.coveo.com/en/company/careers",
    verified: false,
  },
];

async function main() {
  for (const c of contacts) {
    const { rows: companies } = await pool.query<{ id: string }>(
      `SELECT id FROM companies WHERE lower(name) = lower($1)`,
      [c.company],
    );
    if (!companies[0]) {
      console.log(`skip ${c.email} — company ${c.company} not seeded`);
      continue;
    }

    const existing = await pool.query(
      `SELECT id FROM contacts WHERE company_id = $1 AND lower(email) = lower($2)`,
      [companies[0].id, c.email],
    );
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE contacts
            SET name = COALESCE($2, name),
                role = COALESCE($3, role),
                source_url = $4,
                verified = $5
          WHERE id = $1`,
        [existing.rows[0].id, c.name ?? null, c.role ?? null, c.source_url, c.verified ?? false],
      );
    } else {
      await pool.query(
        `INSERT INTO contacts (company_id, name, role, email, source_url, verified)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [companies[0].id, c.name ?? null, c.role ?? null, c.email, c.source_url, c.verified ?? false],
      );
    }
  }

  const { rows } = await pool.query<{ email: string }>(
    `SELECT email FROM contacts ORDER BY email`,
  );
  console.log(`${rows.length} contacts in the table.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
