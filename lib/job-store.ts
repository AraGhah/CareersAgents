// Storing one posting found by discovery: the board crawl, freehire, LinkedIn and Indeed all go through here, so the same
// rules decide what is kept. Only internships, only relevant roles, never cybersecurity, and only around here
// (lib/registry/where.ts). The same posting seen again only moves last_seen_at and reopens it.

import { pool } from "./db";
import { isInternshipTitle, isSoftwareRelevant, type NormalizedJob } from "./discover-core";
import { isCybersecurityRole } from "./match/lexicon";
import { OTHER_CANADA, QUEBEC_PLACES } from "./registry/where";

/** "Deli Clerk - Central Alberta Co-op": a co-operative store's job, not a co-op work term. */
const COOP_STORE = /\bco-?op\b/i;
const STORE_WORK = /\b(clerk|cashier|grocery|deli|bakery|butcher|meat|produce|driver|agro|lumber|petroleum|fuel|gas bar|store|food|pharmacy|cook|team member|merchandiser)\b/i;
const OTHER_INTERN_WORD = /\b(intern|internship|stage|stagiaire|student|étudiant|etudiant|work term)\b/i;

export function isCoopStoreJob(title: string): boolean {
  return COOP_STORE.test(title) && STORE_WORK.test(title) && !OTHER_INTERN_WORD.test(title);
}

export async function upsertJob(companyId: string, job: NormalizedJob): Promise<"inserted" | "updated" | "skipped"> {
  if (!isInternshipTitle(job.title)) return "skipped";
  if (isCoopStoreJob(job.title)) return "skipped";
  if (!isSoftwareRelevant(job.title, job.description)) return "skipped";
  // Cybersecurity is never wanted: not stored, so it is never scored, tracked or prepared.
  if (isCybersecurityRole(job.title, job.description)) return "skipped";

  const result = await pool.query<{ id: string; inserted: boolean }>(
    `INSERT INTO jobs (company_id, external_id, title, location, workplace_type, url, description, posted_at, source)
     SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::timestamptz, $9::text
      WHERE (
              $4 IS NULL
           OR $5 = 'remote'
           OR $4 ~* $10
           OR (
                $4 ~* 'canada|remote|anywhere|t[ée]l[ée]travail'
            AND $4 !~* $11
              )
            )
     ON CONFLICT (company_id, external_id)
     DO UPDATE SET
          last_seen_at    = now(),
          title           = EXCLUDED.title,
          location        = COALESCE(EXCLUDED.location, jobs.location),
          workplace_type  = COALESCE(EXCLUDED.workplace_type, jobs.workplace_type),
          url             = EXCLUDED.url,
          -- A later run without details must not wipe a description this job already has.
          description     = COALESCE(EXCLUDED.description, jobs.description),
          posted_at       = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
          source          = EXCLUDED.source,
          closed_at       = NULL
     RETURNING id, (xmax = 0) AS inserted`,
    [
      companyId,
      job.externalId,
      job.title,
      job.location,
      job.workplaceType,
      job.url,
      job.description,
      job.postedAt,
      job.source,
      QUEBEC_PLACES,
      OTHER_CANADA,
    ],
  );

  if (result.rowCount === 0) return "skipped";
  if (job.applyUrl) await saveApplyUrl(result.rows[0].id, job.applyUrl);
  return result.rows[0].inserted ? "inserted" : "updated";
}

let warnedNoApplyUrl = false;

/** Kept apart from the upsert so discovery still runs on a database without schema-v11.sql. */
async function saveApplyUrl(jobId: string, applyUrl: string) {
  try {
    await pool.query(`UPDATE jobs SET apply_url = $2 WHERE id = $1`, [jobId, applyUrl]);
  } catch (err) {
    if ((err as { code?: string }).code !== "42703") throw err;
    if (!warnedNoApplyUrl) console.warn("[discover] jobs.apply_url missing: apply schema-v11.sql");
    warnedNoApplyUrl = true;
  }
}
