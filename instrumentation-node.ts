// Split out of instrumentation.ts so the Node-only `process.on` call is never
// even present in the module Next statically scans for Edge Runtime
// compatibility — only reachable via the dynamic import() in register(),
// and only actually imported when NEXT_RUNTIME is "nodejs".
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] survived (see lib/db.ts / instrumentation.ts):", err.message);
});

export {};
