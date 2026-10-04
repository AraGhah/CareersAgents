// "Has this already been sent?" is asked twice: before anything opens, and again
// right before Submit. Five ways the same application can already exist:
//   1. the application's own status is past "ready"
//   2. a portal run for it already submitted
//   3. an email for it was already sent
//   4. the same role at the same company was applied to under another posting
//      (the same job found on LinkedIn and on the company's Greenhouse board)
//   5. the same canonical posting URL was already submitted by another run

import { pool } from "../db";
import type { ApplicationDetail } from "../types";
import { canonicalPostingUrl } from "./platforms";
import { norm } from "./text";

const DONE_STATUSES = ["applied", "followup", "interview", "accepted", "rejected", "withdrawn"];

/** A language tag a portal appends to the copy of a posting in the other language ("… Environnement immersif-EN"). */
const LANGUAGE_SUFFIX = /\s*[-–—(]\s*(EN|FR|ENG|FRA|English|Anglais|French|Fran[cç]ais)\s*\)?\s*$/i;

/** Title without the internship noise, so "Software Developer Intern (Winter 2027)" ≈ "Stage – Software Developer Intern". */
export function roleKey(title: string): string {
  return norm(title.replace(LANGUAGE_SUFFIX, ""))
    .replace(/\b(winter|summer|fall|hiver|ete|automne|spring|printemps)\b|\b20\d{2}\b|\b(intern(ship)?|stage|stagiaire|co.?op|student)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One key per (company, role): the same role listed under several postings (Indeed and LinkedIn give
 * one job two ids) shares it. Null when the title is too generic to compare.
 */
export function twinKey(companyId: string, title: string): string | null {
  const key = roleKey(title);
  return key.length > 3 ? `${companyId}|${key}` : null;
}

/** A program or requisition code after a final dash ("Intern Cloud Developer – FCAP"). */
const TRAILING_CODE = /\s*[–—-]\s*[A-Z0-9]{3,6}\s*$/;

/**
 * twinKey for a whole list at once, so a copy that only adds a trailing code ("… Cloud Developer – FCAP") joins the
 * plain one ("… Cloud Developer") when the plain one is in the list. Only then: on its own, "Developer – SAP" and
 * "Developer – AWS" stay two roles.
 */
export function twinKeys<T extends { company_id: string; title: string }>(rows: readonly T[]): Map<T, string | null> {
  const plain = new Set(rows.map((r) => twinKey(r.company_id, r.title)).filter((k): k is string => !!k));
  const out = new Map<T, string | null>();
  for (const r of rows) {
    const key = twinKey(r.company_id, r.title);
    const stripped = TRAILING_CODE.test(r.title) ? twinKey(r.company_id, r.title.replace(TRAILING_CODE, "")) : null;
    out.set(r, stripped && stripped !== key && plain.has(stripped) ? stripped : key);
  }
  return out;
}

export async function duplicateReason(app: ApplicationDetail, alsoUrls: string[] = []): Promise<string | null> {
  if (DONE_STATUSES.includes(app.status)) return `Already marked "${app.status}" on ${app.submitted_at ? new Date(app.submitted_at).toISOString().slice(0, 10) : "an earlier date"}.`;

  const { rows: submitted } = await pool.query<{ submitted_at: Date }>(
    `SELECT submitted_at FROM portal_runs WHERE application_id = $1 AND state = 'submitted' LIMIT 1`,
    [app.id],
  );
  if (submitted[0]) return "A portal application was already submitted for this posting.";

  const { rows: mailed } = await pool.query<{ to_email: string }>(
    `SELECT to_email FROM outreach_drafts
      WHERE application_id = $1 AND (sent_at IS NOT NULL OR sent_detected_at IS NOT NULL) LIMIT 1`,
    [app.id],
  );
  if (mailed[0]) return `Already applied by email to ${mailed[0].to_email}.`;

  const { rows: siblings } = await pool.query<{ id: string; title: string; status: string; url: string }>(
    `SELECT a.id, j.title, a.status, j.url
       FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE j.company_id = $1 AND a.id <> $2
        AND (a.status = ANY($3::text[]) OR EXISTS (SELECT 1 FROM portal_runs r WHERE r.application_id = a.id AND r.state = 'submitted'))`,
    [app.company_id, app.id, DONE_STATUSES],
  );
  const all = [{ company_id: app.company_id, title: app.title }, ...siblings.map((s) => ({ company_id: app.company_id, title: s.title }))];
  const keys = twinKeys(all);
  const key = keys.get(all[0]);
  const twin = key ? siblings.find((_, i) => keys.get(all[i + 1]) === key) : undefined;
  if (twin) return `The same role at ${app.company_name} was already applied to ("${twin.title}", application ${twin.id.slice(0, 8)}).`;

  const mine = new Set([app.url, ...alsoUrls].map(canonicalPostingUrl));
  const { rows: sameUrl } = await pool.query<{ posting_url: string; form_url: string | null }>(
    `SELECT posting_url, form_url FROM portal_runs WHERE state = 'submitted' AND application_id <> $1`,
    [app.id],
  );
  if (sameUrl.some((r) => mine.has(canonicalPostingUrl(r.posting_url)) || (r.form_url && mine.has(canonicalPostingUrl(r.form_url))))) {
    return "This posting URL was already submitted under another application.";
  }
  return null;
}
