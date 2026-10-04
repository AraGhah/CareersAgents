// Persistence for portal applications: runs, their fields, errors, and the
// approvals that feed the writing-style profile. schema-v11.sql.

import { pool } from "../db";
import { redact } from "./account-config";
import { recordWritingSample } from "./answers/style";
import type { Check, FieldDecision, Lang, PlatformId, PreflightItem, QuestionType, RunMode, RunState } from "./types";

export type PortalRunRow = {
  id: string;
  application_id: string;
  mode: RunMode;
  state: RunState;
  platform: PlatformId | null;
  posting_url: string;
  form_url: string | null;
  company_name: string;
  role_title: string;
  lang: Lang | null;
  resume_id: string | null;
  resume_path: string | null;
  resume_reason: string | null;
  cover_letter_path: string | null;
  cover_letter_required: boolean;
  field_count: number;
  required_count: number;
  manual_count: number;
  preflight: PreflightItem[];
  blocked_reason: string | null;
  error: string | null;
  screenshot_path: string | null;
  confirmation_text: string | null;
  /** Pages of the form the run went through. */
  step_count: number | null;
  /** The page the run stopped on because something needs you; null when it did not stop early. */
  stop_step: number | null;
  started_at: Date;
  finished_at: Date | null;
  submitted_at: Date | null;
};

export type PortalFieldRow = {
  id: string;
  run_id: string;
  signature: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[];
  intent: string;
  source: string;
  value: string | null;
  status: FieldDecision["status"];
  reason: string | null;
  checks: Check[];
  edited: boolean;
  approved_at: Date | null;
  step: number | null;
};

const RUN_COLUMNS = `id, application_id, mode, state, platform, posting_url, form_url, company_name, role_title, lang,
  resume_id, resume_path, resume_reason, cover_letter_path, cover_letter_required, field_count, required_count,
  manual_count, preflight, blocked_reason, error, screenshot_path, confirmation_text, step_count, stop_step, started_at, finished_at, submitted_at`;

export async function createRun(opts: {
  applicationId: string;
  mode: RunMode;
  postingUrl: string;
  companyName: string;
  roleTitle: string;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO portal_runs (application_id, mode, posting_url, company_name, role_title)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.applicationId, opts.mode, opts.postingUrl, opts.companyName, opts.roleTitle],
  );
  return rows[0].id;
}

type RunPatch = Partial<Omit<PortalRunRow, "id" | "application_id" | "started_at">>;

export async function updateRun(id: string, patch: RunPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}${k === "preflight" ? "::jsonb" : ""}`);
  const values = entries.map(([k, v]) => (k === "preflight" ? JSON.stringify(v) : v));
  await pool.query(`UPDATE portal_runs SET ${sets.join(", ")} WHERE id = $1`, [id, ...values]);
}

export async function finishRun(id: string, state: RunState, patch: RunPatch = {}): Promise<void> {
  await updateRun(id, { ...patch, state, finished_at: new Date() });
}

/**
 * Records (or clears) that this run clicked a final Submit (schema-v15.sql). Set before the click; cleared when the
 * portal plainly refused the submission, so only a click that may have gone through keeps the application from being
 * tried again.
 */
export async function markSubmitClicked(runId: string, clicked: boolean): Promise<void> {
  try {
    await pool.query(`UPDATE portal_runs SET submit_clicked_at = ${clicked ? "now()" : "NULL"} WHERE id = $1`, [runId]);
  } catch (err) {
    // Before schema-v15.sql there is no such column: the run is still recorded as blocked, as it always was.
    if ((err as { code?: string }).code !== "42703") throw err;
  }
}

export async function saveFields(runId: string, decisions: FieldDecision[]): Promise<void> {
  for (const d of decisions) {
    await pool.query(
      `INSERT INTO portal_fields (run_id, signature, label, kind, required, options, intent, source, value, status, reason, checks, step)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13)
       ON CONFLICT (run_id, signature) DO UPDATE SET
         label = EXCLUDED.label, kind = EXCLUDED.kind, required = EXCLUDED.required, options = EXCLUDED.options,
         intent = EXCLUDED.intent,
         -- A value a person approved or typed survives a re-plan.
         source = CASE WHEN portal_fields.status = 'approved' THEN portal_fields.source ELSE EXCLUDED.source END,
         value  = CASE WHEN portal_fields.status = 'approved' THEN portal_fields.value  ELSE EXCLUDED.value  END,
         status = CASE WHEN portal_fields.status = 'approved' AND EXCLUDED.status NOT IN ('filled','failed') THEN 'approved' ELSE EXCLUDED.status END,
         reason = EXCLUDED.reason, checks = EXCLUDED.checks, step = COALESCE(EXCLUDED.step, portal_fields.step)`,
      [
        runId,
        d.signature,
        d.label,
        d.kind,
        d.required,
        JSON.stringify(d.options),
        d.questionType ? `${d.intent}:${d.questionType}` : d.intent,
        d.source,
        d.value,
        d.status,
        d.reason,
        JSON.stringify(d.checks),
        d.step ?? null,
      ],
    );
  }
}

export async function listRunFields(runId: string): Promise<PortalFieldRow[]> {
  const { rows } = await pool.query<PortalFieldRow>(
    `SELECT id, run_id, signature, label, kind, required, options, intent, source, value, status, reason, checks, edited, approved_at, step
       FROM portal_fields WHERE run_id = $1
      ORDER BY CASE status WHEN 'manual' THEN 0 WHEN 'generated' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, label`,
    [runId],
  );
  return rows;
}

export async function getRun(id: string): Promise<PortalRunRow | null> {
  const { rows } = await pool.query<PortalRunRow>(`SELECT ${RUN_COLUMNS} FROM portal_runs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function latestRun(applicationId: string): Promise<PortalRunRow | null> {
  const { rows } = await pool.query<PortalRunRow>(
    `SELECT ${RUN_COLUMNS} FROM portal_runs WHERE application_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [applicationId],
  );
  return rows[0] ?? null;
}

/** The newest run that carries a plan (fields), so approvals made on it carry into the next execute. */
export async function latestPlannedRun(applicationId: string): Promise<PortalRunRow | null> {
  const { rows } = await pool.query<PortalRunRow>(
    `SELECT ${RUN_COLUMNS.split(",").map((c) => `r.${c.trim()}`).join(", ")}
       FROM portal_runs r
      WHERE r.application_id = $1 AND EXISTS (SELECT 1 FROM portal_fields f WHERE f.run_id = r.id)
      ORDER BY r.started_at DESC LIMIT 1`,
    [applicationId],
  );
  return rows[0] ?? null;
}

export async function listRuns(limit = 200): Promise<PortalRunRow[]> {
  const { rows } = await pool.query<PortalRunRow>(
    `SELECT ${RUN_COLUMNS} FROM portal_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function logPortalError(opts: {
  applicationId: string | null;
  runId: string | null;
  stage: string;
  error: unknown;
  detail?: Record<string, unknown>;
}): Promise<void> {
  // What is saved never carries the portal account's password, even if an error message quotes what was typed.
  const message = redact(opts.error instanceof Error ? opts.error.message : String(opts.error));
  await pool
    .query(`INSERT INTO portal_errors (application_id, run_id, stage, message, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`, [
      opts.applicationId,
      opts.runId,
      opts.stage,
      message.slice(0, 2000),
      redact(JSON.stringify({ ...(opts.detail ?? {}), stack: opts.error instanceof Error ? opts.error.stack?.split("\n").slice(0, 6) : undefined })),
    ])
    .catch((err) => console.error("[portal] could not log error:", err));
}

export async function listPortalErrors(limit = 50) {
  const { rows } = await pool.query<{
    id: string;
    application_id: string | null;
    run_id: string | null;
    stage: string;
    message: string;
    created_at: Date;
  }>(`SELECT id, application_id, run_id, stage, message, created_at FROM portal_errors ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows;
}

/**
 * A person approved a field, possibly after rewriting it. Written answers that were
 * approved or rewritten become writing samples, which is how later answers learn
 * the candidate's voice.
 */
export async function approveField(opts: { fieldId: string; value: string; applicationId: string; runId?: string; lang: Lang }): Promise<void> {
  // The field must be one of this application's (and this run's, when given): a value is never written into another
  // application's plan, nor recorded as a writing sample under the wrong one.
  const { rows } = await pool.query<PortalFieldRow>(
    `SELECT f.id, f.run_id, f.signature, f.label, f.kind, f.required, f.options, f.intent, f.source, f.value, f.status, f.reason,
            f.checks, f.edited, f.approved_at, f.step
       FROM portal_fields f JOIN portal_runs r ON r.id = f.run_id
      WHERE f.id = $1 AND r.application_id = $2 AND ($3::uuid IS NULL OR f.run_id = $3::uuid)`,
    [opts.fieldId, opts.applicationId, opts.runId ?? null],
  );
  const field = rows[0];
  if (!field) throw new Error("field not found for this application");
  // A file field's value is a path on disk: it is set by the desk (the CV or letter it stored), never typed here.
  if (field.kind === "file") throw new Error("A file field cannot be set by hand: the desk attaches the stored CV or letter.");
  const value = opts.value.trim();
  const edited = (field.value ?? "").trim() !== value;
  await pool.query(
    `UPDATE portal_fields
        SET value = $2, status = 'approved', edited = edited OR $3, approved_at = now(),
            source = CASE WHEN $3 OR source = 'none' THEN 'user' ELSE source END
      WHERE id = $1`,
    [opts.fieldId, value, edited],
  );
  const [intent, questionType] = field.intent.split(":");
  if (intent === "open_question" && value) {
    await recordWritingSample({
      question: field.label,
      questionType: (questionType ?? "generic") as QuestionType,
      answer: value,
      lang: opts.lang,
      edited,
      applicationId: opts.applicationId,
    });
  }
}

/**
 * The newest approval for every field of this application, across all its runs. A fill run
 * stores its own copy of the fields, so approvals made on any earlier run must still count.
 */
export async function listApprovals(applicationId: string): Promise<Array<{ signature: string; status: string; value: string | null; source: string }>> {
  const { rows } = await pool.query<{ signature: string; value: string | null; source: string }>(
    `SELECT DISTINCT ON (f.signature) f.signature, f.value, f.source
       FROM portal_fields f JOIN portal_runs r ON r.id = f.run_id
      WHERE r.application_id = $1 AND f.approved_at IS NOT NULL
      ORDER BY f.signature, f.approved_at DESC`,
    [applicationId],
  );
  return rows.map((r) => ({ ...r, status: "approved" }));
}

/** Fields of a run still waiting for a person (same rule as the preflight's "nothing pending"). */
export async function pendingCount(runId: string, autoApprove: boolean): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM portal_fields
      WHERE run_id = $1
        AND ((status = 'manual' AND (required OR value IS NOT NULL)) OR (status = 'generated' AND NOT $2))`,
    [runId, autoApprove],
  );
  return Number(rows[0].n);
}

/** Every field of the plan is decided: nothing waits for a person. */
export async function planIsComplete(runId: string, autoApprove: boolean): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM portal_fields
      WHERE run_id = $1
        AND (status = 'manual' AND required
             OR status = 'manual' AND value IS NOT NULL
             OR status = 'generated' AND NOT $2
             OR status = 'failed')`,
    [runId, autoApprove],
  );
  return Number(rows[0].n) === 0;
}
