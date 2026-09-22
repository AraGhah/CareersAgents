/**
 * Next.js 16 / Turbopack dev-mode bug workaround.
 *
 * When a Server Component's data fetch rejects — even one already caught by
 * the app's own try/catch — Next's dev-mode error/owner-stack instrumentation
 * replays it to build its overlay, and that replay path throws its own
 * `TypeError: object null is not iterable` while formatting certain error
 * shapes (reliably reproduced here by a refused Postgres connection). With no
 * `uncaughtException` listener, that is fatal: Node kills the whole process,
 * taking every route down with the one request that failed, whether or not
 * the app itself handled the original error.
 *
 * Registering a listener does not change how any real error in this app is
 * handled — `lib/db.ts` and each page's own try/catch (or app/error.tsx) do
 * that. This only stops Next's internal replay bug from being fatal to the
 * process. Safe to remove once upstream fixes it.
 *
 * The actual `process.on(...)` call lives in instrumentation-node.ts, loaded
 * only behind this dynamic import: Next also loads this file to check it
 * against the Edge Runtime, and `process.on` isn't valid there. Keeping it
 * out of this module's static scope is what stops that check from warning.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
