// Looks for an application email (and the website, when a company has none recorded) for every company
// you have an unsent application with, by reading the company's own public pages.
//   npx tsx scripts/find-contacts.ts                 dry run: prints what it finds, stores nothing
//   npx tsx scripts/find-contacts.ts --apply         stores the websites and addresses (with their source page)
//   npx tsx scripts/find-contacts.ts --apply --research   also refreshes each company's research notes
//   npx tsx scripts/find-contacts.ts --only genetec  one company
//
// An address is only ever one a page publishes; none is built from a pattern.

import { pool } from "../lib/db";
import { discoverCompanyContacts, saveDiscovery } from "../lib/contact-discovery";
import { listApplications } from "../lib/queries";
import { researchCompanyForApplication } from "../lib/research";

const APPLY = process.argv.includes("--apply");
const RESEARCH = process.argv.includes("--research");
const ONLY = process.argv.find((a, i) => process.argv[i - 1] === "--only")?.toLowerCase();
const SENT = new Set(["applied", "followup", "interview", "accepted", "rejected", "withdrawn"]);

async function main() {
  console.log(APPLY ? "APPLY: storing what is found\n" : "DRY RUN: nothing is stored (add --apply)\n");
  const apps = (await listApplications()).filter((a) => !SENT.has(a.status));
  const byCompany = new Map<string, typeof apps>();
  for (const app of apps) byCompany.set(app.company_id, [...(byCompany.get(app.company_id) ?? []), app]);

  const totals = { companies: 0, withAddress: 0, withRecruiting: 0, newWebsites: 0, noSite: 0 };
  for (const [companyId, list] of byCompany) {
    const app = list[0];
    if (ONLY && !app.company_name.toLowerCase().includes(ONLY)) continue;
    totals.companies += 1;

    const started = Date.now();
    const found = await discoverCompanyContacts({
      companyName: app.company_name,
      website: app.company_website,
      postingUrl: app.url,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(0);

    const site = found.website ? `${found.website} (${found.websiteSource})` : "no website found";
    console.log(`${app.company_name.padEnd(22)} ${site} | ${found.pagesScanned.length} pages, ${seconds}s`);
    if (!found.website) totals.noSite += 1;
    if (found.website && !app.company_website) totals.newWebsites += 1;
    if (found.found.length) totals.withAddress += 1;
    if (found.found.some((f) => f.kind === "recruiting")) totals.withRecruiting += 1;
    for (const f of found.found) console.log(`    ${f.kind.padEnd(10)} ${f.email}   <- ${f.sourceUrl}`);
    if (found.note) console.log(`    set aside: ${found.note}`);
    if (!found.found.length) console.log("    (no public address: this company probably takes applications through a form)");

    if (APPLY) {
      await saveDiscovery(companyId, app.company_website, found);
      if (RESEARCH) {
        for (const a of list) {
          await researchCompanyForApplication({
            app: { ...a, company_website: a.company_website ?? found.website },
            companyId,
            force: true,
          });
        }
      }
    }
  }

  console.log(
    `\n${totals.companies} companies: ${totals.withAddress} with a public address (${totals.withRecruiting} with a careers or recruiting inbox), ` +
      `${totals.newWebsites} websites newly found, ${totals.noSite} with no website found.`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
