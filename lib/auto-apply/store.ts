// auto_apply_runs / auto_apply_items (schema-v13.sql): what one click on "Postuler automatiquement" did.
// The work runs in its own process (scripts/auto-apply.ts) and writes here as it goes; the page only reads.

import { pool } from "../db";
import type { ApplicationStatus } from "../types";

export type RunState = "running" | "done" | "stopped" | "failed";
export type ItemOutcome = "working" | "draft" | "sent" | "review" | "skipped" | "failed";
export type Channel = "email" | "portal" | "manual";

export type AutoApplyRun = {
  id: string;
  requested: number;
  min_score: number;
  state: RunState;
  stop_requested: boolean;
  note: string | null;
  started_at: Date;
  heartbeat_at: Date;
  finished_at: Date | null;
};

export type AutoApplyItem = {
  id: string;
  position: number;
  application_id: string;
  score: string | null;
  channel: Channel | null;
  outcome: ItemOutcome;
  detail: string | null;
  company_name: string;
  role_title: string;
  /** The application's own status now: a draft you have since sent is "applied". */
  status: ApplicationStatus;
  /** What to show: an application that has since gone out (its draft sent, or applied to by you) is "sent". */
  shown: ItemOutcome;
  /** When the application went out (status "applied" or later), if it has. */
  submitted_at: Date | null;
  /** Where to apply by hand: the company's own form when known, else the posting. */
  apply_url: string;
  /** The newest online-form run for this application, when there is one: where it stopped and why. */
  portal: {
    state: string;
    reason: string | null;
    stop_step: number | null;
    step_count: number | null;
    /** Fields written into the form and read back on that run. */
    filled: number;
    form_url: string | null;
  } | null;
};

/** A run whose process has not touched it for this long is dead (the machine slept, the process was killed). */
const STALE_MINUTES = 15;

const OPEN = ["discovered", "qualified", "ready"];
/** Statuses that mean the application went out. ("rejected"/"withdrawn" can also be a posting you turned down.) */
const SENT = ["applied", "followup", "interview", "accepted"];

/** What one line of the batch shows: an application that went out is "sent", however the batch left it. */
export function shownOutcome(outcome: ItemOutcome, status: string): ItemOutcome {
  return outcome !== "working" && SENT.includes(status) ? "sent" : outcome;
}

/** The batch summary, from what each line shows now (a draft you sent since is counted as sent). */
export function summarize(counts: Partial<Record<ItemOutcome, number>>, requested: number, stopped: boolean): string {
  const n = (k: ItemOutcome) => counts[k] ?? 0;
  const parts = [
    n("sent") ? `${n("sent")} envoyée${n("sent") > 1 ? "s" : ""}` : null,
    n("draft") ? `${n("draft")} brouillon${n("draft") > 1 ? "s" : ""} Gmail à envoyer` : null,
    n("review") ? `${n("review")} à finir toi-même` : null,
    n("skipped") ? `${n("skipped")} ignorée${n("skipped") > 1 ? "s" : ""}` : null,
    n("failed") ? `${n("failed")} en erreur` : null,
  ].filter(Boolean);
  const done = n("draft") + n("sent");
  const head = stopped
    ? "Arrêté."
    : done >= requested
      ? `Objectif atteint : ${done} candidature${done > 1 ? "s" : ""}.`
      : `${done} candidature${done > 1 ? "s" : ""} sur ${requested} demandée${requested > 1 ? "s" : ""} : il n'y avait pas assez d'offres admissibles.`;
  return [head, parts.join(", ")].filter(Boolean).join(" ");
}

export function countShown(items: Array<{ shown: ItemOutcome }>): Partial<Record<ItemOutcome, number>> {
  const counts: Partial<Record<ItemOutcome, number>> = {};
  for (const i of items) counts[i.shown] = (counts[i.shown] ?? 0) + 1;
  return counts;
}

/** Missing table: schema-v13.sql has not been applied. Pages say so instead of failing. */
export function isMissingSchema(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

/** Marks runs whose process died as failed, so the next click is not refused because of a ghost. */
export async function closeStaleRuns(): Promise<void> {
  await pool.query(
    `UPDATE auto_apply_runs
        SET state = 'failed', finished_at = now(), note = COALESCE(note, 'The process stopped answering (closed, or the computer went to sleep).')
      WHERE state = 'running' AND heartbeat_at < now() - make_interval(mins => $1)`,
    [STALE_MINUTES],
  );
}

export async function liveRun(): Promise<AutoApplyRun | null> {
  await closeStaleRuns();
  const { rows } = await pool.query<AutoApplyRun>(`SELECT * FROM auto_apply_runs WHERE state = 'running' ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ?? null;
}

/** Creates the run, or refuses when another is still going: one batch at a time, so two never fill the same form. */
export async function createRun(requested: number, minScore: number): Promise<string> {
  const live = await liveRun();
  if (live) throw new Error("A batch is already running.");
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO auto_apply_runs (requested, min_score) VALUES ($1, $2) RETURNING id`,
      [requested, minScore],
    );
    return rows[0].id;
  } catch (err) {
    // Two clicks at once both pass the check above; the index of schema-v15.sql lets only one insert through.
    if ((err as { code?: string }).code === "23505") throw new Error("A batch is already running.");
    throw err;
  }
}

export async function getRun(id: string): Promise<AutoApplyRun | null> {
  await closeStaleRuns();
  const { rows } = await pool.query<AutoApplyRun>(`SELECT * FROM auto_apply_runs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function latestRun(): Promise<AutoApplyRun | null> {
  await closeStaleRuns();
  const { rows } = await pool.query<AutoApplyRun>(`SELECT * FROM auto_apply_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ?? null;
}

export async function touchRun(id: string): Promise<void> {
  await pool.query(`UPDATE auto_apply_runs SET heartbeat_at = now() WHERE id = $1 AND state = 'running'`, [id]);
}

export async function requestStop(id: string): Promise<void> {
  await pool.query(`UPDATE auto_apply_runs SET stop_requested = true WHERE id = $1 AND state = 'running'`, [id]);
}

export async function stopRequested(id: string): Promise<boolean> {
  const { rows } = await pool.query<{ stop_requested: boolean }>(`SELECT stop_requested FROM auto_apply_runs WHERE id = $1`, [id]);
  return rows[0]?.stop_requested ?? false;
}

export async function finishRun(id: string, state: Exclude<RunState, "running">, note: string | null): Promise<void> {
  await pool.query(`UPDATE auto_apply_runs SET state = $2, note = $3, finished_at = now(), heartbeat_at = now() WHERE id = $1`, [id, state, note]);
}

export async function startItem(runId: string, position: number, applicationId: string, score: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO auto_apply_items (run_id, position, application_id, score) VALUES ($1, $2, $3, $4)
     ON CONFLICT (run_id, application_id) DO UPDATE SET position = EXCLUDED.position
     RETURNING id`,
    [runId, position, applicationId, score],
  );
  await touchRun(runId);
  return rows[0].id;
}

export async function finishItem(
  runId: string,
  itemId: string,
  outcome: Exclude<ItemOutcome, "working">,
  detail: string,
  channel: Channel | null,
): Promise<void> {
  await pool.query(
    `UPDATE auto_apply_items SET outcome = $2, detail = $3, channel = $4, finished_at = now() WHERE id = $1`,
    [itemId, outcome, detail.slice(0, 1500), channel],
  );
  await touchRun(runId);
}

type ItemRow = Omit<AutoApplyItem, "shown" | "portal"> & {
  p_state: string | null;
  p_reason: string | null;
  p_stop_step: number | null;
  p_step_count: number | null;
  p_filled: string | null;
  p_form_url: string | null;
};

export async function listItems(runId: string): Promise<AutoApplyItem[]> {
  const { rows } = await pool.query<ItemRow>(
    `SELECT i.id, i.position, i.application_id, i.score, i.channel, i.outcome, i.detail,
            c.name AS company_name, j.title AS role_title, a.status, a.submitted_at, COALESCE(j.apply_url, j.url) AS apply_url,
            r.state AS p_state, r.blocked_reason AS p_reason, r.stop_step AS p_stop_step, r.step_count AS p_step_count,
            r.form_url AS p_form_url,
            (SELECT count(*) FROM portal_fields f WHERE f.run_id = r.id AND f.status = 'filled')::text AS p_filled
       FROM auto_apply_items i
       JOIN applications a ON a.id = i.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN LATERAL (
         SELECT * FROM portal_runs pr WHERE pr.application_id = a.id ORDER BY pr.started_at DESC LIMIT 1
       ) r ON true
      WHERE i.run_id = $1
      ORDER BY i.position`,
    [runId],
  );
  return rows.map(({ p_state, p_reason, p_stop_step, p_step_count, p_filled, p_form_url, ...r }) => ({
    ...r,
    shown: shownOutcome(r.outcome, r.status),
    portal: p_state
      ? { state: p_state, reason: p_reason, stop_step: p_stop_step, step_count: p_step_count, filled: Number(p_filled ?? 0), form_url: p_form_url }
      : null,
  }));
}

/** Gmail drafts the desk made that you have not sent yet (what "Vérifier les envois" will look for). */
export async function countWaitingDrafts(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM outreach_drafts o JOIN applications a ON a.id = o.application_id
      WHERE o.gmail_draft_id IS NOT NULL AND o.sent_at IS NULL AND o.sent_detected_at IS NULL
        AND o.kind IN ('application', 'outreach') AND a.status = ANY($1::text[])`,
    [OPEN],
  );
  return Number(rows[0].n);
}
