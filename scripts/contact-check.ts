// Checks how application emails are found on company pages: what counts as an address, which ones
// are worth writing to, and whether a page belongs to the company. No database, no network.
//   npx tsx scripts/contact-check.ts

import {
  companySiteFromPosting,
  corroboratesCompany,
  companyTokens,
  contactKind,
  decodeCfEmail,
  extractEmails,
  extractJsonLdEmails,
  hostCarriesName,
  isCompanyAddress,
  isUsableEmail,
  linkTargets,
  looksLikeJsShell,
  looksQuebecois,
  metaRefreshTarget,
  nameDomainCandidates,
  pageMatchesCompany,
  rankFoundEmails,
  strongHostMatch,
} from "../lib/contact-parse";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(got: T, want: T, msg: string) {
  assert(JSON.stringify(got) === JSON.stringify(want), `${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

/** Cloudflare's obfuscation, so the test can build a real one. */
function cfEncode(email: string, key = 0x5a): string {
  return [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

// --- addresses on a page
const CAREERS_PAGE = `
<html><head><title>Careers | Genetec</title></head><body>
  <a href="mailto:careers@genetec.com?subject=Application">Write to careers</a>
  <p>Students: <a class="__cf_email__" data-cfemail="${cfEncode("stages@genetec.com")}">[email&#160;protected]</a></p>
  <p>Or reach us at recrutement&#64;genetec.com or hello@genetec.com.</p>
  <img src="/logo@2x.png"> <a href="mailto:privacy@genetec.com">Privacy</a> noreply@genetec.com
  <script>var sentry = "abc@sentry.io"; var x = "ignored@wixpress.com"</script>
</body></html>`;

const found = extractEmails(CAREERS_PAGE).sort();
eq(found, ["careers@genetec.com", "hello@genetec.com", "recrutement@genetec.com", "stages@genetec.com"], "extractEmails");
eq(decodeCfEmail(cfEncode("a.b@c.ca")), "a.b@c.ca", "decodeCfEmail round-trips");
assert(decodeCfEmail("zz") === null && decodeCfEmail("5a") === null, "decodeCfEmail rejects junk");
console.log("  ok  addresses: mailto, obfuscated, entity-encoded and plain text; images and noise rejected");

// --- what is usable
for (const bad of ["no-reply@x.com", "privacy@x.com", "logo@2x.png", "someone@example.com", "press@x.com", "a@sentry.io"]) {
  assert(!isUsableEmail(bad), `should reject ${bad}`);
}
for (const good of ["careers@x.com", "info@x.ca", "jane.doe@x.com", "rh@x.qc.ca"]) assert(isUsableEmail(good), `should accept ${good}`);
console.log("  ok  noise addresses rejected, real ones kept");

// --- what kind of inbox
eq(
  ["careers@a.com", "carrieres@a.com", "talent.acquisition@a.com", "rh@a.com", "stages@a.com", "jobs@a.com", "hr@a.com", "students@a.com"].map(contactKind),
  Array(8).fill("recruiting"),
  "recruiting inboxes",
);
eq(["info@a.com", "contact@a.com", "bonjour@a.com"].map(contactKind), Array(3).fill("generic"), "general inboxes");
eq(["jane.doe@a.com", "mtremblay@a.com"].map(contactKind), ["other", "other"], "personal addresses");
assert(contactKind("chr@a.com") === "other", "chr is not hr");
console.log("  ok  careers / recruiting inboxes told apart from general and personal ones");

// --- company ownership and ranking
assert(isCompanyAddress("careers@genetec.com", "Genetec", "genetec.com"), "on the site's domain");
assert(isCompanyAddress("jobs@careers.genetec.com", "Genetec", "genetec.com"), "on a subdomain");
assert(isCompanyAddress("jobs@hydroquebec.com", "Hydro Québec", null), "domain carries the name, no site known");
assert(!isCompanyAddress("partner@othercorp.com", "Genetec", "genetec.com"), "another company's address is not the company's");

// General inboxes are a weak fallback: only the company's exact domain, on a contact or careers page, not a directory.
const general = (url: string, emails: string[], host = "ibm.com") => rankFoundEmails([{ url, emails }], "IBM", host).map((r) => r.email);
eq(general("https://www.ibm.com/contact/global", ["info@hr.ibm.com", "info@ro.ibm.com", "info@si.ibm.com"]), [], "IBM Croatia, Romania and Slovenia are not IBM Canada");
eq(general("https://www.ibm.com/en/personal-insurance", ["info@ibm.com"]), [], "a product page is not where a contact address is trusted");
eq(general("https://www.ibm.com/en/contact-us", ["info@ibm.com"]), ["info@ibm.com"], "a contact page on the exact domain is");
eq(rankFoundEmails([{ url: "https://www.intact.ca/en/personal-insurance", emails: ["info@intact.net"] }], "Intact", "intact.ca").map((r) => r.email), [], "intact.net is not the site it was found on");
eq(rankFoundEmails([{ url: "https://jobs.bombardier.com/x", emails: ["hr_services@aero.bombardier.com"] }], "Bombardier", "bombardier.com").map((r) => r.email), ["hr_services@aero.bombardier.com"], "a recruiting inbox may sit on a subdomain");
console.log("  ok  a general inbox is offered only when it is plainly the company's own");

const ranked = rankFoundEmails(
  [
    { url: "https://genetec.com/about", emails: ["info@genetec.com", "jane.doe@genetec.com", "partner@othercorp.com", "support@genetec.com"] },
    { url: "https://genetec.com/careers", emails: ["careers@genetec.com", "info@genetec.com"] },
  ],
  "Genetec",
  "genetec.com",
);
eq(ranked.map((r) => r.email), ["careers@genetec.com", "info@genetec.com"], "ranking: recruiting, then general; people, support and other companies dropped");
eq(ranked[0].sourceUrl, "https://genetec.com/careers", "each address keeps the page it came from");
eq(ranked[1].sourceUrl, "https://genetec.com/careers", "the better source page wins for an address found twice");
console.log("  ok  ranking: careers inbox first, then a general one; people, support and other companies dropped");

// JSON blobs in a page carry escaped quotes and tags; the address inside must come out clean.
eq(extractEmails('{"html":"<a href=\\u0022mailto:cpe@bdo.com\\u0022>cpe@bdo.com</a>. Write\\u003ejobs@bdo.ca\\u003c/a>"}').sort(), ["jobs@bdo.ca"], "escaped JSON in a page");
assert(!isUsableEmail("communications@pomerleau.ca") && !isUsableEmail("helpdesk@flexspring.com") && !isUsableEmail("support@alayacare.com"), "communications, helpdesk and support inboxes are not application inboxes");
console.log("  ok  escaped JSON is decoded first; communications, helpdesk and support inboxes are dropped");

// --- guessed websites must belong to the company
assert(hostCarriesName("https://www.hydroquebec.com/", "Hydro Québec"), "hydroquebec.com carries the name");
assert(!hostCarriesName("https://www.hydro.com/", "Hydro Québec"), "hydro.com is not Hydro Québec");
assert(!hostCarriesName("https://www.snagged.com/", "Flare"), "a page titled Flare that sits on snagged.com");
assert(looksQuebecois("<p>Our offices in Montréal and Toronto</p>", "https://www.exegy.com/"), "office in Montréal");
assert(looksQuebecois("<p>Bienvenue</p>", "https://www.giro.ca/"), ".ca domain");
assert(!looksQuebecois("<title>Giro helmets</title><p>Ride safe. Free shipping in the US and Canada.</p>", "https://www.giro.com/"), "helmet brand has no Québec connection");
assert(!looksQuebecois("<p>Offices in Toronto and Vancouver</p>", "https://example.org/"), "Canada alone is not Québec");
console.log("  ok  a guessed website has to carry the company's name and show a Québec connection");

// Whether the pages read fit a company these applications could be for.
const helmets = [{ url: "https://www.giro.com/", html: "<title>Giro</title><p>Helmets for road and mountain. Free shipping. Sizing guide.</p>" }];
const bombardier = [{ url: "https://bombardier.com/", html: "<p>Bombardier is a Canadian manufacturer of business jets.</p>" }];
const autodesk = [{ url: "https://www.autodesk.com/", html: "<p>" + "Software for engineers. Design software. Engineering technology. ".repeat(3) + "</p>" }];
const giroSoftware = [{ url: "https://www.giro.ca/", html: "<p>Solutions logicielles</p>" }];
assert(!corroboratesCompany(helmets), "a helmet brand does not fit");
assert(corroboratesCompany(bombardier), "a Canadian company fits");
assert(corroboratesCompany(autodesk), "a software company fits");
assert(corroboratesCompany(giroSoftware), "a .ca site fits");
console.log("  ok  guessed websites are checked against what is on their pages");

// Structured data, refresh pages, empty shells, and a domain that vouches for a multi-word name.
const LD = `<script type="application/ld+json">{"@type":"Organization","contactPoint":[
  {"@type":"ContactPoint","contactType":"customer service","email":"info@intelcomexpress.com"},
  {"@type":"ContactPoint","contactType":"human resources","email":"mailto:Recrutement@Acme.ca"}]}</script>`;
eq(extractJsonLdEmails(LD), ["recrutement@acme.ca"], "JSON-LD: the hiring contact point, not the customer-service one");
eq(extractEmails(LD), ["recrutement@acme.ca"], "extractEmails reads JSON-LD too");
eq(metaRefreshTarget('<html><meta http-equiv="refresh" content="0; url=/fr/accueil.html"></html>', "https://www.hydroquebec.com/"), "https://www.hydroquebec.com/fr/accueil.html", "meta refresh target");
assert(metaRefreshTarget("<p>hello</p>", "https://x.com") === null, "no refresh, no target");
assert(looksLikeJsShell("<div id=root></div>" + "<script>var a=1;</script>".repeat(1200)), "an empty JavaScript shell");
assert(!looksLikeJsShell("<p>" + "A real page with words. ".repeat(80) + "</p>"), "a real page is not a shell");
assert(strongHostMatch("https://hydroquebec.com/", "Hydro Québec"), "hydroquebec.com vouches for Hydro Québec");
assert(!strongHostMatch("https://hydro.com/", "Hydro Québec"), "hydro.com does not");
assert(!strongHostMatch("https://intact.ca/", "Intact"), "a one-word name still needs the page title");
console.log("  ok  JSON-LD contact points, refresh pages, empty JavaScript shells, domains that vouch for a name");

// --- an address is read with its surroundings
const POSTING = `<p>Apply on our site. If you require an accommodation, please reach out to us at recruitmentprograms@kinaxis.com. This contact information is for accessibility requests only.</p>
  <p>Requests for accommodation or special assistance: send an e-mail to Recruiting Operations Team: <a href="mailto:Careers@sap.com">Careers@sap.com</a></p>
  <p>Beenox accepte-t-il les candidatures spontanées? Tu peux envoyer ton curriculum vitae à cette adresse: recrutement@beenox.com</p>
  <p>Privacy questions: dpo-office@beenox.com. Report a concern to ethics-line@beenox.com</p>`;
eq(extractEmails(POSTING), ["recrutement@beenox.com"], "accessibility, accommodation, privacy and ethics addresses are not application inboxes");
console.log("  ok  addresses printed for accessibility, accommodation or privacy requests are not offered");

// --- is this page the company's?
assert(pageMatchesCompany("<title>Genetec | Unified security</title>", "Genetec"), "title match");
assert(pageMatchesCompany('<title>Home</title><meta property="og:site_name" content="Pomerleau">', "Pomerleau"), "site name match");
assert(!pageMatchesCompany("<title>Pomerleau Plumbing Supplies</title>", "Genetec"), "another company");
assert(!pageMatchesCompany("<title>Domain for sale</title><p>buy this domain</p>", "Intact"), "parked domain");
assert(pageMatchesCompany("<title>Accueil</title><body>Hydro-Québec produit de l'énergie. Hydro-Québec, Hydro-Québec</body>", "Hydro Québec"), "name repeated at the top of the page");
console.log("  ok  a page has to show the company's name before its domain is trusted");

// --- names, websites, links
eq(companyTokens("Hydro Québec"), ["hydro", "quebec"], "companyTokens keeps a region that is part of the name");
eq(companyTokens("Matrox Graphics"), ["matrox"], "companyTokens drops what the company does");
eq(companyTokens("BDO Canada"), ["bdo"], "companyTokens drops Canada");
eq(companyTokens("Intelcom | Dragonfly"), ["intelcom"], "companyTokens keeps the name before a bar");
eq(companyTokens("Pratt & Whitney"), ["pratt", "whitney"], "companyTokens keeps both words");
eq(nameDomainCandidates("BDO Canada").slice(0, 2), ["https://bdo.ca", "https://bdo.com"], "a name that says Canada tries .ca first");
eq(nameDomainCandidates("Pratt & Whitney").slice(0, 3), ["https://prattwhitney.com", "https://pratt.com", "https://pratt-whitney.com"], "domain guesses");
eq(companySiteFromPosting("https://careers.genetec.com/job/123"), "https://genetec.com", "site from a company-hosted posting");
eq(companySiteFromPosting("https://intact.wd3.myworkdayjobs.com/en-US/Intact/job/x"), null, "no site from an ATS posting");
eq(companySiteFromPosting("https://www.linkedin.com/jobs/view/1"), null, "no site from a job board");
eq(
  linkTargets(
    `<a href="/en/careers">Careers</a> <a href="/about/team">Team</a> <a href="https://other.com/careers">Elsewhere</a>
     <a href="/nous-joindre">Nous joindre</a> <a href="mailto:x@y.com">Mail</a> <a href="/files/cv.pdf">Careers PDF</a>`,
    "https://genetec.com/",
  ),
  ["https://genetec.com/en/careers", "https://genetec.com/nous-joindre"],
  "linkTargets follows same-site careers and contact links only",
);
console.log("  ok  company names, guessed domains, ATS-hosted postings and links to follow");

console.log("\ncontact-check passed");
