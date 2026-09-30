// Where the application form actually is. A posting found on a job board (Indeed,
// LinkedIn) points at that board, whose own "Easy Apply" needs the candidate's
// account; the form that matters is on the company's site. In order:
//   1. the posting's own company link (jobs.apply_url, from Indeed's "apply on
//      company site", captured at discovery)
//   2. the same role at the same company found on another source (a Greenhouse
//      board, or the Indeed copy of a LinkedIn posting)
//   3. the posting URL itself

import { pool } from "../db";
import type { ApplicationDetail } from "../types";
import { roleKey } from "./dedupe";

export type ApplyTarget = {
  url: string;
  via: "posting" | "company-link" | "same-role-elsewhere";
  note: string;
};

const JOB_BOARD = /(^|\.)(linkedin|indeed)\.[a-z.]+$/i;

export function isJobBoardUrl(url: string): boolean {
  try {
    return JOB_BOARD.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

type JobLinks = { id: string; title: string; url: string; apply_url: string | null; source: string | null };

async function jobLinks(sql: string, params: unknown[]): Promise<JobLinks[]> {
  try {
    return (await pool.query<JobLinks>(sql, params)).rows;
  } catch (err) {
    // Before schema-v11.sql there is no apply_url: fall back to the posting URLs only.
    if ((err as { code?: string }).code !== "42703") throw err;
    return (await pool.query<JobLinks>(sql.replace(/\bapply_url\b/, "NULL::text AS apply_url"), params)).rows;
  }
}

/** The best company-side form URL a job row offers, or null when it only has a job-board link. */
function formUrlOf(job: JobLinks): string | null {
  if (job.apply_url && !isJobBoardUrl(job.apply_url)) return job.apply_url;
  if (!isJobBoardUrl(job.url)) return job.url;
  return null;
}

export async function resolveApplyTarget(app: ApplicationDetail): Promise<ApplyTarget> {
  const [own] = await jobLinks(`SELECT id, title, url, apply_url, source FROM jobs WHERE id = $1`, [app.job_id]);
  if (own?.apply_url && !isJobBoardUrl(own.apply_url)) {
    return { url: own.apply_url, via: "company-link", note: "The posting's link to the company's own application form." };
  }
  if (!isJobBoardUrl(app.url)) return { url: app.url, via: "posting", note: "The posting is on the company's own site." };

  const key = roleKey(app.title);
  if (key.length > 3) {
    const siblings = await jobLinks(
      `SELECT id, title, url, apply_url, source FROM jobs
        WHERE company_id = $1 AND id <> $2 AND closed_at IS NULL
        ORDER BY CASE WHEN source IN ('linkedin', 'indeed') THEN 1 ELSE 0 END, last_seen_at DESC`,
      [app.company_id, app.job_id],
    );
    for (const s of siblings) {
      if (roleKey(s.title) !== key) continue;
      const url = formUrlOf(s);
      if (url) {
        return { url, via: "same-role-elsewhere", note: `Same role at ${app.company_name} found on ${s.source ?? "another source"} with a company form.` };
      }
    }
  }
  return { url: app.url, via: "posting", note: "Only the job-board posting is known: no company form found." };
}
