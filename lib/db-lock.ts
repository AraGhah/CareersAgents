import { pool } from "./db";

// A Postgres advisory lock around a piece of work, so two processes (the auto-apply batch, a run you started from an
// application page, `npm run portal`) never do the same thing at once. The lock lives on one connection held for the
// duration: if the process dies, Postgres drops the connection and the lock with it, so nothing stays stuck.

export type Locked<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs `fn` holding the lock (`scope`, `key`). With `wait: false` it returns { ok: false } at once when someone else holds
 * it; with `wait: true` it waits its turn.
 */
export async function withLock<T>(scope: string, key: string, fn: () => Promise<T>, opts: { wait: boolean }): Promise<Locked<T>> {
  const client = await pool.connect();
  try {
    if (opts.wait) {
      await client.query(`SELECT pg_advisory_lock(hashtext($1), hashtext($2))`, [scope, key]);
    } else {
      const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS ok`, [scope, key]);
      if (!rows[0]?.ok) return { ok: false };
    }
    try {
      return { ok: true, value: await fn() };
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [scope, key]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
