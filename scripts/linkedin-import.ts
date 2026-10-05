// Records the LinkedIn Easy Apply submissions made by tools/linkedin-bot in the desk.
//   npm run linkedin:import          each submitted posting becomes an application with status "applied" (Envoyé)
//   npm run linkedin:import -- --dry print what would change
//
// A posting the desk already knows (same LinkedIn job id) keeps its row; an unknown one is added with source
// "linkedin". Only rows the bot really submitted count: not its dry runs, its failures or its external links.
// Run it again any time: a posting already marked applied (or further along) is left alone.

import fs from "node:fs";
import { readCsv } from "../lib/csv";
import { APPLIED_CSV } from "../lib/linkedin-bot";
import type { WorkplaceType } from "../lib/types";

const DRY = process.argv.includes("--dry");
const OPEN_STATUSES = ["discovered", "qualified", "ready"];

function workplace(style: string): WorkplaceType | null {
  const s = style.toLowerCase();
  if (s.includes("remote")) return "remote";
  if (s.includes("hybrid")) return "hybrid";
  if (s.includes("on-site") || s.includes("onsite")) return "onsite";
  return null;
}

function date(value: string): Date | null {
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  if (!fs.existsSync(APPLIED_CSV)) {
    console.log("The bot has not applied to anything yet (no history file).");
    return;
  }
  // Only "Easy Applied" with a date: the desk's own rows, external links and "Pending" ones are not submissions.
  const submitted = readCsv(fs.readFileSync(APPLIED_CSV, "utf8")).filter(
    (r) => /^\d+$/.test(r["Job ID"]) && r["External Job link"] === "Easy Applied" && date(r["Date Applied"]),
  );

  const { pool } = await import("../lib/db");
  const { upsertDiscoveredCompany } = await import("../lib/queries");
  const { logStatusEvent } = await import("../lib/followups");
  let added = 0;
  let marked = 0;
  let unchanged = 0;
  try {
    for (const row of submitted) {
      const externalId = `linkedin-${row["Job ID"]}`;
      const appliedAt = date(row["Date Applied"])!;
      const label = `${row.Company} — ${row.Title}`;

      const { rows: found } = await pool.query<{ id: string }>(
        `SELECT id FROM jobs WHERE external_id = $1 ORDER BY first_seen_at LIMIT 1`,
        [externalId],
      );
      let jobId = found[0]?.id;
      if (!jobId) {
        if (DRY) {
          console.log(`+ new posting, applied: ${label}`);
          added++;
          continue;
        }
        const companyId = await upsertDiscoveredCompany(row.Company.trim(), null);
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO jobs (company_id, external_id, title, location, workplace_type, url, description, posted_at, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'linkedin')
           ON CONFLICT (company_id, external_id) DO UPDATE SET last_seen_at = now()
           RETURNING id`,
          [
            companyId,
            externalId,
            row.Title.trim(),
            row["Work Location"] && row["Work Location"] !== "Unknown" ? row["Work Location"] : null,
            workplace(row["Work Style"]),
            row["Job Link"] || `https://www.linkedin.com/jobs/view/${row["Job ID"]}/`,
            row["About Job"] && row["About Job"] !== "Unknown" ? row["About Job"] : null,
            date(row["Date Posted"]),
          ],
        );
        jobId = rows[0].id;
        added++;
      }

      const { rows: apps } = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM applications WHERE job_id = $1`,
        [jobId],
      );
      const app = apps[0];
      if (app && !OPEN_STATUSES.includes(app.status)) {
        unchanged++;
        continue;
      }
      if (DRY) {
        console.log(`~ ${app ? app.status : "no application"} -> applied: ${label}`);
        marked++;
        continue;
      }
      const { rows: saved } = await pool.query<{ id: string }>(
        `INSERT INTO applications (job_id, status, submitted_at, channel)
         VALUES ($1, 'applied', $2, 'portal')
         ON CONFLICT (job_id) DO UPDATE SET status = 'applied', submitted_at = EXCLUDED.submitted_at,
                                            channel = COALESCE(applications.channel, 'portal')
         RETURNING id`,
        [jobId, appliedAt],
      );
      await logStatusEvent({
        applicationId: saved[0].id,
        fromStatus: app?.status ?? null,
        toStatus: "applied",
        reason: "LinkedIn Easy Apply (tools/linkedin-bot)",
      });
      console.log(`applied: ${label}`);
      marked++;
    }
  } finally {
    await pool.end();
  }
  console.log(
    `${submitted.length} Easy Apply submission(s) in the bot's history: ${added} new posting(s), ` +
      `${marked} marked applied, ${unchanged} already further along.${DRY ? " (dry run, nothing written)" : ""}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
