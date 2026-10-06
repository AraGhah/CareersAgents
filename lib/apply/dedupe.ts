// "Has this already been sent?" is asked twice: before anything opens, and again
// right before Submit. Five ways the same application can already exist:
//   1. the application's own status is past "ready"
//   2. a portal run for it already submitted
//   3. an email for it was already sent
//   4. the same role at the same company was applied to under another posting
//      (the same job found on LinkedIn and on the company's Greenhouse board)
//   5. the same canonical posting URL was already submitted by another run
//   6. a run clicked Submit and the portal never confirmed: it may have gone through, so it is not tried again
//   7. the company's own system lists the form's job under another title that was applied to (CGI's Njoyn names each
//      job in English and in French: "Winter 2027 Co-op: AS400 Developer" is "Stage coopératif - Hiver 2027: Développeur AS400")

import { pool } from "../db";
import type { ApplicationDetail } from "../types";
import { boardFromUrl, searchBoard } from "./boards";
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

/** The application done under one of the names the company's own system gives this job, if any. */
export function appliedUnderOtherName<T extends { title: string }>(companyId: string, names: string[], done: T[]): T | undefined {
  if (names.length === 0) return undefined;
  const rows = [...names, ...done.map((d) => d.title)].map((title) => ({ company_id: companyId, title }));
  const keys = twinKeys(rows);
  const wanted = new Set(rows.slice(0, names.length).map((r) => keys.get(r)).filter((k): k is string => !!k));
  return done.find((_, i) => wanted.has(keys.get(rows[names.length + i]) ?? ""));
}

/** The titles the company's own system lists a form's job under (one per language on Njoyn), or none when it is not one. */
async function otherNames(formUrls: string[], title: string): Promise<string[]> {
  for (const u of formUrls) {
    const board = boardFromUrl(u);
    if (!board) continue;
    const canon = canonicalPostingUrl(u);
    return (await searchBoard(board, title)).filter((j) => canonicalPostingUrl(j.url) === canon).map((j) => j.title);
  }
  return [];
}

export async function duplicateReason(app: ApplicationDetail, alsoUrls: string[] = []): Promise<string | null> {
  if (DONE_STATUSES.includes(app.status)) return `Already marked "${app.status}" on ${app.submitted_at ? new Date(app.submitted_at).toISOString().slice(0, 10) : "an earlier date"}.`;

  const { rows: submitted } = await pool.query<{ submitted_at: Date }>(
    `SELECT submitted_at FROM portal_runs WHERE application_id = $1 AND state = 'submitted' LIMIT 1`,
    [app.id],
  );
  if (submitted[0]) return "A portal application was already submitted for this posting.";

  try {
    const { rows: clicked } = await pool.query<{ submit_clicked_at: Date }>(
      `SELECT submit_clicked_at FROM portal_runs
        WHERE application_id = $1 AND submit_clicked_at IS NOT NULL AND state <> 'submitted'
        ORDER BY submit_clicked_at DESC LIMIT 1`,
      [app.id],
    );
    if (clicked[0]) {
      const day = new Date(clicked[0].submit_clicked_at).toISOString().slice(0, 10);
      return `Submit was clicked on ${day} without a confirmation, so it may have gone through: check the portal or your inbox, then mark it sent ("J'ai postulé") or finish it there yourself.`;
    }
  } catch (err) {
    // Before schema-v15.sql there is no submit_clicked_at column.
    if ((err as { code?: string }).code !== "42703") throw err;
  }

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

  if (siblings.length) {
    const named = await otherNames(alsoUrls, app.title);
    const same = appliedUnderOtherName(app.company_id, named, siblings);
    if (same) return `${app.company_name}'s own site lists this job also as "${same.title}", already applied to (application ${same.id.slice(0, 8)}).`;
  }

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
