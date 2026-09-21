import { pool } from "./db";
import type {
  Answer,
  ApplicationDetail,
  ApplicationStatus,
  Company,
  JobDetail,
  JobRow,
  Project,
  WorkplaceType,
} from "./types";

const JOB_LIST_SELECT = `
  SELECT j.id, j.title, j.location, j.workplace_type, j.url, j.posted_at,
         j.first_seen_at, j.closed_at, j.company_id,
         c.name AS company_name,
         a.id AS application_id, a.status
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    LEFT JOIN applications a ON a.job_id = j.id
`;

export async function listJobs(opts: {
  search?: string;
  includeClosed?: boolean;
  untrackedOnly?: boolean;
}): Promise<JobRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeClosed) {
    where.push("j.closed_at IS NULL");
  }
  if (opts.untrackedOnly) {
    where.push("a.id IS NULL");
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where.push(`(j.title ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }

  const sql = `${JOB_LIST_SELECT}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY j.first_seen_at DESC, c.name`;

  const { rows } = await pool.query<JobRow>(sql, params);
  return rows;
}

export async function getJob(id: string): Promise<JobDetail | null> {
  const { rows } = await pool.query<JobDetail>(
    `SELECT j.id, j.title, j.location, j.workplace_type, j.url, j.description,
            j.posted_at, j.first_seen_at, j.last_seen_at, j.closed_at,
            j.external_id, j.company_id,
            c.name AS company_name,
            a.id AS application_id, a.status
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.id = $1`,
    [id],
  );
  return rows[0] ?? null;
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
    `SELECT a.id, a.status, a.submitted_at, a.resume_path, a.cover_letter_path, a.notes,
            j.id AS job_id, j.title, j.location, j.workplace_type, j.url, j.description,
            j.posted_at, j.closed_at,
            c.name AS company_name, c.website AS company_website, c.city AS company_city
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
    `SELECT a.id, a.status, a.submitted_at, a.resume_path, a.cover_letter_path, a.notes,
            j.id AS job_id, j.title, j.location, j.workplace_type, j.url, j.description,
            j.posted_at, j.closed_at,
            c.name AS company_name, c.website AS company_website, c.city AS company_city
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      ORDER BY COALESCE(a.submitted_at, j.first_seen_at) DESC`,
  );
  return rows;
}

// 'submitted' is the one status that carries a date, so stamp it the first time we get there.
export async function setApplicationStatus(id: string, status: ApplicationStatus) {
  await pool.query(
    `UPDATE applications
        SET status = $2,
            submitted_at = CASE
              WHEN $2 = 'submitted' AND submitted_at IS NULL THEN now()
              ELSE submitted_at
            END
      WHERE id = $1`,
    [id, status],
  );
}

export async function updateApplicationFields(
  id: string,
  fields: { notes: string | null; resumePath: string | null; coverLetterPath: string | null },
) {
  await pool.query(
    `UPDATE applications
        SET notes = $2, resume_path = $3, cover_letter_path = $4
      WHERE id = $1`,
    [id, fields.notes, fields.resumePath, fields.coverLetterPath],
  );
}

export async function listAnswers(): Promise<Answer[]> {
  const { rows } = await pool.query<Answer>(
    `SELECT id, key, category, answer_en, answer_fr, updated_at
       FROM answers
      ORDER BY CASE category WHEN 'green' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, key`,
  );
  return rows;
}

export async function listProjects(): Promise<Project[]> {
  const { rows } = await pool.query<Project>(
    `SELECT id, name, summary, tech, url, highlight_for
       FROM projects
      ORDER BY name`,
  );
  return rows;
}
