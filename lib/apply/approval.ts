// The step between "the careers form is filled and validated" and "it is submitted" (PORTAL_SUBMIT=approve, the default):
// the daily run fills each form headless and stops; /approvals shows what it wrote; "Approuver et envoyer" records your
// approval and a submit run, which may press Submit only while that approval stands. One approval, one attempt: the run
// clears it, whatever happened, so a form that was blocked is shown to you again before it is tried again.

import { pool } from "../db";

/** An approval is acted on the same day or not at all: a form left for days may have changed under it. */
const APPROVAL_HOURS = 24;

function missingColumn(err: unknown): boolean {
  return (err as { code?: string }).code === "42703";
}

/** Did you approve this application's filled form, recently enough to act on it? */
export async function submitApproved(applicationId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT submit_approved_at > now() - make_interval(hours => $2) AS ok FROM applications WHERE id = $1`,
      [applicationId, APPROVAL_HOURS],
    );
    return rows[0]?.ok === true;
  } catch (err) {
    if (missingColumn(err)) return false;
    throw err;
  }
}

export async function clearSubmitApproval(applicationId: string): Promise<void> {
  try {
    await pool.query(`UPDATE applications SET submit_approved_at = NULL WHERE id = $1`, [applicationId]);
  } catch (err) {
    if (!missingColumn(err)) throw err;
  }
}

export type AwaitingApproval = {
  application_id: string;
  run_id: string;
  company_name: string;
  title: string;
  location: string | null;
  posting_url: string;
  form_url: string;
  finished_at: Date | null;
  reason: string | null;
  screenshot_path: string | null;
  approved_at: Date | null;
  score: number | null;
};

/**
 * Applications whose newest form run ended filled and validated (ready_to_submit), not submitted, not set aside: what
 * waits for your yes. An approved one still shows (as "sending") until its submit run has run.
 */
export async function listAwaitingApproval(): Promise<AwaitingApproval[]> {
  const { rows } = await pool.query<AwaitingApproval>(
    `WITH latest AS (
       SELECT DISTINCT ON (r.application_id) r.application_id, r.id AS run_id, r.state, r.finished_at, r.blocked_reason, r.screenshot_path
         FROM portal_runs r
        ORDER BY r.application_id, r.started_at DESC
     )
     SELECT a.id AS application_id, l.run_id, c.name AS company_name, j.title, j.location, j.url AS posting_url,
            COALESCE(j.apply_url, j.url) AS form_url, l.finished_at, l.blocked_reason AS reason, l.screenshot_path,
            a.submit_approved_at AS approved_at, NULL::float AS score
       FROM latest l
       JOIN applications a ON a.id = l.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE l.state = 'ready_to_submit'
        AND a.status IN ('qualified', 'ready')
        AND a.approval_dismissed_at IS NULL
        AND j.closed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM portal_runs s WHERE s.application_id = a.id AND s.state = 'submitted')
      ORDER BY a.submit_approved_at NULLS LAST, l.finished_at DESC NULLS LAST`,
  );
  return rows;
}

export type FilledField = { label: string; value: string | null; status: string; required: boolean; kind: string; step: number | null };

/** What the run wrote into the form, page by page, for you to read before approving. */
export async function filledFields(runId: string): Promise<FilledField[]> {
  const { rows } = await pool.query<FilledField>(
    `SELECT label, value, status, required, kind, step FROM portal_fields WHERE run_id = $1 ORDER BY step NULLS FIRST, label`,
    [runId],
  );
  return rows;
}

/**
 * Your yes to one filled form. Every value the run wrote is approved as written, so the submit run types exactly what
 * you read (lib/apply/planner.ts keeps approved values), and the application is marked for submission. Refused when the
 * form is not the latest filled and validated run of this application.
 */
export async function approveForSubmit(applicationId: string, runId: string): Promise<void> {
  const { rows } = await pool.query<{ run_id: string; state: string }>(
    `SELECT id AS run_id, state FROM portal_runs WHERE application_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [applicationId],
  );
  if (!rows[0] || rows[0].run_id !== runId || rows[0].state !== "ready_to_submit") {
    throw new Error("This form is no longer the one waiting: reload the page.");
  }
  await pool.query(
    `UPDATE portal_fields SET approved_at = now()
      WHERE run_id = $1 AND value IS NOT NULL AND kind <> 'file' AND approved_at IS NULL AND status <> 'failed'`,
    [runId],
  );
  await pool.query(`UPDATE applications SET submit_approved_at = now(), approval_dismissed_at = NULL WHERE id = $1`, [applicationId]);
}

/** "Pas celle-ci": off the approval list and out of the daily batch, until you open it again from its page. */
export async function dismissApproval(applicationId: string): Promise<void> {
  await pool.query(`UPDATE applications SET approval_dismissed_at = now(), submit_approved_at = NULL WHERE id = $1`, [applicationId]);
}

/** Approved forms whose submit run has not run yet, oldest approval first. */
export async function approvedQueue(): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT a.id FROM applications a
        WHERE a.submit_approved_at > now() - make_interval(hours => $1)
          AND a.status IN ('qualified', 'ready')
          AND NOT EXISTS (SELECT 1 FROM portal_runs s WHERE s.application_id = a.id AND s.state = 'submitted')
        ORDER BY a.submit_approved_at`,
      [APPROVAL_HOURS],
    );
    return rows.map((r) => r.id);
  } catch (err) {
    if (missingColumn(err)) return [];
    throw err;
  }
}
