// Split out of instrumentation.ts so the Node-only `process.on` call is never
// even present in the module Next statically scans for Edge Runtime
// compatibility — only reachable via the dynamic import() in register(),
// and only actually imported when NEXT_RUNTIME is "nodejs".
//
// Only the one known Next dev-overlay failure is survived (see instrumentation.ts): its
// "object null is not iterable" TypeError, thrown from Next's own code. Any other uncaught
// exception is a real bug and ends the process as Node would, rather than leaving the
// server running in a state nobody can reason about.
function isKnownNextReplayBug(err: unknown): boolean {
  if (!(err instanceof TypeError) || !/object null is not iterable/.test(err.message)) return false;
  // Next's own code, as installed or as compiled into .next/.
  return /[\\/]node_modules[\\/]next[\\/]|[\\/]\.next[\\/]/.test(err.stack ?? "");
}

process.on("uncaughtException", (err) => {
  if (isKnownNextReplayBug(err)) {
    console.error("[uncaughtException] survived Next's dev error-replay bug (see instrumentation.ts):", err.message);
    return;
  }
  console.error("[uncaughtException]", err);
  process.exit(1);
});

export {};
