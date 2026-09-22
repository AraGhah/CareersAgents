import { pool } from "./db";
import type { ApplicationStatus } from "./types";

export async function scheduleFollowups(applicationId: string, submittedAt: Date = new Date()) {
  const day7 = new Date(submittedAt);
  day7.setUTCDate(day7.getUTCDate() + 7);
  const day14 = new Date(submittedAt);
  day14.setUTCDate(day14.getUTCDate() + 14);

  for (const due of [day7, day14]) {
    const dueOn = due.toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO followups (application_id, due_on, state)
       VALUES ($1, $2::date, 'pending')
       ON CONFLICT (application_id, due_on) DO NOTHING`,
      [applicationId, dueOn],
    );
  }
}

export async function logStatusEvent(opts: {
  applicationId: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
}) {
  await pool.query(
    `INSERT INTO status_events (application_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4)`,
    [opts.applicationId, opts.fromStatus, opts.toStatus, opts.reason],
  );
}

export async function listFollowupsDue(onOrBefore?: string) {
  const day = onOrBefore ?? new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query<{
    id: string;
    due_on: string;
    state: string;
    gmail_draft_id: string | null;
    application_id: string;
    application_status: ApplicationStatus;
    submitted_at: Date | null;
    title: string;
    company_name: string;
    company_id: string;
  }>(
    `SELECT f.id, f.due_on::text, f.state, f.gmail_draft_id,
            a.id AS application_id, a.status AS application_status, a.submitted_at,
            j.title, c.name AS company_name, c.id AS company_id
       FROM followups f
       JOIN applications a ON a.id = f.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE f.due_on <= $1::date
      ORDER BY f.due_on, c.name`,
    [day],
  );
  return rows;
}

export async function listOpenFollowups() {
  const { rows } = await pool.query<{
    id: string;
    due_on: string;
    state: string;
    gmail_draft_id: string | null;
    application_id: string;
    title: string;
    company_name: string;
    status: ApplicationStatus;
  }>(
    `SELECT f.id, f.due_on::text, f.state, f.gmail_draft_id,
            a.id AS application_id, a.status, j.title, c.name AS company_name
       FROM followups f
       JOIN applications a ON a.id = f.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE f.state IN ('pending', 'drafted')
      ORDER BY f.due_on, c.name`,
  );
  return rows;
}

export function followupTemplate(opts: {
  companyName: string;
  roleTitle: string;
  fullName: string;
  daysSinceSubmit: number;
  lang?: "en" | "fr";
}): { subject: string; body: string } {
  if (opts.lang === "fr") {
    return {
      subject: `Relance - ${opts.roleTitle}`,
      body: [
        "Bonjour,",
        "",
        `J'ai postulé au poste ${opts.roleTitle} chez ${opts.companyName} il y a environ ${opts.daysSinceSubmit} jours et je voulais savoir si vous aviez besoin d'autres documents.`,
        "",
        "Je peux détailler mes projets ou ma disponibilité si utile.",
        "",
        "Cordialement,",
        opts.fullName,
      ].join("\n"),
    };
  }
  return {
    subject: `Following up - ${opts.roleTitle}`,
    body: [
      "Hello,",
      "",
      `I applied for the ${opts.roleTitle} role at ${opts.companyName} about ${opts.daysSinceSubmit} days ago and wanted to check whether you need anything else from me.`,
      "",
      "Happy to share more detail on my projects or availability.",
      "",
      "Best regards,",
      opts.fullName,
    ].join("\n"),
  };
}
