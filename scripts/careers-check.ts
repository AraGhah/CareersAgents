// Offline: no database, no network. The rules that decide whether a listed job on a company's own site is
// the same role as a LinkedIn / Indeed posting, and how a company's job board is spotted in its pages.
//   npm run careers:check

import { boardFromUrl, boardKey, knownBoards, needsVisibleBrowser, searchText } from "../lib/apply/boards";
import {
  anchorJobs,
  anchorsOf,
  careersPageOf,
  findBoardRefs,
  findPortalLinks,
  pickRole,
  roleScore,
} from "../lib/apply/careers-parse";

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}

console.log("job boards spotted in a careers page");
const html = `
  <a href="https://boards.greenhouse.io/acme/jobs/123">Software Developer Intern</a>
  <iframe src="https://boards.greenhouse.io/embed/job_board?for=beta"></iframe>
  <script src="https://boards.greenhouse.io/embed/job_board/js?for=zeta"></script>
  <a href="https://jobs.lever.co/gamma">Lever</a>
  <a href="https://jobs.eu.lever.co/gammaeu/abc">Lever EU</a>
  <a href="https://jobs.ashbyhq.com/delta">Ashby</a>
  <a href="https://apply.workable.com/epsilon/">Workable</a>
  <a href="https://boards.greenhouse.io/embed/">not a board</a>
`;
const refs = findBoardRefs(html).map((r) => `${r.platform}:${r.token}`);
for (const want of ["greenhouse:acme", "greenhouse:beta", "greenhouse:zeta", "lever:gamma", "lever:gammaeu", "ashby:delta", "workable:epsilon"]) {
  check(refs.includes(want), `finds ${want}`);
}
check(!refs.some((r) => /:embed$/.test(r)), "the platform's own /embed path is not a company");
check(findBoardRefs('<a href="https://boards.greenhouse.io/acme">a</a><a href="https://boards.greenhouse.io/ACME/jobs/1">b</a>').length === 1, "the same board twice is one");

console.log("\nother application systems");
const portals = findPortalLinks(
  `<a href="https://autodesk.wd1.myworkdayjobs.com/Ext">Workday</a>
   <a href="https://acme.applytojob.com/apply">Jazz</a>
   <a href="https://www.linkedin.com/company/acme/jobs">LinkedIn</a>
   <a href="https://www.indeed.com/cmp/acme/jobs">Indeed</a>
   <a href="/careers/internships">local</a>`,
  "https://www.acme.com/careers",
);
check(portals.some((p) => /myworkdayjobs/.test(p.url) && p.account), "Workday is an account portal");
check(portals.some((p) => /applytojob/.test(p.url) && !p.account), "a JazzHR form is not");
check(!portals.some((p) => /linkedin|indeed/.test(p.url)), "job boards are not a company's own portal");
const withAssets = findPortalLinks(
  `<link rel="stylesheet" href="https://rmkcdn.successfactors.com/abc/site.css">
   <script src="https://rmkcdn.successfactors.com/abc/app.js"></script>
   <a href="https://career5.successfactors.eu/career?company=hq">Apply</a>
   <iframe src="https://acme.wd1.myworkdayjobs.com/Ext"></iframe>`,
  "https://www.hq.example/",
);
check(withAssets.length === 2 && !withAssets.some((p) => /\.(css|js)/.test(p.url)), "a portal's stylesheets and scripts are not links to it; its anchors and iframes are");

console.log("\nthe careers page");
check(careersPageOf([{ url: "https://acme.com/" }, { url: "https://acme.com/about" }, { url: "https://acme.com/careers/students" }, { url: "https://acme.com/careers" }]) === "https://acme.com/careers", "the shallowest careers page");
check(careersPageOf([{ url: "https://acme.com/" }, { url: "https://acme.com/about" }]) === null, "none when nothing looks like one");
check(careersPageOf([{ url: "https://hydro.example/nous-joindre/" }, { url: "https://hydro.example/fr/pour-nous-joindre" }]) === null, "'nous-joindre' is contact us, not a careers page");
check(careersPageOf([{ url: "https://acme.com/join-us" }]) === "https://acme.com/join-us", "'join-us' is");

console.log("\nthe same role");
const posting = "Intern, Software Developer/ Stagiaire en Développement Logiciel";
check(roleScore(posting, "Software Developer Intern (Winter 2027)") === 1, "bilingual posting = English listing, with the term added");
check(roleScore(posting, "Stagiaire en développement logiciel") === 1, "bilingual posting = French listing");
check(roleScore("Stagiaire en développement logiciel", posting) === 1, "and the other way round");
check(roleScore(posting, "Software Developer") === 0, "never the full-time job of the same name");
check(roleScore(posting, "Senior Software Developer Intern") === 0, "never a senior role");
check(roleScore(posting, "Backend Developer Intern") === 0, "a different role is not a match");
check(
  roleScore("Développeur(se) IA – Stage/Co-op 4 mois (Hiver 2027)", "Stagiaire en Actuariat - Co-op/ Stage 4 mois (Hiver 2027, Automne 2027 & Été 2027)") === 0,
  "a shared 'Co-op 4 mois' half does not make two roles one",
);
check(roleScore("AI Developer – 4-Month Internship/Co-op (Winter 2027)", "AI Developer - 4-Month Internship (Winter 2027)") === 1, "the same role with and without its program half");
check(roleScore(posting, "Software Developer Intern - Software Testing") === 0, "a narrower role is not a match");
check(roleScore("Software Developer Intern - Winter 2027", "Software Developer Intern - Summer 2027") === 0, "another term is not a match");
check(roleScore("Software Developer Intern 2027", "Software Developer Intern 2026") === 0, "another year is not a match");
check(roleScore("Software Developer Intern", "Software Developer Intern - Summer 2027") === 1, "a term only one side names does not stop it");

console.log("\nchoosing among listed jobs");
const wanted = { title: posting, location: "Montréal, QC, Canada" };
const mtl = { title: "Software Developer Intern", url: "https://x/1", location: "Montréal, QC" };
const india = { title: "Software Developer Intern", url: "https://x/2", location: "Bangalore, India" };
check(pickRole(wanted, [india, mtl])?.url === "https://x/1", "the one in Québec wins");
check(pickRole(wanted, [india]) === null, "a role elsewhere is not it");
check(pickRole(wanted, [mtl, { ...mtl, url: "https://x/3" }]) === null, "two equal candidates are a tie, never the first");
check(pickRole(wanted, [{ ...mtl, location: null }])?.url === "https://x/1", "no place listed is fine for a word-for-word title");
check(pickRole(wanted, [{ title: "Intern, Software Developer II", url: "https://x/4", location: null }]) === null, "no place listed is not fine for a loose one");
check(pickRole(wanted, []) === null, "nothing listed, nothing found");

console.log("\nlinks on a careers page");
const page = {
  url: "https://acme.com/careers",
  html: `<a href="/careers/software-developer-intern">Software Developer Intern</a>
         <a href="https://www.linkedin.com/jobs/view/1">Software Developer Intern</a>
         <a href="https://acme.wd3.myworkdayjobs.com/j/2">Software Developer Intern</a>
         <a href="/careers/chef">Head Chef</a>`,
};
check(anchorsOf(page.html, page.url).length === 4, "reads every link with its text");
const jobs = anchorJobs([page], posting);
check(jobs.some((j) => j.url === "https://acme.com/careers/software-developer-intern"), "a link on the company's own site is a job");
check(jobs.some((j) => /myworkdayjobs/.test(j.url)), "a link to its application system is a job");
check(!jobs.some((j) => /linkedin/.test(j.url)), "a link back to LinkedIn is not");
check(!jobs.some((j) => /chef/.test(j.url)), "other roles are not");

console.log("\nemployer job systems (lib/apply/boards.ts)");
check(roleScore("Stage universitaire | Informatique - Hiver 2027", "Stage universitaire | Économie - Hiver 2027") === 0, "a shared program label ('Stage universitaire') does not make two internships the same role");
check(roleScore("Stage universitaire | Recherche et développement - Hiver 2027", "Stage universitaire | Recherche et développement - Hiver 2027") === 1, "…while the same internship still matches");
const wd = boardFromUrl("https://autodesk.wd1.myworkdayjobs.com/en-US/Ext/job/Montreal-QC-CAN/Intern_26WD1");
check(wd?.ats === "workday" && wd.tenant === "autodesk" && wd.site === "Ext", "a Workday posting link names its tenant and site");
const sf = boardFromUrl("https://emploi.hydroquebec.com/job/Montreal-Stage-universitaire-Informatique-QC/605856717/?feedId=null");
check(sf?.ats === "successfactors" && sf.host === "emploi.hydroquebec.com", "a SuccessFactors career-site link is recognised");
check(boardFromUrl("https://jobs.smartrecruiters.com/Ubisoft2/7440000123")?.ats === "smartrecruiters", "a SmartRecruiters link is recognised");
check(boardFromUrl("https://careers-kinaxis.icims.com/jobs/35465/intern-ai%26ml-researcher/job")?.ats === "icims", "an iCIMS link is recognised");
check(boardFromUrl("https://careers.ibm.com/careers/JobDetail?jobId=129790")?.ats === "ibm", "an IBM careers link is recognised");
check(boardFromUrl("https://flexspring.bamboohr.com/careers/72")?.ats === "bamboohr", "a BambooHR link is recognised");
check(boardFromUrl("https://www.bamboohr.com/careers") === null, "BambooHR's own site is not a company board");
const nj1 = boardFromUrl("https://clients.njoyn.com/CORP/xweb/xweb.asp?page=joblisting&amp;CLID=21001");
const nj2 = boardFromUrl("https://cgi.njoyn.com/corp/xweb/xweb.asp?NTKN=c&clid=21001&page=joblisting&lang=2");
check(nj1?.ats === "njoyn" && !!nj2 && boardKey(nj1) === boardKey(nj2), "a Njoyn link is recognised, &amp; and all, and its two hosts are one site");
check(boardFromUrl("https://cgi.njoyn.com/corp/xweb/xweb.asp?page=login") === null, "a Njoyn page with no client id is not a board");
check(needsVisibleBrowser("https://cgi.njoyn.com/corp/xweb/xweb.asp?Page=JobDetails&Jobid=J0926-2073") && !needsVisibleBrowser("https://jobs.lever.co/x/1"), "only Njoyn sites need a visible browser");
check(
  findPortalLinks(`<a href="https://cgi.njoyn.com/corp/xweb/xweb.asp?NTKN=c&amp;clid=21001&amp;page=joblisting">Jobs</a>`, "https://www.cgi.com/en/careers")[0]?.url ===
    "https://cgi.njoyn.com/corp/xweb/xweb.asp?NTKN=c&clid=21001&page=joblisting",
  "a link written with &amp; is read as the browser reads it",
);
check(knownBoards("Kinaxis")[0]?.ats === "icims" && knownBoards("IBM Canada")[0]?.ats === "ibm", "Kinaxis and IBM are in employers.json");
check(boardFromUrl("https://www.linkedin.com/jobs/view/123") === null && boardFromUrl("https://acme.com/careers/job/x") === null, "anything else is not");
check(knownBoards("Intact Financial Corporation")[0]?.ats === "workday" && knownBoards("Hydro-Québec")[0]?.ats === "successfactors", "employers.json finds a company by its name or an alias");
check(searchText("Software Developer Full Stack / Backend I (Co-op) - Winter 2027") === "software developer full stack backend", "the search is the role's own words, without the internship noise");

if (failed) {
  console.log(`\n${failed} careers check(s) failed`);
  process.exit(1);
}
console.log("\ncareers-check passed");
