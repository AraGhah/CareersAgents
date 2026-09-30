// Read-side helpers for the desk's portal screens. They return null instead of
// throwing when schema-v11.sql has not been applied yet, so the rest of the
// application page keeps working on an older database.

import { pool } from "../db";
import { getRun, latestPlannedRun, latestRun, listRunFields, type PortalFieldRow, type PortalRunRow } from "./store";

export type PortalView = {
  channel: string | null;
  run: PortalRunRow | null;
  planRun: PortalRunRow | null;
  fields: PortalFieldRow[];
  errors: Array<{ stage: string; message: string; created_at: Date }>;
};

function missingSchema(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "42P01" || code === "42703";
}

export async function loadPortalView(applicationId: string): Promise<PortalView | null> {
  try {
    const [{ rows }, latest, planRun, submitted] = await Promise.all([
      pool.query<{ channel: string | null }>(`SELECT channel FROM applications WHERE id = $1`, [applicationId]),
      latestRun(applicationId),
      latestPlannedRun(applicationId),
      pool.query<{ id: string }>(`SELECT id FROM portal_runs WHERE application_id = $1 AND state = 'submitted' LIMIT 1`, [applicationId]),
    ]);
    // Once submitted, that run is the one worth showing; later "duplicate" refusals are just the guard working.
    const run = submitted.rows[0] ? await getRun(submitted.rows[0].id) : latest;
    const fields = planRun ? await listRunFields(planRun.id) : [];
    const { rows: errors } = await pool.query<{ stage: string; message: string; created_at: Date }>(
      `SELECT stage, message, created_at FROM portal_errors WHERE application_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [applicationId],
    );
    return { channel: rows[0]?.channel ?? null, run, planRun, fields, errors };
  } catch (err) {
    if (missingSchema(err)) return null;
    throw err;
  }
}

export type PortalRunListRow = PortalRunRow & { answers: number; application_status: string };

export async function listPortalRunsForTracking(limit = 300): Promise<PortalRunListRow[] | null> {
  try {
    const { rows } = await pool.query<PortalRunListRow>(
      `SELECT r.*, a.status AS application_status,
              (SELECT count(*)::int FROM portal_fields f WHERE f.run_id = r.id AND f.intent LIKE 'open_question%' AND f.value IS NOT NULL) AS answers
         FROM portal_runs r JOIN applications a ON a.id = r.application_id
        ORDER BY r.started_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  } catch (err) {
    if (missingSchema(err)) return null;
    throw err;
  }
}
