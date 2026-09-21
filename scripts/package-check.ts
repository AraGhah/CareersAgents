// Sanity check for the package builder.
//   npx tsx scripts/package-check.ts
// Builds one letter with a deliberately wrong company name and expects the checklist to catch it.

import { buildApplicationPackage } from "../lib/package";
import { getApplication, listApplications, startApplication, listJobs } from "../lib/queries";
import { pool } from "../lib/db";
import { flagUnknownNouns, fillLetter, type LetterInput } from "../lib/letter";

async function main() {
  let apps = await listApplications();
  if (apps.length === 0) {
    const jobs = await listJobs({ includeClosed: true, includeLow: true, includeSkipped: true });
    if (jobs.length === 0) throw new Error("no jobs in the database; run discovery first");
    await startApplication(jobs[0].id);
    apps = await listApplications();
  }

  const app = await getApplication(apps[0].id);
  if (!app) throw new Error("application vanished");

  const result = await buildApplicationPackage({
    app,
    companyFact: `${app.company_name} publishes this internship on its careers board.`,
    companyFactSource: app.company_website ?? app.url,
  });

  console.log(`built ${result.pdfPath}`);
  console.log(`categories: ${result.categories.join(", ")}`);
  console.log(`projects: ${result.projects.map((p) => p.name).join(", ")}`);
  console.log(`noun flags: ${result.flags.length}`);
  for (const item of result.checklist) {
    console.log(`  [${item.ok ? "ok" : "FAIL"}] ${item.id}: ${item.label}`);
  }

  // Corrupt the company name after the fact and make sure the checker notices.
  const corrupt: LetterInput = {
    fullName: "Ara Ghahramanyan",
    companyName: "NotTheRealCompany",
    roleTitle: app.title,
    companyFact: "Invented fact about a different employer.",
    companyFactSource: "https://example.com/not-real",
    projects: result.projects,
    availability: "January 2027",
    locationRule: "Montréal or Laval on-site or hybrid; fully remote elsewhere in Canada",
    links: ["https://aragahramanyan.dev"],
    lang: result.lang,
  };
  // Letter still names the real company from the earlier build text; forge one that swaps names.
  const forged = fillLetter({
    ...corrupt,
    companyName: app.company_name,
  }).split(app.company_name).join("NotTheRealCompany");

  const companyOk = forged.toLowerCase().includes(app.company_name.toLowerCase());
  const flags = flagUnknownNouns(forged, {
    ...corrupt,
    companyName: app.company_name,
  });

  if (companyOk) {
    throw new Error("corrupted company name was not caught");
  }
  console.log(
    `corruption check: company name missing as expected; ${flags.length} extra noun flag(s).`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
