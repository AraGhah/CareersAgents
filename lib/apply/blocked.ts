// The internships the desk tried and could not send by itself (a CAPTCHA, an account wall, a LinkedIn or Indeed-only
// posting, a form it could not read or finish), with everything it had already prepared, for /blocked: you apply there
// yourself with the answers, the CV and the letter in hand. A posting set aside for a weak fit is not blocked, it is
// not a fit; one already sent, closed or set aside ("Pas celle-ci") is not shown.

import { pool } from "../db";
import { twinKeys } from "./dedupe";

export type BlockedInternship = {
  application_id: string;
  company_name: string;
  title: string;
  location: string | null;
  posting_url: string;
  /** The company's own form when the desk found it, else the posting. */
  form_url: string;
  /** Why the desk stopped, as the batch or the form run wrote it. */
  reason: string;
  blocked_at: Date | null;
  score: number | null;
  lang: string | null;
  /** The newest form run that prepared answers or took a screenshot, when there was one. */
  run_id: string | null;
  screenshot_path: string | null;
  has_cv: boolean;
  has_tailored_cv: boolean;
  has_letter: boolean;
};

export type PreparedAnswer = { label: string; value: string; kind: string; required: boolean; step: number | null };

export type SavedInfo = { key: string; label: string; en: string | null; fr: string | null };

/** "Avis d'adéquation 1/5" is a weak fit and "Déjà envoyée" a duplicate: neither is a posting to finish by hand. */
const NOT_BLOCKED = `(i.detail LIKE 'Avis d''adéquation%' OR i.detail LIKE 'Déjà envoyée%' OR i.detail LIKE 'Déjà en cours%')`;

/** A posting the employer closed is over, not blocked. */
const CLOSED = /n.acceptons plus de candidatures|no longer accepting|posting is closed|offre est (ferm|expir)|has been filled/i;

export async function listBlocked(): Promise<BlockedInternship[]> {
  const { rows } = await pool.query<BlockedInternship & { company_id: string }>(
    `WITH item AS (
       SELECT DISTINCT ON (i.application_id) i.application_id, i.outcome, i.detail, i.score, COALESCE(i.finished_at, i.started_at) AS at,
              ${NOT_BLOCKED} AS not_blocked
         FROM auto_apply_items i
        ORDER BY i.application_id, i.started_at DESC
     ),
     run AS (
       SELECT DISTINCT ON (r.application_id) r.application_id, r.id, r.state, r.blocked_reason, r.error, r.screenshot_path,
              r.form_url, r.lang, r.resume_path, r.cover_letter_path, COALESCE(r.finished_at, r.started_at) AS at
         FROM portal_runs r
        ORDER BY r.application_id, r.started_at DESC
     ),
     -- The newest run that left something to show: answers it prepared, or a screenshot of where it stopped.
     shown AS (
       SELECT DISTINCT ON (r.application_id) r.application_id, r.id, r.screenshot_path
         FROM portal_runs r
        WHERE r.screenshot_path IS NOT NULL
           OR EXISTS (SELECT 1 FROM portal_fields f WHERE f.run_id = r.id AND f.value IS NOT NULL AND btrim(f.value) <> '')
        ORDER BY r.application_id,
                 EXISTS (SELECT 1 FROM portal_fields f WHERE f.run_id = r.id AND f.value IS NOT NULL AND btrim(f.value) <> '') DESC,
                 r.started_at DESC
     )
     SELECT a.id AS application_id, c.id AS company_id, c.name AS company_name, j.title, j.location, j.url AS posting_url,
            COALESCE(r.form_url, j.apply_url, j.url) AS form_url,
            COALESCE(
              CASE WHEN r.state IN ('blocked', 'failed', 'needs_review') AND (it.at IS NULL OR r.at >= it.at)
                   THEN COALESCE(r.blocked_reason, r.error) END,
              it.detail, r.blocked_reason, r.error, 'Stopped without a reason recorded.') AS reason,
            GREATEST(it.at, r.at) AS blocked_at, it.score::float AS score, r.lang,
            sh.id AS run_id, sh.screenshot_path,
            (a.resume_path IS NOT NULL OR r.resume_path IS NOT NULL OR a.resume_id IS NOT NULL) AS has_cv,
            a.tailored_cv_path IS NOT NULL AS has_tailored_cv,
            (a.cover_letter_path IS NOT NULL OR r.cover_letter_path IS NOT NULL) AS has_letter
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN item it ON it.application_id = a.id
       LEFT JOIN run r ON r.application_id = a.id
       LEFT JOIN shown sh ON sh.application_id = a.id
      WHERE a.status IN ('discovered', 'qualified', 'ready')
        AND a.approval_dismissed_at IS NULL
        AND j.closed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM portal_runs s WHERE s.application_id = a.id AND s.state = 'submitted')
        AND COALESCE(r.state, '') NOT IN ('ready_to_submit', 'submitted', 'duplicate', 'filling', 'planning')
        AND (
          (it.application_id IS NOT NULL AND NOT it.not_blocked AND it.outcome IN ('skipped', 'review', 'failed'))
          OR (r.state IN ('blocked', 'failed', 'needs_review') AND (it.application_id IS NULL OR NOT it.not_blocked))
        )
      ORDER BY it.score DESC NULLS LAST, blocked_at DESC NULLS LAST`,
  );
  // One card per role: the same posting found on LinkedIn, Indeed and the company's site is one internship to apply to.
  // The rows come best first, so the first of each role is the one kept (the one with the most prepared wins a tie).
  const open = rows.filter((r) => !CLOSED.test(r.reason));
  const keys = twinKeys(open);
  const seen = new Set<string>();
  return open
    .filter((r) => {
      const k = keys.get(r) ?? r.application_id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** What the newest form run had decided for each question, filled or not: the answers to copy into the form. */
export async function preparedAnswers(runId: string): Promise<PreparedAnswer[]> {
  const { rows } = await pool.query<PreparedAnswer>(
    `SELECT label, value, kind, required, step FROM portal_fields
      WHERE run_id = $1 AND value IS NOT NULL AND btrim(value) <> '' AND status <> 'skipped'
      ORDER BY step NULLS FIRST, required DESC, label`,
    [runId],
  );
  return rows;
}

/** The answer-bank facts every form asks for, in the order a form asks them. Sensitive (red) answers are never shown. */
const SAVED: Array<[key: string, label: string]> = [
  ["full_name", "Full name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["phone_device_type", "Phone type"],
  ["street_address", "Street address"],
  ["city", "City"],
  ["postal_code", "Postal code"],
  ["links", "Links (LinkedIn, GitHub, portfolio)"],
  ["school_program", "School and program"],
  ["graduation_date", "Graduation"],
  ["available_from", "Available from"],
  ["languages", "Languages"],
  ["how_heard", "How you heard about the job"],
];

export async function savedInfo(): Promise<SavedInfo[]> {
  const { rows } = await pool.query<{ key: string; answer_en: string | null; answer_fr: string | null }>(
    `SELECT key, answer_en, answer_fr FROM answers WHERE category = 'green' AND key = ANY($1::text[])`,
    [SAVED.map(([k]) => k)],
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SAVED.flatMap(([key, label]) => {
    const r = byKey.get(key);
    return r && (r.answer_en || r.answer_fr) ? [{ key, label, en: r.answer_en, fr: r.answer_fr }] : [];
  });
}
