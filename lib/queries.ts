import { pool } from "./db";
import { logStatusEvent, scheduleFollowups } from "./followups";
import type {
  Answer,
  ApplicationDetail,
  ApplicationStatus,
  Company,
  JobDetail,
  JobRow,
  Project,
  ScoreComponent,
  WorkplaceType,
} from "./types";

const SCORE_CTE = `
  WITH latest AS (
    SELECT job_id, MAX(scored_at) AS scored_at
      FROM job_scores
     GROUP BY job_id
  ),
  totals AS (
    SELECT s.job_id,
           SUM(s.raw_value * s.weight) AS score,
           BOOL_OR(s.component = 'location' AND s.raw_value = 0)
             OR BOOL_OR(s.component = 'timing' AND s.raw_value = 0) AS gated
      FROM job_scores s
      JOIN latest l ON l.job_id = s.job_id AND l.scored_at = s.scored_at
     GROUP BY s.job_id
  )
`;

const JOB_LIST_SELECT = `
  ${SCORE_CTE}
  SELECT j.id, j.title, j.location, j.workplace_type, j.url, j.posted_at,
         j.first_seen_at, j.closed_at, j.company_id,
         c.name AS company_name,
         a.id AS application_id, a.status,
         t.score, t.gated
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    LEFT JOIN applications a ON a.job_id = j.id
    LEFT JOIN totals t ON t.job_id = j.id
`;

export async function listJobs(opts: {
  search?: string;
  includeClosed?: boolean;
  untrackedOnly?: boolean;
  includeLow?: boolean;
  includeSkipped?: boolean;
}): Promise<JobRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeClosed) {
    where.push("j.closed_at IS NULL");
  }
  if (opts.untrackedOnly) {
    where.push("a.id IS NULL");
  }
  if (!opts.includeSkipped) {
    where.push("(t.job_id IS NULL OR t.gated IS NOT TRUE)");
  }
  if (!opts.includeLow) {
    where.push("(t.job_id IS NULL OR t.gated OR t.score >= 0.60)");
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where.push(`(j.title ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }

  const sql = `${JOB_LIST_SELECT}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE
               WHEN t.gated THEN 2
               WHEN t.job_id IS NULL THEN 1
               ELSE 0
             END,
             t.score DESC NULLS LAST,
             j.first_seen_at DESC, c.name`;

  const { rows } = await pool.query<JobRow>(sql, params);
  return rows;
}

export async function getJob(id: string): Promise<JobDetail | null> {
  const { rows } = await pool.query<Omit<JobDetail, "components">>(
    `${SCORE_CTE}
     SELECT j.id, j.title, j.location, j.workplace_type, j.url, j.description,
            j.posted_at, j.first_seen_at, j.last_seen_at, j.closed_at,
            j.external_id, j.company_id,
            c.name AS company_name, c.city AS company_city,
            a.id AS application_id, a.status,
            t.score, t.gated
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN applications a ON a.job_id = j.id
       LEFT JOIN totals t ON t.job_id = j.id
      WHERE j.id = $1`,
    [id],
  );
  const job = rows[0];
  if (!job) return null;

  const components = await listJobComponents(id);
  return { ...job, components };
}

export async function listJobComponents(jobId: string): Promise<ScoreComponent[]> {
  const { rows } = await pool.query<ScoreComponent>(
    `SELECT s.component, s.raw_value::text, s.weight::text
       FROM job_scores s
       JOIN (
         SELECT MAX(scored_at) AS scored_at
           FROM job_scores
          WHERE job_id = $1
       ) latest ON latest.scored_at = s.scored_at
      WHERE s.job_id = $1
      ORDER BY s.component`,
    [jobId],
  );
  return rows;
}

export async function listCompanies(): Promise<Company[]> {
  const { rows } = await pool.query<Company>(
    `SELECT id, name, website, ats, board_token, city, is_target, notes
       FROM companies
      ORDER BY is_target DESC, name`,
  );
  return rows;
}

export async function createCompany(name: string, city: string | null): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, city, is_target)
     VALUES ($1, $2, true)
     ON CONFLICT (name) DO UPDATE SET city = COALESCE(companies.city, EXCLUDED.city)
     RETURNING id`,
    [name, city],
  );
  return rows[0].id;
}

// Jobs I found myself. The ATS id slot still has to be filled, so mark the origin in it.
export async function createManualJob(input: {
  companyId: string;
  title: string;
  location: string | null;
  workplaceType: WorkplaceType | null;
  url: string;
  description: string | null;
  postedAt: string | null;
}): Promise<string> {
  const externalId = `manual:${crypto.randomUUID()}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (company_id, external_id, title, location, workplace_type,
                       url, description, posted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.companyId,
      externalId,
      input.title,
      input.location,
      input.workplaceType,
      input.url,
      input.description,
      input.postedAt,
    ],
  );
  return rows[0].id;
}

export async function startApplication(jobId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO applications (job_id)
     VALUES ($1)
     ON CONFLICT (job_id) DO UPDATE SET job_id = EXCLUDED.job_id
     RETURNING id`,
    [jobId],
  );
  return rows[0].id;
}

export async function getApplication(id: string): Promise<ApplicationDetail | null> {
  const { rows } = await pool.query<ApplicationDetail>(
    `SELECT a.id, a.status, a.submitted_at, a.resume_path, a.cover_letter_path, a.resume_id, a.notes,
            j.id AS job_id, j.title, j.location, j.workplace_type, j.url, j.description,
            j.posted_at, j.closed_at,
            c.id AS company_id, c.name AS company_name, c.website AS company_website, c.city AS company_city
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listApplications(): Promise<ApplicationDetail[]> {
  const { rows } = await pool.query<ApplicationDetail>(
    `SELECT a.id, a.status, a.submitted_at, a.resume_path, a.cover_letter_path, a.resume_id, a.notes,
            j.id AS job_id, j.title, j.location, j.workplace_type, j.url, j.description,
            j.posted_at, j.closed_at,
            c.id AS company_id, c.name AS company_name, c.website AS company_website, c.city AS company_city
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      ORDER BY COALESCE(a.submitted_at, j.first_seen_at) DESC`,
  );
  return rows;
}

// 'applied' is the status that carries a date, so stamp it the first time we get there.
export async function setApplicationStatus(
  id: string,
  status: ApplicationStatus,
  reason = "manual status change",
) {
  const { rows: before } = await pool.query<{ status: ApplicationStatus; submitted_at: Date | null }>(
    `SELECT status, submitted_at FROM applications WHERE id = $1`,
    [id],
  );
  if (!before[0]) throw new Error(`application not found: ${id}`);
  const fromStatus = before[0].status;
  if (fromStatus === status) return;

  const { rows } = await pool.query<{ status: ApplicationStatus; submitted_at: Date | null }>(
    `UPDATE applications
        SET status = $2,
            submitted_at = CASE
              WHEN $2 = 'applied' AND submitted_at IS NULL THEN now()
              ELSE submitted_at
            END
      WHERE id = $1
      RETURNING status, submitted_at`,
    [id, status],
  );

  await logStatusEvent({
    applicationId: id,
    fromStatus,
    toStatus: status,
    reason,
  });

  if (status === "applied" && rows[0]?.submitted_at) {
    await scheduleFollowups(id, rows[0].submitted_at);
  }
}

export async function updateApplicationFields(
  id: string,
  fields: {
    notes: string | null;
    resumePath: string | null;
    coverLetterPath: string | null;
    resumeId?: string | null;
  },
) {
  if (fields.resumeId !== undefined) {
    await pool.query(
      `UPDATE applications
          SET notes = $2, resume_path = $3, cover_letter_path = $4, resume_id = $5
        WHERE id = $1`,
      [id, fields.notes, fields.resumePath, fields.coverLetterPath, fields.resumeId],
    );
    return;
  }
  await pool.query(
    `UPDATE applications
        SET notes = $2, resume_path = $3, cover_letter_path = $4
      WHERE id = $1`,
    [id, fields.notes, fields.resumePath, fields.coverLetterPath],
  );
}

export async function listContactsForCompany(companyId: string) {
  const { rows } = await pool.query<{
    id: string;
    name: string | null;
    role: string | null;
    email: string | null;
    source_url: string;
    verified: boolean;
  }>(
    `SELECT id, name, role, email, source_url, verified
       FROM contacts
      WHERE company_id = $1
      ORDER BY verified DESC, email`,
    [companyId],
  );
  return rows;
}

export async function addVerifiedContact(opts: {
  companyId: string;
  name?: string | null;
  role?: string | null;
  email: string;
  sourceUrl: string;
}) {
  const email = opts.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email");
  }
  if (!opts.sourceUrl.trim()) {
    throw new Error("source_url is required — no guessed addresses");
  }

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM contacts WHERE company_id = $1 AND lower(email) = lower($2)`,
    [opts.companyId, email],
  );
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE contacts
          SET name = COALESCE($2, name),
              role = COALESCE($3, role),
              source_url = $4
        WHERE id = $1`,
      [existing.rows[0].id, opts.name ?? null, opts.role ?? null, opts.sourceUrl],
    );
    return existing.rows[0].id;
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO contacts (company_id, name, role, email, source_url, verified)
     VALUES ($1, $2, $3, $4, $5, false)
     RETURNING id`,
    [opts.companyId, opts.name ?? null, opts.role ?? null, email, opts.sourceUrl],
  );
  return rows[0].id;
}

export async function appendApplicationNote(id: string, note: string) {
  const stamped = `[${new Date().toISOString().slice(0, 10)}] ${note.trim()}`;
  const { rows } = await pool.query<{ notes: string | null }>(
    `UPDATE applications
        SET notes = CASE
              WHEN notes IS NULL OR btrim(notes) = '' THEN $2
              ELSE notes || E'\n\n' || $2
            END
      WHERE id = $1
      RETURNING notes`,
    [id, stamped],
  );
  if (!rows[0]) throw new Error(`application not found: ${id}`);
  return rows[0].notes;
}

export async function listAnswers(): Promise<Answer[]> {
  const { rows } = await pool.query<Answer>(
    `SELECT id, key, category, answer_en, answer_fr, updated_at
       FROM answers
      ORDER BY CASE category WHEN 'green' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, key`,
  );
  return rows;
}

export type DeskSummary = {
  openJobs: number;
  tracked: number;
  submitted: number;
  priorityOpen: number;
  followupsDue: number;
};

export async function deskSummary(): Promise<DeskSummary> {
  const { rows } = await pool.query<{
    open_jobs: string;
    tracked: string;
    submitted: string;
    priority_open: string;
    followups_due: string;
  }>(
    `${SCORE_CTE}
     SELECT
       (SELECT count(*)::text FROM jobs WHERE closed_at IS NULL) AS open_jobs,
       (SELECT count(*)::text FROM applications) AS tracked,
       (SELECT count(*)::text FROM applications WHERE status = 'applied') AS submitted,
       (SELECT count(*)::text
          FROM jobs j
          JOIN totals t ON t.job_id = j.id
         WHERE j.closed_at IS NULL
           AND t.gated IS NOT TRUE
           AND t.score >= 0.85) AS priority_open,
       (SELECT count(*)::text
          FROM followups f
         WHERE f.state IN ('pending', 'drafted')
           AND f.due_on <= CURRENT_DATE) AS followups_due`,
  );
  const row = rows[0];
  return {
    openJobs: Number(row?.open_jobs ?? 0),
    tracked: Number(row?.tracked ?? 0),
    submitted: Number(row?.submitted ?? 0),
    priorityOpen: Number(row?.priority_open ?? 0),
    followupsDue: Number(row?.followups_due ?? 0),
  };
}

export async function listProjects(): Promise<Project[]> {
  const { rows } = await pool.query<Project>(
    `SELECT id, name, summary, tech, url, highlight_for
       FROM projects
      ORDER BY name`,
  );
  return rows;
}

export type PipelineRow = {
  application_id: string;
  status: ApplicationStatus;
  submitted_at: Date | null;
  title: string;
  location: string | null;
  company_name: string;
  source: string | null;
  score: string | null;
  gated: boolean | null;
  recruiter_name: string | null;
  recruiter_email: string | null;
  next_followup: string | null;
  outreach_approved: boolean;
};

export async function listPipelineRows(): Promise<PipelineRow[]> {
  const { rows } = await pool.query<PipelineRow>(
    `${SCORE_CTE}
     SELECT a.id AS application_id, a.status, a.submitted_at,
            j.title, j.location, j.source,
            c.name AS company_name,
            t.score, t.gated,
            (
              SELECT ct.name FROM contacts ct
               WHERE ct.company_id = c.id AND ct.email IS NOT NULL
               ORDER BY ct.verified DESC, ct.email
               LIMIT 1
            ) AS recruiter_name,
            (
              SELECT ct.email FROM contacts ct
               WHERE ct.company_id = c.id AND ct.email IS NOT NULL
               ORDER BY ct.verified DESC, ct.email
               LIMIT 1
            ) AS recruiter_email,
            (
              SELECT f.due_on::text FROM followups f
               WHERE f.application_id = a.id AND f.state IN ('pending', 'drafted')
               ORDER BY f.due_on
               LIMIT 1
            ) AS next_followup,
            EXISTS (
              SELECT 1 FROM outreach_drafts o
               WHERE o.application_id = a.id AND o.approved_at IS NOT NULL
            ) AS outreach_approved
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN totals t ON t.job_id = j.id
      ORDER BY CASE a.status
                 WHEN 'discovered' THEN 0 WHEN 'qualified' THEN 1 WHEN 'ready' THEN 2
                 WHEN 'applied' THEN 3 WHEN 'followup' THEN 4 WHEN 'interview' THEN 5
                 WHEN 'accepted' THEN 6 ELSE 7
               END,
               t.score DESC NULLS LAST,
               a.submitted_at DESC NULLS LAST`,
  );
  return rows;
}
