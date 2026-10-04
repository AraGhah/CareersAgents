// Where remembered answers live (screening_answers, schema-v16.sql). The rules for what is remembered and how a
// remembered answer fits a new form are in lib/apply/memory.ts, which has no database so the planner stays offline.

import { pool } from "../db";
import { memoryKey, rememberable, type RememberedAnswer } from "./memory";
import { cleanLabel } from "./text";
import type { FieldIntent, FieldKind, Lang } from "./types";

function missingTable(err: unknown): boolean {
  return (err as { code?: string }).code === "42P01";
}

/** Every remembered answer, by key. Empty before schema-v16.sql. */
export async function loadAnswerMemory(): Promise<Map<string, RememberedAnswer>> {
  try {
    const { rows } = await pool.query<{ key: string; question: string; intent: string; kind: string; value: string; updated_at: Date }>(
      `SELECT key, question, intent, kind, value, updated_at FROM screening_answers`,
    );
    return new Map(rows.map((r) => [r.key, { key: r.key, question: r.question, intent: r.intent, kind: r.kind, value: r.value, updatedAt: r.updated_at }]));
  } catch (err) {
    if (missingTable(err)) return new Map();
    throw err;
  }
}

/** Remembers what you approved for a question. A newer answer to the same question replaces the older one. */
export async function rememberAnswer(opts: {
  question: string;
  intent: FieldIntent;
  kind: FieldKind;
  value: string;
  lang: Lang;
  companyName: string;
  applicationId: string | null;
}): Promise<void> {
  if (!rememberable(opts.intent, opts.kind) || !opts.value.trim()) return;
  const key = memoryKey(opts.question, opts.companyName);
  if (!key) return;
  try {
    await pool.query(
      `INSERT INTO screening_answers (key, question, intent, kind, value, lang, application_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET question = EXCLUDED.question, intent = EXCLUDED.intent, kind = EXCLUDED.kind,
         value = EXCLUDED.value, lang = EXCLUDED.lang, application_id = EXCLUDED.application_id, updated_at = now()`,
      [key, cleanLabel(opts.question).slice(0, 500), opts.intent, opts.kind, opts.value.trim(), opts.lang, opts.applicationId],
    );
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
}

/** Counts how often each remembered answer was reused (shown on the Answers page). */
export async function noteMemoryUse(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await pool.query(`UPDATE screening_answers SET uses = uses + 1 WHERE key = ANY($1::text[])`, [keys]);
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
}

export type MemoryRow = { key: string; question: string; value: string; intent: string; uses: number; updated_at: Date };

export async function listAnswerMemory(): Promise<MemoryRow[]> {
  try {
    const { rows } = await pool.query<MemoryRow>(
      `SELECT key, question, value, intent, uses, updated_at FROM screening_answers ORDER BY updated_at DESC`,
    );
    return rows;
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

export async function updateRememberedAnswer(key: string, value: string): Promise<void> {
  await pool.query(`UPDATE screening_answers SET value = $2, updated_at = now() WHERE key = $1`, [key, value.trim()]);
}

export async function forgetAnswer(key: string): Promise<void> {
  await pool.query(`DELETE FROM screening_answers WHERE key = $1`, [key]);
}
