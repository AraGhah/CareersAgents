// Offline: no database, no network. The careers-page-first rules: how a careers board is recognised from a link, how the
// same posting found twice gets one id, where a posting has to be, what a careers page lists by itself (JSON-LD and job
// links), which channel the submit permission allows, and that only the company's own form counts as a careers form.
//   npm run registry:check

import { boardFromLink, canonicalPage, cleanLink, postingKey, registryKey } from "../lib/registry/board-ref";
import { jsonLdJobs, pageJobs } from "../lib/registry/jsonld";
import { fitsWhere } from "../lib/registry/where";
import { isCoopStoreJob } from "../lib/job-store";
import { freehireSearches } from "../lib/registry/freehire";
import { submitEnabled, submitMode } from "../lib/apply/submit";
import { runPreflight } from "../lib/apply/preflight";
import { schoolLevel } from "../lib/match/college";
import { lowOnlyForLevel } from "../lib/match/fit-review";
import { todayAt } from "../lib/registry/daily";
import { tokenBudget, tokensExhausted } from "../lib/claude";
import { workdayApplyUrl } from "../lib/apply/platforms";

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}
const key = (url: string) => {
  const b = boardFromLink(url);
  return b ? registryKey(b) : null;
};

console.log("careers boards from links");
check(key("https://job-boards.greenhouse.io/tobogganlabs/jobs/8012583003?utm_source=freehire.me") === "greenhouse:tobogganlabs", "Greenhouse job-boards link");
check(key("https://boards.greenhouse.io/embed/job_board?for=coveoen") === "greenhouse:coveoen", "Greenhouse embed link names the board in ?for=");
check(key("https://jobs.lever.co/eqbank/d2a1c83a-dc7a-4b4f-a159-98b21e6e0616") === "lever:eqbank", "Lever posting");
check(key("https://jobs.ashbyhq.com/exegy/1dfd3209-2714-4ccd-8fb9-779765151897") === "ashby:exegy", "Ashby posting");
check(key("https://apply.workable.com/mila-2/j/1E81635604") === "workable:mila-2", "Workable posting with its account");
check(key("https://apply.workable.com/j/1E81635604") === null, "Workable short link names no account");
check(
  key("https://cadence.wd1.myworkdayjobs.com/External_Careers/job/MOUNT-ROYAL-Montreal/Analog-Intern_R53993-2") === "workday:cadence.wd1.myworkdayjobs.com/External_Careers",
  "Workday site from a posting",
);
check(key("https://jobs.bombardier.com/job/Dorval-Intern%2C-Full-Stack-Developer/1443949933/") === "successfactors:jobs.bombardier.com", "SuccessFactors career site");
check(key("https://careers-kinaxis.icims.com/jobs/35323/co-op--intern/job") === "icims:careers-kinaxis.icims.com", "iCIMS");
check(key("https://en-ca.whatjobs.com/pub_api__cpl__149779480__7103") === null, "an aggregator link is no careers board");
check(key("https://www.linkedin.com/jobs/view/123") === null, "LinkedIn is no careers board");
check(
  registryKey({ platform: "careers-page", config: { url: "https://www.Example.com/careers/?lang=fr#jobs" } }) === "careers-page:https://www.example.com/careers",
  "a careers page is keyed without its query and fragment",
);
check(canonicalPage("ftp://example.com") === null, "only web pages are careers pages");

console.log("\none id per posting, whatever found it");
check(
  postingKey("https://cadence.wd1.myworkdayjobs.com/en-US/External_Careers/job/X_R1?utm_source=freehire.me") ===
    postingKey("https://cadence.wd1.myworkdayjobs.com/External_Careers/job/X_R1"),
  "freehire's link (locale, utm) and the crawl's link are the same posting",
);
check(postingKey("https://stripe.com/jobs/search?gh_jid=8194287") !== postingKey("https://stripe.com/jobs/search?gh_jid=8194283"), "a job id in the query keeps two postings apart");
check(!cleanLink("https://jobs.lever.co/x/1?utm_source=freehire.me&lever-origin=applied").includes("utm_"), "tracking parameters are removed from stored links");

console.log("\nwhere a posting has to be");
for (const place of ["Montréal, QC", "MOUNT-ROYAL (Montreal)", "Dorval", "Longueuil, Quebec", "Saint-Laurent", "Brossard, QC", "Remote, Canada", "Canada"]) {
  check(fitsWhere(place), `${place}: yes`);
}
for (const place of ["Toronto, ON", "Ottawa, Canada", "Mississauga", "New York", "Vancouver, Canada (Remote)", "Innisfail, AB, Canada", "Red Deer, AB", "Halifax, Nova Scotia"]) {
  check(!fitsWhere(place), `${place}: no`);
}
check(fitsWhere("Montréal, on-site"), "\", on-site\" is not Ontario");
check(fitsWhere("Montréal, QC / Toronto, ON"), "a posting open in Montréal too is kept");

console.log("\nco-operative stores are not co-op work terms");
check(isCoopStoreJob("Deli Clerk (Full-time) - Timberlands - Central Alberta Co-op"), "a co-op grocery clerk is left out");
check(!isCoopStoreJob("Software Developer Co-op (Winter 2027)"), "a software co-op stays");
check(!isCoopStoreJob("Co-op Student, Data Engineering - Food Science"), "a co-op student post stays even with a store word");
check(fitsWhere("Austin, TX", "remote"), "a remote posting is kept whatever its place (as discovery's SQL does)");
check(fitsWhere(null), "no place named is kept");

console.log("\nwhat a careers page lists by itself");
const page = `
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
    {"@type":"JobPosting","title":"Stagiaire en développement logiciel - Hiver 2027","url":"/careers/123","datePosted":"2026-09-30",
     "employmentType":"INTERN","description":"<p>Python, React</p>",
     "jobLocation":{"@type":"Place","address":{"addressLocality":"Montréal","addressRegion":"QC","addressCountry":"CA"}}},
    {"@type":"JobPosting","title":"Senior Backend Engineer","url":"/careers/124"}]}</script>
  <script type="application/ld+json">{ not json }</script>
  <a href="/careers/200">Software Developer Intern (Summer 2027)</a>
  <a href="/careers/201">Senior Developer</a>
  <a href="/about">About us</a>`;
const ld = jsonLdJobs(page, "https://acme.example/careers");
check(ld.length === 2, "both JobPostings of the @graph are read, the broken block is skipped");
check(ld[0].url === "https://acme.example/careers/123" && ld[0].location === "Montréal, QC, CA", "link resolved against the page, place from the address");
check(ld[0].intern && ld[0].description === "Python, React", "employmentType INTERN and the text without its HTML");
const listed = pageJobs(page, "https://acme.example/careers").map((j) => j.title);
check(listed.includes("Stagiaire en développement logiciel - Hiver 2027") && listed.includes("Software Developer Intern (Summer 2027)"), "internships from JSON-LD and from job links");
check(!listed.some((t) => /Senior/.test(t)), "full-time roles are left out");

console.log("\nfreehire searches");
const searches = freehireSearches(3).map((p) => p.toString());
check(searches.every((s) => s.includes("countries=CA") && s.includes("open_within_days=3")), "every search is Canada, recent only");
check(searches.some((s) => s.includes("employment_type=internship")), "one search by freehire's own internship classification");

console.log("\nwho presses Submit");
const env = { ...process.env };
const set = (vars: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};
set({ PORTAL_SUBMIT: undefined, PORTAL_ALLOW_SUBMIT: undefined });
check(submitMode() === "approve" && !submitEnabled() && submitEnabled(true), "default: approve; only your approval allows a submit");
set({ PORTAL_SUBMIT: undefined, PORTAL_ALLOW_SUBMIT: "true" });
check(submitMode() === "auto" && submitEnabled(), "PORTAL_ALLOW_SUBMIT=true alone still means auto");
set({ PORTAL_SUBMIT: "approve", PORTAL_ALLOW_SUBMIT: "true" });
check(submitMode() === "approve" && !submitEnabled(), "PORTAL_SUBMIT=approve wins over PORTAL_ALLOW_SUBMIT=true");
set({ PORTAL_SUBMIT: "off" });
check(!submitEnabled(true), "PORTAL_SUBMIT=off: not even an approval submits");
set({ PORTAL_SUBMIT: env.PORTAL_SUBMIT, PORTAL_ALLOW_SUBMIT: env.PORTAL_ALLOW_SUBMIT });

const base = {
  decisions: [],
  fills: new Map(),
  requiredEmpty: [],
  resume: { resume: null, fileExists: false, reason: "test" },
  resumeFieldPresent: false,
  coverLetter: null,
  coverLetterUsed: false,
  captcha: { present: false, challenge: false, kind: null },
  formErrors: [],
  duplicate: null,
  autoApprove: true,
  submitRequested: true,
  stoppedEarly: null,
} as unknown as Parameters<typeof runPreflight>[0];
const gate = (p: Partial<Parameters<typeof runPreflight>[0]>, id: string) => runPreflight({ ...base, ...p }).find((i) => i.id === id);
check(gate({ isTarget: true, submitEnabled: true, approvedByYou: true }, "not_target")?.ok === true, "a priority company you approved may be submitted");
check(gate({ isTarget: true, submitEnabled: true, approvedByYou: false }, "not_target")?.ok === false, "a priority company is never submitted without you");
check(gate({ isTarget: false, submitEnabled: false }, "submit_enabled")?.ok === false, "without permission the submit gate fails");

console.log("\ncollege (DEC) postings first, every posting applied to");
check(schoolLevel("Stagiaire en informatique", "Ouvert aux étudiants du cégep en Techniques de l'informatique") === "college", "a cégep posting is college");
check(schoolLevel("Software Developer Intern", "Open to college or university students") === "college", "college or university students: college");
check(schoolLevel("Stage", "Être inscrit au DEC en informatique") === "college", "DEC in capitals is college");
check(schoolLevel("Intern, Dec 2026 start", "A decision-making role") === "open", "\"Dec 2026\" and \"decision\" are not a DEC");
check(schoolLevel("Stage universitaire | Génie logiciel", "Inscrit au baccalauréat") === "university", "baccalauréat is university");
check(schoolLevel("Developer Intern", "Python, React") === "open", "no level named: open");
const review = (dims: Array<[string, number]>) => ({ grade: 1, verdict: "", redFlags: [], model: null, dimensions: dims.map(([name, score]) => ({ name, score, note: "" })) });
check(lowOnlyForLevel(review([["skills", 4], ["level", 1], ["place", 5], ["timing", 5], ["language", 5]])), "low only for the schooling asked: applied to anyway");
check(!lowOnlyForLevel(review([["skills", 2], ["level", 1], ["place", 5]])), "a skills mismatch still skips it");
check(!lowOnlyForLevel(review([["skills", 5], ["level", 5], ["place", 1]])), "a place outside your rule still skips it");

console.log("\nthe daily window and the tokens");
const nine = new Date(2026, 9, 6, 9, 0, 0);
check(todayAt("15:00", nine)?.getHours() === 15, "--until 15:00 at 9:00 is today 15:00");
check(todayAt("15:00", new Date(2026, 9, 6, 15, 30)) === null, "after 15:00 there is nothing left of the window");
check(todayAt("3pm", nine) === null, "only a time like 15:00 is read");
process.env.DAILY_TOKEN_BUDGET = "1";
check(tokenBudget() === 1 && tokensExhausted() === null, "a budget with nothing used yet leaves tokens");
delete process.env.DAILY_TOKEN_BUDGET;
check(tokenBudget() === null, "no DAILY_TOKEN_BUDGET: only the account's own credit limits it");

console.log("\nWorkday: straight to the application");
check(
  workdayApplyUrl("https://giro.wd10.myworkdayjobs.com/GIRO/job/Montral-Rosemont/Stage_R-100000320") ===
    "https://giro.wd10.myworkdayjobs.com/GIRO/job/Montral-Rosemont/Stage_R-100000320/apply/applyManually",
  "a posting opens on its /apply/applyManually page",
);
check(workdayApplyUrl("https://x.wd1.myworkdayjobs.com/Site/job/A/B_R1/apply/applyManually") === "https://x.wd1.myworkdayjobs.com/Site/job/A/B_R1/apply/applyManually", "an apply page is left as it is");
check(workdayApplyUrl("https://jobs.lever.co/a/1") === "https://jobs.lever.co/a/1", "other systems are left alone");

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall registry checks passed");
