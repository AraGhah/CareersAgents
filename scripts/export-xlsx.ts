// Tracker view matching the search workflow columns.
// Database stays the source of truth. Run: npx tsx scripts/export-xlsx.ts
// Writes Stages_2027.xlsx (and keeps Internships.xlsx as a short English view).

import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { pool } from "../lib/db";

const OUT_FR = "Stages_2027.xlsx";
const OUT_EN = "Internships.xlsx";

const STATUTS = [
  "Trouvé",
  "Brouillon prêt",
  "Postulé",
  "Relance 1",
  "Relance 2",
  "Réponse",
  "Entrevue",
  "Refus",
  "Offre",
  "Abandonné",
] as const;

function statusFr(status: string | null, hasApp: boolean): string {
  if (!hasApp) return "Trouvé";
  switch (status) {
    case "draft":
      return "Trouvé";
    case "ready":
      return "Brouillon prêt";
    case "submitted":
      return "Postulé";
    case "replied":
      return "Réponse";
    case "interview":
      return "Entrevue";
    case "assessment":
      return "Réponse";
    case "rejected":
      return "Refus";
    case "offer":
      return "Offre";
    case "withdrawn":
      return "Abandonné";
    default:
      return "Trouvé";
  }
}

function modeFr(workplace: string | null): string {
  switch (workplace) {
    case "onsite":
      return "sur place";
    case "hybrid":
      return "hybride";
    case "remote":
      return "distance";
    default:
      return "";
  }
}

function langueFromText(title: string, description: string | null): string {
  const text = `${title}\n${description ?? ""}`;
  const fr = (text.match(/\b(le|la|les|des|pour|avec|stage|stagiaire|hiver|développeur)\b/gi) ?? [])
    .length;
  const en = (text.match(/\b(the|and|with|for|intern|internship|winter|software|developer)\b/gi) ?? [])
    .length;
  if (fr > en + 2) return "fr";
  if (en > fr + 2) return "en";
  return fr >= en ? "fr" : "en";
}

function autoWidth(sheet: ExcelJS.Worksheet, max = 48) {
  sheet.columns.forEach((column) => {
    let width = 12;
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

async function buildStagesSheet(book: ExcelJS.Workbook) {
  const sheet = book.addWorksheet("Stages");
  sheet.columns = [
    { header: "Entreprise", key: "entreprise" },
    { header: "Poste", key: "poste" },
    { header: "Lieu", key: "lieu" },
    { header: "Mode", key: "mode" },
    { header: "Langue", key: "langue" },
    { header: "URL", key: "url" },
    { header: "Score", key: "score" },
    { header: "Date trouvée", key: "date_trouvee" },
    { header: "Contact", key: "contact" },
    { header: "Courriel contact", key: "courriel_contact" },
    { header: "Source contact", key: "source_contact" },
    { header: "Statut", key: "statut" },
    { header: "Date candidature", key: "date_candidature" },
    { header: "Relance 1 (J+7)", key: "relance1" },
    { header: "Relance 2 (J+14)", key: "relance2" },
    { header: "Réponse reçue", key: "reponse_recue" },
    { header: "Notes", key: "notes" },
  ];

  const { rows } = await pool.query<{
    entreprise: string;
    poste: string;
    lieu: string | null;
    workplace_type: string | null;
    description: string | null;
    url: string;
    score: string | null;
    gated: boolean | null;
    date_trouvee: string | null;
    contact: string | null;
    courriel_contact: string | null;
    source_contact: string | null;
    status: string | null;
    application_id: string | null;
    date_candidature: string | null;
    relance1: string | null;
    relance2: string | null;
    relances_faites: string | null;
    reponse_recue: string | null;
    notes: string | null;
  }>(
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
     ),
     contact AS (
       SELECT DISTINCT ON (company_id)
              company_id, name, email, source_url
         FROM contacts
        WHERE email IS NOT NULL AND btrim(email) <> ''
        ORDER BY company_id, verified DESC, email
     ),
     fu AS (
       SELECT application_id,
              min(due_on) AS relance1,
              max(due_on) AS relance2,
              count(*) FILTER (WHERE state IN ('drafted', 'sent')) AS relances_faites
         FROM followups
        GROUP BY application_id
     ),
     inbound AS (
       SELECT application_id, min(occurred_at) AS first_reply
         FROM messages
        WHERE direction = 'inbound' AND application_id IS NOT NULL
        GROUP BY application_id
     )
     SELECT c.name AS entreprise, j.title AS poste, j.location AS lieu,
            j.workplace_type, j.description, j.url,
            CASE WHEN t.gated THEN NULL ELSE t.score END AS score,
            t.gated,
            to_char(j.first_seen_at, 'YYYY-MM-DD') AS date_trouvee,
            ct.name AS contact, ct.email AS courriel_contact, ct.source_url AS source_contact,
            a.status, a.id AS application_id,
            to_char(a.submitted_at, 'YYYY-MM-DD') AS date_candidature,
            to_char(fu.relance1, 'YYYY-MM-DD') AS relance1,
            to_char(fu.relance2, 'YYYY-MM-DD') AS relance2,
            fu.relances_faites::text AS relances_faites,
            to_char(inbound.first_reply, 'YYYY-MM-DD') AS reponse_recue,
            a.notes
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN applications a ON a.job_id = j.id
       LEFT JOIN totals t ON t.job_id = j.id
       LEFT JOIN contact ct ON ct.company_id = c.id
       LEFT JOIN fu ON fu.application_id = a.id
       LEFT JOIN inbound ON inbound.application_id = a.id
      WHERE j.closed_at IS NULL OR a.id IS NOT NULL
      ORDER BY COALESCE(t.score, -1) DESC, j.first_seen_at DESC, c.name`,
  );

  for (const row of rows) {
    let statut = statusFr(row.status, Boolean(row.application_id));
    const nRelances = Number(row.relances_faites ?? 0);
    if (row.status === "submitted" && !row.reponse_recue && nRelances >= 2) {
      statut = "Relance 2";
    } else if (row.status === "submitted" && !row.reponse_recue && nRelances >= 1) {
      statut = "Relance 1";
    }
    sheet.addRow({
      entreprise: row.entreprise,
      poste: row.poste,
      lieu: row.lieu ?? "",
      mode: modeFr(row.workplace_type),
      langue: langueFromText(row.poste, row.description),
      url: row.url,
      score: row.score ?? "",
      date_trouvee: row.date_trouvee ?? "",
      contact: row.contact ?? "",
      courriel_contact: row.courriel_contact ?? "",
      source_contact: row.source_contact ?? "",
      statut,
      date_candidature: row.date_candidature ?? "",
      relance1: row.relance1 ?? "",
      relance2: row.relance2 ?? "",
      reponse_recue: row.reponse_recue ?? "",
      notes: row.notes ?? "",
    });
  }

  // Dropdown on Statut (column L = 12).
  for (let r = 2; r <= sheet.rowCount; r++) {
    sheet.getCell(r, 12).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${STATUTS.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Statut",
      error: "Choisir une valeur de la liste.",
    };
  }

  header(sheet);
  autoWidth(sheet);
  return rows.length;
}

async function buildEnglishSheets(book: ExcelJS.Workbook) {
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
    { header: "URL", key: "url" },
  ];
  const jobRows = await pool.query(
    `WITH latest AS (
       SELECT job_id, MAX(scored_at) AS scored_at FROM job_scores GROUP BY job_id
     ),
     totals AS (
       SELECT s.job_id, ROUND(SUM(s.raw_value * s.weight) * 100) AS score
         FROM job_scores s
         JOIN latest l ON l.job_id = s.job_id AND l.scored_at = s.scored_at
        GROUP BY s.job_id
     )
     SELECT c.name AS company, j.title, j.location, j.workplace_type, t.score, j.url
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN totals t ON t.job_id = j.id
      WHERE j.closed_at IS NULL
      ORDER BY t.score DESC NULLS LAST, c.name`,
  );
  openings.addRows(jobRows.rows);
  header(openings);
  autoWidth(openings);

  return { apps: appRows.rowCount ?? 0, jobs: jobRows.rowCount ?? 0 };
}

async function main() {
  const stagesBook = new ExcelJS.Workbook();
  stagesBook.created = new Date();
  const stageCount = await buildStagesSheet(stagesBook);
  await writeFile(OUT_FR, Buffer.from(await stagesBook.xlsx.writeBuffer()));

  const enBook = new ExcelJS.Workbook();
  enBook.created = new Date();
  const en = await buildEnglishSheets(enBook);
  await writeFile(OUT_EN, Buffer.from(await enBook.xlsx.writeBuffer()));

  console.log(`${OUT_FR}: ${stageCount} rows (Agent 7 columns, Statut dropdown).`);
  console.log(`${OUT_EN}: ${en.apps} applications, ${en.jobs} openings.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
