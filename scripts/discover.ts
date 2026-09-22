// Pull published job boards + score against active CV.
//   npx tsx scripts/discover.ts
//   npx tsx scripts/discover.ts --fresh
//   npx tsx scripts/discover.ts --loop

import cron from "node-cron";
import { pool } from "../lib/db";
import { runFindInternships } from "../lib/workflow";

const LOOP = process.argv.includes("--loop");
const FRESH = process.argv.includes("--fresh");

async function run() {
  const summary = await runFindInternships({ fresh: FRESH });
  console.log(
    `Done. boards=${summary.boards} new=${summary.inserted} refreshed=${summary.updated} ` +
      `filtered=${summary.skipped} scored=${summary.scored} qualified=${summary.qualified}`,
  );
  for (const err of summary.errors) console.log(`  note: ${err}`);
}

async function main() {
  await run();
  if (!LOOP) {
    await pool.end();
    return;
  }
  console.log("Looping every four hours. Ctrl+C to stop.");
  cron.schedule("0 */4 * * *", () => {
    run().catch((err) => console.error(err));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
