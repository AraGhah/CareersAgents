// Offline: no database, no network. The rules the CV ↔ posting match runs on, each with the case that once broke it.
//   npm run match:check

import { isExcludedTitle } from "../lib/discover-core";
import { minScoreLabel, parseJobSort, parseMinScore, parseTrackerMin, viewTrackerRows } from "../lib/list-filters";
import { buildCvProfile } from "../lib/match/cv";
import { internshipTerms } from "../lib/match/analyze";
import { classifyRole, educationNeed, isCybersecurityRole } from "../lib/match/lexicon";
import { emptyProfile } from "../lib/profile";
import { COMPONENT_NAMES, defaultWeights, findSkills, scoreJob, setCvProfile, type ScoreInput } from "../lib/score";

let failed = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${!ok && detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failed += 1;
}

// A CV shaped like the real one: levels in the skills list, technologies used in projects.
const cv = buildCvProfile([
  {
    raw_text: `PROFILE Third-year Computer Science Technology student. Backend development and object-oriented programming through team and personal projects.
PROJECTS Dossier: AI-powered research platform. TypeScript, Node.js, Express, PostgreSQL, React, Claude API. Development of the backend architecture, REST APIs and an authentication system. Team project, collaboration with Git.
TECHNICAL SKILLS Programming languages: C#(intermediate), Java(intermediate), Python(beginner), JavaScript(intermediate), SQL(Intermediate), TypeScript(intermediate), Rust(learning)
Web development: React, Node.js, HTML, CSS, API Rest. Databases: MongoDB, SQL, MySQL. Game engine: Unity. Tools: Git, GitHub. Operating systems: Ubuntu.`,
    profile_json: {
      ...emptyProfile("en"),
      skills: ["TypeScript", "JavaScript", "Node.js", "React", "Python", "Java", "C#", "Rust", "Unity", "PostgreSQL", "MySQL", "SQL", "MongoDB", "Git"],
      projects: [
        { name: "Dossier: AI-powered research platform", tech: ["TypeScript", "Node.js", "Express", "PostgreSQL", "React"], summary: "Backend, REST APIs and authentication." },
      ],
    },
  },
]);
setCvProfile(cv);

const job = (over: Partial<ScoreInput> & { title: string }): ScoreInput => ({
  location: "Montréal, QC, Canada",
  workplaceType: "hybrid",
  description: null,
  companyCity: null,
  ...over,
});
const longText = (s: string) => `${s} ${"General information about the team and the company. ".repeat(6)}`;

console.log("the CV, read level by level");
check(cv.skills.get("TypeScript")?.credit === 1 && /projet/.test(cv.skills.get("TypeScript")?.evidence ?? ""), "used in a project → full credit, with where");
check(cv.skills.get("Python")?.credit === 0.55, "'Python (beginner)' is 0.55, not overridden by the plain skills list", cv.skills.get("Python"));
check(cv.skills.get("Rust")?.credit === 0.4, "'Rust (learning)' is 0.4");
check(cv.skills.get("C#")?.credit === 0.9, "'C# (intermediate)' is 0.9");
check(cv.skills.get("Git")?.credit === 0.8, "listed with no level is 0.8");
check(!cv.skills.has("Kafka") && !cv.skills.has("Docker"), "a technology the CV never names is never credited");
check(cv.concepts.has("backend") && cv.concepts.has("oop") && cv.concepts.has("auth") && !cv.concepts.has("testing"), "practices come from the CV's own words", [...cv.concepts]);

console.log("\nthe technology dictionary");
check(findSkills("You will excel in a fast team").every((s) => s.name !== "Excel"), "'excel' the verb is not Excel");
check(findSkills("Proficient in Word, Excel and PowerPoint").some((s) => s.name === "Excel"), "…and the application is");
check(findSkills("Réponds vite à nos clients").every((s) => s.name !== "Vite"), "'vite' (quickly) is not Vite");
check(findSkills("Contact Claude Dupont").every((s) => s.name !== "Claude API"), "a first name is not the Claude API");
check(findSkills("COBOL mainframe and AS/400 (IBM i)").map((s) => s.name).join() === "COBOL,AS/400,Mainframe", "enterprise stacks are found, so they show as missing", findSkills("COBOL mainframe and AS/400 (IBM i)"));

console.log("\nskills: how much a posting asks, and partial credit");
const asked = (text: string) => scoreJob(job({ title: "Software Developer Intern - Winter 2027", description: longText(text) })).report;
const required = asked("Requirements: Kubernetes, Kafka and Terraform experience. Nice to have: React.");
const niceToHave = asked("Requirements: React experience. Nice to have: Kubernetes, Kafka and Terraform.");
check(niceToHave.criteria[0].score > required.criteria[0].score, "what a posting requires weighs more than what it only nice-to-haves", [niceToHave.criteria[0].score, required.criteria[0].score]);
const vue = asked("Requirements: Vue and MySQL.");
check(vue.skills.related.some((s) => s.name === "Vue" && s.via === "React") && vue.skills.matched.some((s) => s.name === "MySQL"), "Vue asked, React known: partial credit, and it says from what", vue.skills);
const vueScore = vue.criteria[0].score;
const missingScore = asked("Requirements: Kubernetes and Terraform.").criteria[0].score;
const matchedScore = asked("Requirements: React and PostgreSQL.").criteria[0].score;
check(matchedScore > vueScore && vueScore > missingScore, "matched > related > missing", [matchedScore, vueScore, missingScore]);
const noTech = scoreJob(job({ title: "Software Developer Intern - Winter 2027", description: longText("We build things for customers.") })).report;
check(noTech.criteria[0].score === 0.5, "no technology named is neutral (0.5), never a guess either way", noTech.criteria[0]);
const oneInTitle = scoreJob(job({ title: "Software Developer Intern (TypeScript) - Winter 2027" })).report;
check(oneInTitle.criteria[0].score > 0.5 && oneInTitle.criteria[0].score < 0.85, "a single technology in a title is one data point, not proof", oneInTitle.criteria[0].score);

console.log("\nno description");
const bare = scoreJob(job({ title: "Stagiaire en développement logiciel (Hiver 2027)" }));
check(bare.report.confidence === "low" && bare.report.hasDescription === false, "says so: low confidence");
check(bare.percent < 85, "a title alone cannot score like a verified match", bare.percent);

console.log("\nthe kind of role");
const role = (t: string, d: string | null = null) => classifyRole(t, d).bucket;
check(role("Stagiaire développeur logiciel (hiver 2027)") === "software" && role("Intern, Fullstack Developer (Python)") === "software", "software developer titles");
check(role("Stage - développement Web frontend") === "software", "web development in French");
check(role("Intern, Hydromechanical systems (Winter 2027)") === "off-target" && role("Tax Intern - Tax Technology & AI Enablement") === "off-target" && role("Product Management Intern") === "off-target", "other disciplines are off target");
check(role("Stage en conception électrique / Electrical Designer Intern") === "off-target" && role("Intern - Electromechanical") === "off-target", "electrical and electromechanical too");
check(role("Stagiaire développeur IA") === "ai-developer" && role("Intern Cloud Developer") === "cloud-devops" && role("Quality Assurance Intern") === "qa", "adjacent technical roles");
check(role("Software Developer Intern - Finance Platform") === "software", "a software title that names a domain is still software");
check(role("Stage universitaire | Technologies numériques - Développement") === "developer", "'Développement' as a noun is a developer role");
check(classifyRole("Product Management Intern", null).score === 0 && classifyRole("Stagiaire développeur logiciel", null).score === 1, "off target scores 0, software 1");

console.log("\ncybersecurity is never wanted");
check(isCybersecurityRole("Stage universitaire | Technologies numériques - Cybersécurité - Hiver 2027", null), "'Cybersécurité' in a title (an accent-final word)");
check(isCybersecurityRole("Internship with the Desjardins Group Security Office, Winter 2027", null) && isCybersecurityRole("Stage au Bureau de la Sécurité Desjardins", null), "a Security Office, in English and French");
check(isCybersecurityRole("May 2027 - Cyber as a Service - Summer Intern", null) && isCybersecurityRole("Security Analyst Intern", null), "'Cyber as a Service', 'Security Analyst'");
check(!isCybersecurityRole("Software Developer Intern - Genetec Security Center", null), "a software role at a security company is not one");
check(!isCybersecurityRole("Software Developer Intern", "We build video surveillance software. Our security products protect cities."), "a description that only mentions security in passing is not one");
check(isCybersecurityRole("Stagiaire TI", "Vulnérabilités, menaces, SIEM, SOC, réponse aux incidents, pentest, cybersécurité, OWASP, malware, firewall."), "a description that is about it is");
const cyber = scoreJob(job({ title: "Stage - Cybersécurité - Hiver 2027", description: longText("Winter 2027. Python and Linux.") }));
check(cyber.gated && cyber.report.cybersecurity && cyber.report.gateReasons.some((r) => /cybers/.test(r)), "scored, gated, with the reason stated", cyber.report.gateReasons);
check(isExcludedTitle("Stage en cybersécurité") && isExcludedTitle("Cyber Analyst Intern") && isExcludedTitle("Développeur sénior"), "the discovery filter catches accent-final terms too (\\b could not)");
check(!isExcludedTitle("Stagiaire développeur logiciel"), "…and leaves software titles alone");

console.log("\nthe internship term");
const terms = (t: string, d = "") => internshipTerms(t, d);
check(terms("Software intern (Winter 2027)").some((x) => x.season === "winter" && x.year === 2027), "Winter 2027");
check(terms("Stagiaire", "Une terrasse ouverte durant l'été et l'automne. Chez CAE, vous aurez l'occasion…").length === 0, "a rooftop terrace open in summer is not the internship term");
check(terms("Intern", "Java with Spring Boot; founded in September 1997; date posted: November 2026").length === 0, "Spring Boot, a founding year and a posting date are not terms");
check(terms("Stagiaire en développement (été 2027)").some((x) => x.season === "summer" && x.year === 2027), "été 2027 is summer");
check(terms("Intern", "This internship starts in January 2027 in Montréal").some((x) => x.season === "winter" && x.year === 2027), "a start month beside 'internship' is a term");
const timing = (t: string, d = "") => scoreJob(job({ title: t, description: d })).components.timing;
check(timing("Software Intern (Winter 2027)") === 1 && timing("Software Intern (Summer 2027)") === 0 && timing("Software Intern", "Winter 2026 session") === 0, "winter 2027 fits, summer and a past winter do not");
check(timing("Software Intern") === 0.7, "an internship naming no term is 0.7, to confirm");

console.log("\nthe level of study");
check(educationNeed("Intern", "Master's degree required") === "graduate" && educationNeed("Intern", "Pursuing a PhD in computer science") === "graduate", "a master's or a doctorate");
check(educationNeed("Stagiaire", "La maîtrise de l'anglais est requise pour ce poste") === null, "'la maîtrise de l'anglais' is mastery of English, not a master's degree");
check(educationNeed("Stagiaire", "Une maîtrise en informatique est exigée") === "graduate", "'maîtrise en informatique' is");
check(educationNeed("Intern", "Pursuing a bachelor's degree") === "university" && educationNeed("Intern", "Enrolled in a college or university program") === null, "university only vs college welcome");
check(educationNeed("Intern", "Scrum Master experience is a plus") === null, "a Scrum Master is not a master's degree");

console.log("\nthe place");
const place = (loc: string, d = "") => scoreJob(job({ title: "Software Intern", location: loc, description: d })).components.location;
check(place("Montréal, QC") === 1 && place("Longueuil, Quebec") === 0.9 && place("Toronto, ON") === 0, "Montréal 1, the South Shore 0.9, Toronto 0");
check(place("Toronto, ON", "Join our team. We also have an office in Montréal.") === 0, "the posting's own place decides, not another office named in the text");
check(place("Sherbrooke, Quebec") === 0.4, "elsewhere in Québec is 0.4, not a skip");

console.log("\nthe report adds up");
const full = scoreJob(job({ title: "Software Developer Intern - Winter 2027", description: longText("Requirements: TypeScript, React, PostgreSQL, Docker and REST APIs. Nice to have: Kafka.") }));
const summed = full.report.criteria.reduce((sum, c) => sum + c.score * c.weight * 100, 0);
check(Math.abs(summed - full.report.percentPrecise) < 0.06, "the points of each criterion add up to the percent shown", [summed, full.report.percentPrecise]);
check(COMPONENT_NAMES.every((n) => full.components[n] >= 0 && full.components[n] <= 1), "every component is between 0 and 1");
check(Math.abs(COMPONENT_NAMES.reduce((s, n) => s + defaultWeights[n], 0) - 1) < 0.001, "the weights sum to 1");
const again = scoreJob(job({ title: "Software Developer Intern - Winter 2027", description: longText("Requirements: TypeScript, React, PostgreSQL, Docker and REST APIs. Nice to have: Kafka.") }));
check(again.percentPrecise === full.percentPrecise && JSON.stringify(again.report) === JSON.stringify(full.report), "the same posting and CV give the same report every time");
const strong = scoreJob(job({ title: "Software Developer Intern - Winter 2027", description: longText("Requirements: TypeScript, React, Node.js and PostgreSQL. You work on REST APIs and authentication, with Git and code review.") }));
const weak = scoreJob(job({ title: "Software Developer Intern - Winter 2027", description: longText("Requirements: COBOL, AS/400, Mainframe and JCL experience.") }));
check(strong.percent > weak.percent + 10, "a posting in your stack beats one in another, by a clear margin", [strong.percent, weak.percent]);
check(scoreJob(job({ title: "Mechanical Engineering Intern (Winter 2027)" })).gated, "a mechanical internship is skipped, not just ranked low");

console.log("\nthe score filter and the order of the lists");
check(parseMinScore(undefined) === undefined && parseMinScore("") === undefined, "no minimum given: the default (60 and over)");
check(parseMinScore("70") === 70 && parseMinScore("0") === 0 && parseMinScore("85") === 85, "the offered minimums are taken");
check(parseMinScore("63") === undefined && parseMinScore("abc") === undefined && parseMinScore("-5") === undefined && parseMinScore("999") === undefined, "a hand-edited URL cannot ask for a strange cut");
check(parseMinScore(undefined, "1") === 0 && parseMinScore("80", "1") === 80, "the old 'Sous 60' link still shows every score, and an explicit minimum wins over it");
check(minScoreLabel(undefined) === null && minScoreLabel(0) === "tous les scores" && minScoreLabel(70) === "score 70 et plus", "the active filter is named");
check(parseJobSort(undefined) === "best" && parseJobSort("worst") === "worst" && parseJobSort("actionable") === "actionable" && parseJobSort("; drop table jobs") === "best", "an order is one of the five, never anything else");
check(parseTrackerMin("60") === 60 && parseTrackerMin("") === undefined && parseTrackerMin("61") === undefined, "the Tracker takes 60 as a choice; nothing hidden by default");
const tracked = [
  { id: "a", score: "0.74" }, { id: "b", score: null }, { id: "c", score: "0.91" }, { id: "d", score: "0.55" }, { id: "e", score: "0.74" },
];
check(viewTrackerRows(tracked, { sort: "status" }).map((r) => r.id).join("") === "abcde", "by status: the rows as the query gave them");
check(viewTrackerRows(tracked, { sort: "best" }).map((r) => r.id).join("") === "caedb", "best first: 91, then the two 74 in their order, then 55, the unscored last");
check(viewTrackerRows(tracked, { sort: "worst" }).map((r) => r.id).join("") === "daecb", "worst first: 55, 74, 74, 91, the unscored still last");
check(viewTrackerRows(tracked, { min: 70, sort: "best" }).map((r) => r.id).join("") === "caeb", "70 and over: 91, 74, 74, and a row not scored yet is kept (pending, not low)");
check(viewTrackerRows(tracked, { min: 90, sort: "best" }).map((r) => r.id).join("") === "cb", "90 and over: only the 91 (and the pending one)");

if (failed) {
  console.log(`\n${failed} match check(s) failed`);
  process.exit(1);
}
console.log("\nmatch-check passed");
