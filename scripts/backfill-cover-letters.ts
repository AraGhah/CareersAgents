// Build a personalized cover letter for every application that doesn't have
// one yet — e.g. applications prepared before automatic cover letter
// generation existed. Safe to re-run: buildPackageFromDossier skips any
// application that already has a cover letter.
//   npx tsx scripts/backfill-cover-letters.ts

import { pool } from "../lib/db";
import { detectLetterLang } from "../lib/letter";
import { buildPackageFromDossier } from "../lib/package";
import { listApplications } from "../lib/queries";
import { getLatestDossier } from "../lib/research";

async function main() {
  const apps = await listApplications();
  const targets = apps.filter(
    (a) => !a.cover_letter_path && !["rejected", "withdrawn"].includes(a.status),
  );

  console.log(`${targets.length} application(s) need a cover letter.`);

  let built = 0;
  let failed = 0;
  for (const app of targets) {
    try {
      const dossier = await getLatestDossier(app.company_id, app.id);
      const lang = detectLetterLang(app.title, app.description);
      const result = await buildPackageFromDossier({ app, dossier, lang, checkLinks: false });
      if (result) {
        built += 1;
        console.log(`  ok   ${app.company_name} — ${app.title}`);
      }
    } catch (err) {
      failed += 1;
      console.log(
        `  FAIL ${app.company_name} — ${app.title}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n${built} built, ${failed} failed.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
