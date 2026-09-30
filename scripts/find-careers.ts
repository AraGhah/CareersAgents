// A posting found on LinkedIn or Indeed is a copy: their own apply flow needs your account, which the desk never
// uses. This looks each such role up on the company's own careers site (its job board, or the links on its
// careers pages) and, when it finds the role, applies through that form like any other portal application.
//   npx tsx scripts/find-careers.ts                 dry run: prints what it finds, changes nothing
//   npx tsx scripts/find-careers.ts --apply         stores the company's posting on the job and re-routes it
//   npx tsx scripts/find-careers.ts --only autodesk one company
//   npx tsx scripts/find-careers.ts --fresh         ignore what was remembered about each company
//
// Only public pages and public job-board APIs are read. Most large employers (Workday, iCIMS, SuccessFactors...)
// take applications through an account portal: those are reported with the company's own link, and stay yours.

import { rm } from "node:fs/promises";
import path from "node:path";
import { pool } from "../lib/db";
import { resolveApplyTarget } from "../lib/apply/apply-url";
import { decideChannel, saveChannel } from "../lib/apply/route";
import { getApplication } from "../lib/queries";

const APPLY = process.argv.includes("--apply");
const FRESH = process.argv.includes("--fresh");
const ONLY = process.argv.find((a, i) => process.argv[i - 1] === "--only")?.toLowerCase();

async function main() {
  console.log(APPLY ? "APPLY: storing what is found and re-routing\n" : "DRY RUN: nothing is stored (add --apply)\n");
  const { rows } = await pool.query<{ id: string }>(
    `SELECT a.id
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE a.status IN ('discovered', 'qualified', 'ready')
        AND a.channel IS DISTINCT FROM 'email'
        AND j.url ~* '(linkedin|indeed)\\.'
        AND (j.apply_url IS NULL OR j.apply_url ~* '(linkedin|indeed)\\.')
      ORDER BY c.name, j.title`,
  );

  const tally = { checked: 0, drive: 0, account: 0, accountKnown: 0, careersOnly: 0, nothing: 0, viaOtherSource: 0 };
  let lastCompany = "";
  let lastFresh = "";
  for (const { id } of rows) {
    const app = await getApplication(id);
    if (!app || (ONLY && !app.company_name.toLowerCase().includes(ONLY))) continue;
    tally.checked += 1;
    if (app.company_name !== lastCompany) {
      console.log(`\n${app.company_name}${app.company_website ? `  (${app.company_website})` : ""}`);
      lastCompany = app.company_name;
    }

    // A company link on the job and the same role on another source come first (resolveApplyTarget);
    // the lookup on the company's own site is what this adds. `--fresh` reads that site again.
    if (FRESH && app.company_id !== lastFresh) {
      await rm(path.join("cache", "careers", `${app.company_id}.json`), { force: true });
      lastFresh = app.company_id;
    }
    // With --apply the posting found is kept on the job, so the runner and the page get the same answer.
    const target = await resolveApplyTarget(app, { save: APPLY });
    const decision = await decideChannel(app, { applyUrl: target.url, hint: target.hint });
    const label = `  ${app.title.slice(0, 68).padEnd(68)}`;

    if (target.via === "company-link" || target.via === "same-role-elsewhere") {
      // The posting already carried a company link. Whether the desk can drive it is the same question as below.
      if (decision.channel === "portal") tally.viaOtherSource += 1;
      else tally.accountKnown += 1;
      console.log(`${label} form already known${decision.channel === "portal" ? "" : " (account portal, yours)"}: ${target.url}`);
    } else if (target.via === "company-careers") {
      if (decision.channel === "portal") tally.drive += 1;
      else tally.account += 1;
      console.log(`${label} ${decision.channel === "portal" ? "FOUND" : "FOUND (account portal)"}: ${target.url}`);
      console.log(`      ${target.note}`);
    } else if (target.hint && /careers page: /.test(target.hint)) {
      tally.careersOnly += 1;
      console.log(`${label} not listed; ${target.hint}`);
    } else {
      tally.nothing += 1;
      console.log(`${label} not found. ${target.hint ?? target.note}`);
    }

    if (APPLY) await saveChannel(app.id, decision.channel);
  }

  const drivable = tally.drive + tally.viaOtherSource;
  const accounts = tally.account + tally.accountKnown;
  console.log(
    `\n${tally.checked} application(s) checked:\n` +
      `  ${String(drivable).padStart(3)}  on a company form the desk can drive (${tally.drive} newly found, ${tally.viaOtherSource} already known)\n` +
      `  ${String(accounts).padStart(3)}  on a company account portal (Workday...): the posting's link is kept, you apply yourself\n` +
      `  ${String(tally.careersOnly).padStart(3)}  role not listed on the company's site: its careers page is shown\n` +
      `  ${String(tally.nothing).padStart(3)}  nothing found (the company's site is unknown or unreachable, or its careers page could not be located)`,
  );
  if (APPLY && drivable) console.log("Next: npm run portal -- --queue plan   (reads each form and drafts the answers)");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
