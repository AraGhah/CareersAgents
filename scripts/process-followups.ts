// Daily follow-up pass. Creates Gmail drafts only — never sends.
// Recipient must already be in contacts with a real source_url.
//   npx tsx scripts/process-followups.ts
//   npx tsx scripts/process-followups.ts --dry     (no Gmail calls)

import { pool } from "../lib/db";
import { createDraft } from "../lib/gmail";
import { followupTemplate } from "../lib/followups";

const DRY = process.argv.includes("--dry");
const TODAY = process.argv.find((a) => a.startsWith("--on="))?.slice(5);

type DueRow = {
  id: string;
  due_on: string;
  application_id: string;
  submitted_at: Date | null;
  title: string;
  company_name: string;
  company_id: string;
  full_name: string | null;
};

async function contactForCompany(companyId: string): Promise<{ email: string; source_url: string } | null> {
  const { rows } = await pool.query<{ email: string; source_url: string }>(
    `SELECT email, source_url
       FROM contacts
      WHERE company_id = $1
        AND email IS NOT NULL
        AND btrim(email) <> ''
        AND source_url IS NOT NULL
        AND btrim(source_url) <> ''
      ORDER BY verified DESC, email
      LIMIT 1`,
    [companyId],
  );
  return rows[0] ?? null;
}

async function hasInboundSinceSubmit(applicationId: string, submittedAt: Date | null): Promise<boolean> {
  if (!submittedAt) return false;
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM messages
      WHERE application_id = $1
        AND direction = 'inbound'
        AND occurred_at >= $2`,
    [applicationId, submittedAt],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function run() {
  const day = TODAY ?? new Date().toISOString().slice(0, 10);
  console.log(`Follow-ups due on or before ${day}${DRY ? " (dry run)" : ""}`);

  const { rows } = await pool.query<DueRow>(
    `SELECT f.id, f.due_on::text, f.application_id, a.submitted_at,
            j.title, c.name AS company_name, c.id AS company_id,
            (SELECT answer_en FROM answers WHERE key = 'full_name') AS full_name
       FROM followups f
       JOIN applications a ON a.id = f.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE f.state = 'pending'
        AND f.due_on <= $1::date
      ORDER BY f.due_on, c.name`,
    [day],
  );

  let cancelled = 0;
  let drafted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (await hasInboundSinceSubmit(row.application_id, row.submitted_at)) {
      await pool.query(`UPDATE followups SET state = 'cancelled' WHERE id = $1`, [row.id]);
      cancelled += 1;
      console.log(`  cancel ${row.company_name} · ${row.title} (inbound since submit)`);
      continue;
    }

    const contact = await contactForCompany(row.company_id);
    if (!contact) {
      skipped += 1;
      console.log(
        `  skip ${row.company_name} · ${row.title} — no contacts.email with source_url`,
      );
      continue;
    }

    const submitted = row.submitted_at ? new Date(row.submitted_at) : new Date();
    const days = Math.max(
      1,
      Math.round((Date.now() - submitted.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const template = followupTemplate({
      companyName: row.company_name,
      roleTitle: row.title,
      fullName: row.full_name ?? "Ara Ghahramanyan",
      daysSinceSubmit: days,
    });

    if (DRY) {
      console.log(`  dry draft → ${contact.email} · ${template.subject}`);
      drafted += 1;
      continue;
    }

    const draftId = await createDraft({
      to: contact.email,
      subject: template.subject,
      body: template.body,
    });
    await pool.query(
      `UPDATE followups SET state = 'drafted', gmail_draft_id = $2 WHERE id = $1`,
      [row.id, draftId],
    );
    drafted += 1;
    console.log(`  drafted ${row.company_name} · ${row.title} → ${contact.email} (${draftId})`);
  }

  console.log(`Done. ${drafted} drafted, ${cancelled} cancelled, ${skipped} skipped.`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
