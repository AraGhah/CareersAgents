import { config } from "dotenv";
import { Pool } from "pg";

// Next loads .env.local on its own, the tsx scripts do not.
config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Copy .env.example to .env.local.");
}

// Dev hot reload re-evaluates modules, so keep the pool on globalThis or we leak connections.
const cache = globalThis as typeof globalThis & { __pool?: Pool };

const rawPool = cache.__pool ?? new Pool({ connectionString });

// pg emits 'error' on idle clients that die in the background (e.g. Postgres
// restarts, the DB is down). Without a listener that is an unhandled
// EventEmitter error and Node crashes the whole process — every route with
// it, not just the query that failed. A no-op listener lets that failure
// surface where it actually happened: the pool.query() call's rejection,
// which the calling page already awaits and app/error.tsx already renders.
rawPool.on("error", (err) => {
  console.error("[pg pool] background client error:", err.message);
});

if (process.env.NODE_ENV !== "production") {
  cache.__pool = rawPool;
}

/**
 * A refused connection on a dual-stack host (localhost resolving to both
 * ::1 and 127.0.0.1) makes Node reject with an `AggregateError` bundling
 * both attempts. Next's dev-mode (Turbopack) error serializer cannot format
 * that shape — it throws its own `TypeError: object null is not iterable`
 * while trying, which becomes an uncaughtException that kills the whole
 * dev server, wiping out every route, not just the one that queried.
 *
 * Flattening it into a plain Error here, before it leaves the pool, keeps
 * the underlying detail (via `cause` and a joined message) while giving
 * Next — and app/error.tsx — an error shape it can actually render.
 */
function flattenAggregateError(err: unknown): unknown {
  if (!(err instanceof AggregateError)) return err;
  const detail = err.errors
    .map((e) => (e instanceof Error ? e.message : String(e)))
    .join("; ");
  const flat = new Error(`${err.message || "Database connection failed"}: ${detail}`);
  flat.cause = err;
  return flat;
}

// Wrap `query` only, via a Proxy, so `pool` stays the same Pool instance for
// every other call (`.end()`, `.on()`, `.totalCount`, …) used across the
// scripts — only the promise rejection shape changes.
export const pool: Pool = new Proxy(rawPool, {
  get(target, prop, receiver) {
    if (prop === "query") {
      return (...args: unknown[]) => {
        // @ts-expect-error -- forwarding pg's overloaded query(...) args opaquely
        const result = target.query(...args);
        // pg's query() returns a Promise unless a callback is passed; the
        // codebase never does, but guard anyway rather than assume.
        return result instanceof Promise
          ? result.catch((err: unknown) => Promise.reject(flattenAggregateError(err)))
          : result;
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});
