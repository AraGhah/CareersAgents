// Which postings "Postuler automatiquement" goes after, best score first. Only SQL and one pure step, so the rules
// can be read here and tested without opening a browser or touching Gmail.

import { pool } from "../db";
import { twinKey } from "../apply/dedupe";
import { SCORE_CTE } from "../queries";
import type { ApplicationStatus } from "../types";

/** Below this a posting is not "worth applying to": the same line the Offres list draws by default (60 and over). */
export const DEFAULT_MIN_SCORE = 60;

export function configuredMinScore(): number {
  const n = Number(process.env.AUTO_APPLY_MIN_SCORE);
  return process.env.AUTO_APPLY_MIN_SCORE?.trim() && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : DEFAULT_MIN_SCORE;
}

export type Candidate = {
  job_id: string;
  company_id: string;
  company_name: string;
  title: string;
  /** null until the posting is tracked. */
  application_id: string | null;
  status: ApplicationStatus | null;
  channel: "email" | "portal" | "manual" | null;
  /** 0 to 1. */
  score: number;
};

/**
 * Open, scored, not rejected, and nothing of yours on it yet. Left out on purpose:
 *   - an application that already went out, or whose Gmail draft is waiting for you to send it;
 *   - one the desk already knows it cannot drive (channel "manual": Workday-style account portals);
 *   - one whose form was filled and waits for you, or was blocked, in the last 7 days (a retry would stop at the same place).
 * Best score first, then the most recently seen.
 */
async function eligibleRows(minPercent: number, limit: number): Promise<Candidate[]> {
  const { rows } = await pool.query<Omit<Candidate, "score"> & { score: string }>(
    `${SCORE_CTE}
     SELECT j.id AS job_id, j.company_id, c.name AS company_name, j.title,
            a.id AS application_id, a.status, a.channel, t.score
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       JOIN totals t ON t.job_id = j.id
       LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.closed_at IS NULL
        AND t.gated IS NOT TRUE
        AND t.score >= $1
        AND (a.id IS NULL OR a.status IN ('discovered', 'qualified', 'ready'))
        AND COALESCE(a.channel, '') <> 'manual'
        AND NOT EXISTS (
          SELECT 1 FROM outreach_drafts o
           WHERE o.application_id = a.id AND o.gmail_draft_id IS NOT NULL
             AND o.sent_at IS NULL AND o.sent_detected_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM portal_runs r
           WHERE r.application_id = a.id AND r.started_at > now() - interval '7 days'
             AND r.state IN ('planning', 'needs_review', 'filling', 'ready_to_submit', 'blocked'))
      ORDER BY t.score DESC, j.first_seen_at DESC, j.id
      LIMIT $2`,
    [minPercent / 100, limit],
  );
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

/** (company, role) keys of applications that are already out or whose Gmail draft is waiting: a twin posting of one is not a new application. */
async function takenKeys(): Promise<Set<string>> {
  const { rows } = await pool.query<{ company_id: string; title: string }>(
    `SELECT j.company_id, j.title
       FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.status IN ('applied', 'followup', 'interview', 'accepted', 'rejected', 'withdrawn')
         OR EXISTS (SELECT 1 FROM outreach_drafts o
                     WHERE o.application_id = a.id AND o.gmail_draft_id IS NOT NULL
                       AND o.sent_at IS NULL AND o.sent_detected_at IS NULL)`,
  );
  const keys = new Set<string>();
  for (const r of rows) {
    const key = twinKey(r.company_id, r.title);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Indeed and LinkedIn list one role under two ids: keep the better-scored copy and drop its twins, and drop any
 * posting whose twin is already taken. Input must already be in the order wanted (best first); that order is kept.
 */
export function dropTwins<T extends { company_id: string; title: string }>(rows: T[], taken: ReadonlySet<string> = new Set()): T[] {
  const seen = new Set(taken);
  const out: T[] = [];
  for (const row of rows) {
    const key = twinKey(row.company_id, row.title);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(row);
  }
  return out;
}

/** Postings to try, best score first. `limit` bounds how many are looked at, not how many get applied to. */
export async function rankedCandidates(opts: { minPercent: number; limit: number }): Promise<Candidate[]> {
  // Twins are dropped after the query, so over-fetch a little to still have `limit` left.
  const rows = await eligibleRows(opts.minPercent, opts.limit * 2 + 20);
  return dropTwins(rows, await takenKeys()).slice(0, opts.limit);
}

/** How many postings the button could go after right now. */
export async function countEligible(minPercent: number): Promise<number> {
  return (await rankedCandidates({ minPercent, limit: 500 })).length;
}
