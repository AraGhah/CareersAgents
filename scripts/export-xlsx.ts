// The database is the source of truth. This is a view of it I can open, print or share.
// Run with: npx tsx scripts/export-xlsx.ts

import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { pool } from "../lib/db";

const OUT = "Internships.xlsx";

function autoWidth(sheet: ExcelJS.Worksheet, max = 60) {
  sheet.columns.forEach((column) => {
    let width = 10;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > width) width = len;
    });
    column.width = Math.min(width + 2, max);
  });
}

function header(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

async function main() {
  const book = new ExcelJS.Workbook();
  book.created = new Date();

  const applications = book.addWorksheet("Applications");
  applications.columns = [
    { header: "Company", key: "company" },
    { header: "Role", key: "title" },
    { header: "Status", key: "status" },
    { header: "Submitted", key: "submitted_at" },
    { header: "Location", key: "location" },
    { header: "Workplace", key: "workplace_type" },
    { header: "URL", key: "url" },
    { header: "Notes", key: "notes" },
  ];

  const appRows = await pool.query(
    `SELECT c.name AS company, j.title, a.status,
            to_char(a.submitted_at, 'YYYY-MM-DD') AS submitted_at,
            j.location, j.workplace_type, j.url, a.notes
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      ORDER BY a.submitted_at DESC NULLS LAST, c.name`,
  );
  applications.addRows(appRows.rows);
  header(applications);
  autoWidth(applications);

  const openings = book.addWorksheet("Openings");
  openings.columns = [
    { header: "Company", key: "company" },
    { header: "Role", key: "title" },
    { header: "Location", key: "location" },
    { header: "Workplace", key: "workplace_type" },
    { header: "Score", key: "score" },
    { header: "Skipped", key: "skipped" },
    { header: "Posted", key: "posted_at" },
    { header: "First seen", key: "first_seen_at" },
    { header: "Closed", key: "closed_at" },
    { header: "Tracked", key: "tracked" },
    { header: "URL", key: "url" },
  ];

  const jobRows = await pool.query(
    `WITH latest AS (
       SELECT job_id, MAX(scored_at) AS scored_at
         FROM job_scores
        GROUP BY job_id
     ),
     totals AS (
       SELECT s.job_id,
              ROUND(SUM(s.raw_value * s.weight) * 100) AS score,
              BOOL_OR(s.component = 'location' AND s.raw_value = 0)
                OR BOOL_OR(s.component = 'timing' AND s.raw_value = 0) AS gated
         FROM job_scores s
         JOIN latest l ON l.job_id = s.job_id AND l.scored_at = s.scored_at
        GROUP BY s.job_id
     )
     SELECT c.name AS company, j.title, j.location, j.workplace_type,
            t.score,
            CASE WHEN t.gated THEN 'yes' WHEN t.job_id IS NULL THEN '' ELSE 'no' END AS skipped,
            to_char(j.posted_at, 'YYYY-MM-DD') AS posted_at,
            to_char(j.first_seen_at, 'YYYY-MM-DD') AS first_seen_at,
            to_char(j.closed_at, 'YYYY-MM-DD') AS closed_at,
            CASE WHEN a.id IS NULL THEN 'no' ELSE 'yes' END AS tracked,
            j.url
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN applications a ON a.job_id = j.id
       LEFT JOIN totals t ON t.job_id = j.id
      ORDER BY t.score DESC NULLS LAST, j.first_seen_at DESC, c.name`,
  );
  openings.addRows(jobRows.rows);
  header(openings);
  autoWidth(openings);

  const companies = book.addWorksheet("Companies");
  companies.columns = [
    { header: "Name", key: "name" },
    { header: "City", key: "city" },
    { header: "ATS", key: "ats" },
    { header: "Board token", key: "board_token" },
    { header: "Target", key: "is_target" },
    { header: "Openings", key: "openings" },
    { header: "Website", key: "website" },
  ];

  const companyRows = await pool.query(
    `SELECT c.name, c.city, c.ats, c.board_token,
            CASE WHEN c.is_target THEN 'yes' ELSE 'no' END AS is_target,
            count(j.id) AS openings, c.website
       FROM companies c
       LEFT JOIN jobs j ON j.company_id = c.id AND j.closed_at IS NULL
      GROUP BY c.id
      ORDER BY c.is_target DESC, c.name`,
  );
  companies.addRows(companyRows.rows);
  header(companies);
  autoWidth(companies);

  const buffer = await book.xlsx.writeBuffer();
  await writeFile(OUT, Buffer.from(buffer));

  console.log(
    `${OUT}: ${appRows.rowCount} applications, ${jobRows.rowCount} openings, ` +
      `${companyRows.rowCount} companies.`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
