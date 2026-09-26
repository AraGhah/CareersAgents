// Checks the email and cover letter templates against the application guide.
//   npx tsx scripts/letter-check.ts            run the checks
//   npx tsx scripts/letter-check.ts --show     also print an English and a French sample
//   npx tsx scripts/letter-check.ts --out DIR  also write every sample letter as a PDF into DIR
//
// No database and no network: it builds letters from seed/project-data.ts and fixed postings.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EMAIL_WORD_RANGE,
  fillLetter,
  detectLetterLang,
  fillFollowupEmail,
  fillOutreachEmail,
  flagUnknownNouns,
  signatureLines,
  usableCompanyFact,
  type LetterInput,
  type LetterLang,
} from "../lib/letter";
import { renderLetterPdf } from "../lib/letter-pdf";
import { projects as seedProjects } from "../seed/project-data";
import type { Project } from "../lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const projects: Project[] = seedProjects.map((p) => ({
  id: p.name,
  name: p.name,
  summary: p.summary,
  tech: p.tech,
  url: p.url ?? null,
  highlight_for: p.highlight_for,
}));

const byName = (...names: string[]) => names.map((n) => projects.find((p) => p.name === n)!);

const base = {
  fullName: "Ara Ghahramanyan",
  locationRule: "Montréal or Laval on-site or hybrid; fully remote elsewhere in Canada",
  links: [
    "https://linkedin.com/in/ara-ghahramanyan",
    "https://github.com/AraGhah",
    "https://ara-hall-of-projects.vercel.app",
  ],
  email: "ara.ghahramanyan07@gmail.com",
  phone: "438-993-6997",
  city: "Montréal, QC",
};

type Scenario = { name: string; input: LetterInput; expectFactUsed: boolean };

function scenario(name: string, lang: LetterLang, over: Partial<LetterInput>, expectFactUsed = false): Scenario {
  return {
    name: `${name} [${lang}]`,
    expectFactUsed,
    input: {
      ...base,
      availability: lang === "fr" ? "Janvier 2027" : "January 2027",
      companyName: "Example Co",
      roleTitle: "Software Developer Intern",
      companyFact: "Example Co is hiring for Software Developer Intern.",
      companyFactSource: "https://example.com",
      postingDescription: null,
      projects: byName("Dossier", "Travel Express", "TradeCatch"),
      lang,
      ...over,
    },
  };
}

const scenarios: Scenario[] = [
  // The everyday case: title only, no description, and the research step found nothing usable.
  scenario("devops title, placeholder fact", "en", {
    companyName: "Intact",
    roleTitle: "Developer DevOPS - 4 months Co-op Internship (Winter 2027)",
    companyFact: "Intact is hiring for Developer DevOPS - 4 months Co-op Internship (Winter 2027).",
    projects: byName("SentinelOps", "Dossier", "Travel Express"),
  }),
  scenario("scraped navigation as fact", "en", {
    companyName: "AlayaCare",
    roleTitle: "Intern, Fullstack Developer (Python) - Winter Semester 2027",
    companyFact: "Join us to shape the future of home-based health care View Open Positions Who We Are Join the team.",
  }),
  scenario("french posting, placeholder fact", "fr", {
    companyName: "GIRO",
    roleTitle: "Hiver 2027 - Stagiaire en développement logiciel",
    companyFact: "GIRO is hiring for Hiver 2027 - Stagiaire en développement web, Front-end.",
  }),
  scenario("french posting, english scraped fact", "fr", {
    companyName: "Exegy",
    roleTitle: "Stagiaire en développement logiciel / Software Developer Intern",
    companyFact: "We build ultra-low latency technology for the world's most demanding trading firms and their teams.",
  }),
  // A posting with a body, a verified fact that opens with the company name, and a named contact.
  scenario(
    "posting body, verified fact, named contact",
    "en",
    {
      companyName: "Genetec",
      roleTitle: "Software Development Intern (Backend)",
      postingDescription: "You will build REST APIs in C# and .NET with PostgreSQL, deployed on AWS. Experience with React is an asset.",
      companyFact: "Genetec builds unified security software that is used by cities and airports.",
      companyFactVerified: true,
      recruiterName: "Jane Doe",
      projects: byName("SentinelOps", "Dossier"),
    },
    true,
  ),
  scenario(
    "verified fact that is a fragment",
    "en",
    {
      companyName: "Matrox",
      roleTitle: "Intern, Software - Winter 2027",
      companyFact: "Its video cards are built and validated in Dorval",
      companyFactVerified: true,
    },
    true,
  ),
  scenario(
    "french verified fact, french posting body",
    "fr",
    {
      companyName: "Pomerleau",
      roleTitle: "Stagiaire en développement logiciel infonuagique",
      postingDescription: "Vous travaillerez avec AWS, Docker et TypeScript pour outiller les équipes de chantier.",
      companyFact: "Pomerleau réalise des projets de construction partout au Canada.",
      companyFactVerified: true,
      recruiterName: "Marie Tremblay",
      projects: byName("SentinelOps", "Dossier"),
    },
    true,
  ),
  // The example email Ara wrote for SAP: Java is named by the posting but not something claimed yet,
  // so it becomes a skill to grow; the experience list comes from the cloud project.
  scenario("SAP cloud role, Java to learn", "en", {
    companyName: "SAP",
    roleTitle: "SAP iXp Intern – Java Developer, Cloud Development",
    companyFact: "SAP is hiring for SAP iXp Intern – Java Developer, Cloud Development.",
    projects: byName("SentinelOps", "Dossier", "Travel Express"),
  }),
  // "AI" in a title is a role focus, but nothing in the project list backs a claim about ML techniques.
  scenario("AI title", "en", {
    companyName: "CGI",
    roleTitle: "Winter 2027 Co-op: AI Developer Intern (4 months)",
    companyFact: "CGI is hiring for Winter 2027 Co-op: AI Developer Intern (4 months).",
  }),
  scenario("game role", "en", {
    companyName: "Studio Example",
    roleTitle: "Game Programmer Intern",
    projects: byName("VAMP2 Survivors", "Dossier"),
  }),
  scenario("single project only", "en", { projects: byName("TradeCatch") }),
];

const FR_FORBIDDEN = /\b(the|and|with|which|through|role|posting)\b/i;
const FR_GENDERED = /\b(étudiant|heureux|heureuse|intéressé|intéressée|motivé|motivée|passionné|passionnée|ravi|ravie)\b/i;

function paragraphsAfterGreeting(letter: string, lang: LetterLang): string[] {
  const blocks = letter.split("\n\n");
  const greetingAt = blocks.findIndex((b) => /^(Dear |Bonjour|Madame, Monsieur)/.test(b));
  assert(greetingAt !== -1, "greeting not found");
  const signOffAt = blocks.findIndex((b) => b === (lang === "fr" ? "Cordialement," : "Sincerely,"));
  assert(signOffAt !== -1, "sign-off not found");
  return blocks.slice(greetingAt + 1, signOffAt);
}

async function checkScenario(s: Scenario, outDir: string | null) {
  const { input } = s;
  const lang = input.lang;
  const letter = fillLetter(input);
  const email = fillOutreachEmail(input);
  const where = `${s.name}`;

  // Header, in the template's layout.
  const head = letter.split("\n").slice(0, 4);
  assert(head[0] === input.fullName, `${where}: header starts with the name`);
  assert(head[1] === "Montréal, QC | 438-993-6997 | ara.ghahramanyan07@gmail.com", `${where}: contact line: ${head[1]}`);
  assert(head[2] === "linkedin.com/in/ara-ghahramanyan | github.com/AraGhah", `${where}: profiles line: ${head[2]}`);
  assert(head[3] === "ara-hall-of-projects.vercel.app", `${where}: portfolio line: ${head[3]}`);

  // Six parts: header, then opening, match, proof, company fit, closing.
  const paragraphs = paragraphsAfterGreeting(letter, lang);
  assert(paragraphs.length === 5, `${where}: expected 5 body paragraphs, got ${paragraphs.length}`);
  const [opening, match, proof, fit, closing] = paragraphs;
  assert(opening.includes(input.roleTitle), `${where}: opening must use the exact role title`);
  assert(opening.includes(lang === "fr" ? "janvier 2027" : "January 2027"), `${where}: opening states availability`);
  assert(/^(Through my|Par mes)/.test(match), `${where}: match paragraph starts like the template`);
  assert(/^(In |Dans )/.test(proof), `${where}: proof paragraph starts with the project`);
  assert(fit.includes(input.companyName), `${where}: company fit names the company`);
  assert(
    closing.startsWith(lang === "fr" ? "Je souhaiterais avoir l’occasion" : "I would welcome the opportunity"),
    `${where}: closing invites a conversation`,
  );
  assert(letter.includes(input.companyName), `${where}: company in letter`);
  if (input.recruiterName) assert(letter.includes(input.recruiterName), `${where}: recruiter named`);

  // Nothing left to fill in, nothing invented.
  for (const [label, text] of [["letter", letter], ["email", email.body], ["subject", email.subject]] as const) {
    assert(!/[[\]]/.test(text), `${where}: bracket left in ${label}`);
  }
  const flags = flagUnknownNouns(letter, input);
  assert(flags.length === 0, `${where}: proper nouns outside the input: ${flags.map((f) => f.word).join(", ")}`);

  // The company detail must be a verified one, or the letter must say something about the role instead.
  const used = usableCompanyFact(input.companyFact, { lang, verified: input.companyFactVerified }) !== null;
  assert(used === s.expectFactUsed, `${where}: expected usable fact = ${s.expectFactUsed}, got ${used}`);
  assert(!/is hiring for|recrute pour/i.test(letter), `${where}: placeholder fact leaked into the letter`);
  assert(!/View Open Positions/i.test(letter), `${where}: scraped navigation leaked into the letter`);
  if (used) {
    // A fact that opens with the company name and a verb is rewritten as "because it ..." /
    // "parce que l’entreprise ..."; anything else appears as written.
    const fact = input.companyFact.replace(/\.$/, "");
    const tail = fact.startsWith(`${input.companyName} `) ? fact.slice(input.companyName.length) : fact;
    assert(fit.includes(tail), `${where}: company fit should contain the verified fact`);
    assert(!fit.includes(`${input.companyName} ${input.companyName}`), `${where}: company name doubled`);
  }

  // Language: a French posting gets French text throughout, without gendered self-reference.
  if (lang === "fr") {
    for (const [label, text] of [["letter", letter], ["email", email.body]] as const) {
      const scan = text.replace(input.roleTitle, "");
      assert(!FR_FORBIDDEN.test(scan), `${where}: English word in French ${label}: ${scan.match(FR_FORBIDDEN)?.[0]}`);
      assert(!FR_GENDERED.test(scan), `${where}: gendered wording in French ${label}: ${scan.match(FR_GENDERED)?.[0]}`);
    }
  }

  // Email: the five parts, the subject format, and the length.
  const subjectStart = lang === "fr" ? "Candidature" : "Application";
  assert(email.subject === `${subjectStart} - ${input.roleTitle} - ${input.fullName}`, `${where}: subject: ${email.subject}`);
  assert(email.body.includes(input.roleTitle), `${where}: email names the exact role`);
  assert(
    email.wordCount >= EMAIL_WORD_RANGE.min && email.wordCount <= EMAIL_WORD_RANGE.max,
    `${where}: email is ${email.wordCount} words, want ${EMAIL_WORD_RANGE.min}-${EMAIL_WORD_RANGE.max}`,
  );
  assert(/(CV|cv)/.test(email.body) && /(cover letter|lettre de motivation)/.test(email.body), `${where}: email mentions attachments`);
  const label = lang === "fr" ? " :" : ":";
  for (const line of [
    input.phone!,
    `LinkedIn${label} https://linkedin.com/in/ara-ghahramanyan`,
    `GitHub${label} https://github.com/AraGhah`,
    `Portfolio${label} https://ara-hall-of-projects.vercel.app`,
  ]) {
    assert(email.body.split("\n").includes(line), `${where}: email signature is missing the line "${line}"`);
  }
  // The example's beats, in order: who I am, the role, experience + main project, attachments, invitation, sign-off.
  const beats =
    lang === "fr"
      ? ["Je m’appelle", "Je vous écris au sujet du poste", "Grâce à mes projets récents", "J’ai joint mon CV", "Je serais disponible", "Cordialement,"]
      : ["My name is", "I am reaching out regarding the", "Through my recent projects", "I have attached my CV", "I would be glad to discuss", "Best regards,"];
  let at = -1;
  for (const beat of beats) {
    const found = email.body.indexOf(beat);
    assert(found > at, `${where}: email is missing or misorders "${beat}"`);
    at = found;
  }
  assertEmailParts(email.body, lang, where);
  assert(email.body.includes(`${input.companyName}.`), `${where}: email closes with the company name`);
  if (input.roleTitle.includes("Java")) {
    assert(email.body.includes("Java and cloud development skills at SAP"), `${where}: Java should be a skill to grow`);
    assert(
      email.body.includes("hands-on experience with AWS, ASP.NET Core, C#, APIs, and backend development. One of my main projects, SentinelOps, allowed me to work with cloud infrastructure and build a more complex backend system"),
      `${where}: experience line should match the example`,
    );
    assert(email.body.includes("its focus on backend development and cloud technologies"), `${where}: focus line should match the example`);
  }

  // One page.
  const pdf = await renderLetterPdf(letter);
  assert(pdf.pages === 1, `${where}: letter runs ${pdf.pages} pages`);
  if (outDir) {
    const file = path.join(outDir, `${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
    await writeFile(file, pdf.bytes);
  }

  console.log(`  ok  ${where} · email ${email.wordCount} words · letter ${countWords(letter)} words`);
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

// The email Ara wrote as the template, verbatim (the two trailing spaces after each signature line
// in the original are markdown line breaks and are not part of the text).
const EXAMPLE_EMAIL = `Dear Hiring Team,

My name is Ara Ghahramanyan, and I am a third-year Computer Science Technology student at Collège de Bois-de-Boulogne seeking a software development internship starting in January 2027.

I am reaching out regarding the SAP iXp Intern – Java Developer, Cloud Development position. The opportunity particularly interests me because of its focus on backend development and cloud technologies.

Through my recent projects, I have gained hands-on experience with AWS, ASP.NET Core, C#, APIs, and backend development. One of my main projects, SentinelOps, allowed me to work with cloud infrastructure and build a more complex backend system, and I would be excited to bring that experience while continuing to develop my Java and cloud development skills at SAP.

I have attached my CV and cover letter for your consideration. You can also find examples of my work through my GitHub and portfolio below.

I would be glad to discuss my background and how I could contribute to this internship or other relevant upcoming opportunities at SAP.

Best regards,

Ara Ghahramanyan
438-993-6997
LinkedIn: https://linkedin.com/in/ara-ghahramanyan
GitHub: https://github.com/AraGhah
Portfolio: https://ara-hall-of-projects.vercel.app`;

/** The posting the example was written for, with the answers and projects the generator would have. */
function checkFactPhrasing() {
  const phrase = (fact: string, company: string) =>
    fillLetter({
      ...scenario("fact", "en", { companyName: company, companyFact: fact, companyFactVerified: false }).input,
    })
      .split("\n\n")
      .find((p) => p.startsWith("I am interested in"))!;
  const verb = phrase("Exegy delivers real-time market data for trading firms.", "Exegy");
  assert(verb.startsWith("I am interested in Exegy because it delivers real-time market data for trading firms."), `verb form: ${verb}`);
  const comma = phrase("Pomerleau, a Canadian construction company, is building the living environments of tomorrow.", "Pomerleau");
  assert(comma.startsWith("I am interested in Pomerleau for one specific reason: Pomerleau, a Canadian"), `comma form repeats the name only inside the quote: ${comma}`);
  console.log("  ok  a company fact is phrased as \"because it ...\" or quoted, never \"Pomerleau ... because Pomerleau\"");
}

function checkExampleEmail() {
  const s = scenario("SAP", "en", {
    companyName: "SAP",
    roleTitle: "SAP iXp Intern – Java Developer, Cloud Development",
    companyFact: "",
    projects: byName("SentinelOps", "Dossier", "Travel Express"),
  });
  const { body } = fillOutreachEmail(s.input);
  assert(body === EXAMPLE_EMAIL, `the generated SAP email differs from the example:\n--- generated\n${body}\n--- example\n${EXAMPLE_EMAIL}`);
  console.log("  ok  the SAP email is identical to Ara's example");
}

function checkFollowups() {
  for (const lang of ["en", "fr"] as const) {
    const mail = fillFollowupEmail({
      fullName: base.fullName,
      companyName: "SAP",
      roleTitle: "SAP iXp Intern – Java Developer, Cloud Development",
      phone: base.phone,
      links: base.links,
      lang,
      daysSinceSubmit: 7,
    });
    assert(mail.subject === `${lang === "fr" ? "Relance" : "Following up"} - SAP iXp Intern – Java Developer, Cloud Development - Ara Ghahramanyan`, `follow-up subject: ${mail.subject}`);
    assert(mail.body.startsWith(lang === "fr" ? "Bonjour," : "Dear Hiring Team,"), `follow-up greeting [${lang}]`);
    assert(!/[[\]]/.test(mail.body), `follow-up has a bracket [${lang}]`);
    assert(mail.body.includes("7 jours") || mail.body.includes("7 days"), `follow-up mentions how long ago [${lang}]`);
    // The same signature block as the application email.
    const signature = signatureLines({ fullName: base.fullName, phone: base.phone, links: base.links, lang }).join("\n");
    assert(mail.body.endsWith(signature), `follow-up ends with the standard signature [${lang}]`);
    if (lang === "fr") assert(!FR_FORBIDDEN.test(mail.body.replace("SAP iXp Intern – Java Developer, Cloud Development", "")), "english word in the French follow-up");
  }
  console.log("  ok  follow-up emails: greeting, subject, standard signature");
}

function checkLanguageDetection() {
  // [title, expected]: plainly French postings get French; English and bilingual ones stay English.
  const cases: Array<[string, LetterLang]> = [
    ["Stagiaire Développeur de Logiciels", "fr"],
    ["Stagiaire, développeur en innovation technologique, profil IA", "fr"],
    ["Développeur(se) IA agentique - co-op", "fr"],
    ["Stage, Secteur TI, Hiver 2027-FR", "fr"],
    ["Hiver 2027 - Stagiaire en développement logiciel", "fr"],
    ["SAP iXp Intern - Développeur Java, développement Cloud", "fr"],
    ["Software Developer Intern", "en"],
    ["SAP iXp Intern – Java Developer, Cloud Development", "en"],
    ["Winter 2027 Co-op: AI Developer Intern (4 months)", "en"],
    ["Intern, Fullstack Developer (Python) - Winter Semester 2027", "en"],
    ["Stagiaire en développement logiciel / Software Developer Intern", "en"],
    ["Applications pour les stages d'hiver / Applications for winter internship", "en"],
  ];
  for (const [title, want] of cases) {
    const got = detectLetterLang(title, null);
    assert(got === want, `language of "${title}": expected ${want}, got ${got}`);
  }
  // A body in English outweighs a French job title on its own.
  assert(detectLetterLang("Stagiaire logiciel", "You will work with the team to build software for our customers and the platform.") === "en", "English body wins");
  console.log("  ok  language detection: French postings get French, English and bilingual stay English");
}

/** Each paragraph of the email template in its own words, in order, per language. */
const EMAIL_PARTS: Record<LetterLang, string[]> = {
  en: [
    "My name is",
    "I am reaching out regarding the",
    "Through my recent projects, I have gained hands-on experience with",
    "I have attached my CV and cover letter for your consideration. You can also find examples of my work through my GitHub and portfolio below.",
    "I would be glad to discuss my background and how I could contribute to this internship or other relevant upcoming opportunities at",
    "Best regards,",
  ],
  fr: [
    "Je m’appelle",
    "Je vous écris au sujet du poste de",
    "Grâce à mes projets récents, j’ai acquis une expérience concrète avec",
    "J’ai joint mon CV et ma lettre de motivation. Vous trouverez aussi des exemples de mon travail sur mon GitHub et mon portfolio, ci-dessous.",
    "Je serais disponible pour discuter de mon parcours et de la façon dont je pourrais contribuer à ce stage ou à d’autres occasions pertinentes à venir chez",
    "Cordialement,",
  ],
};

function assertEmailParts(body: string, lang: LetterLang, where: string) {
  let at = -1;
  for (const part of EMAIL_PARTS[lang]) {
    const found = body.indexOf(part);
    assert(found > at, `${where}: the email is missing or misorders: "${part}"`);
    at = found;
  }
}

/** A long job title must never cost the email a part of the template, whatever it does to the length. */
function checkLongTitleKeepsTemplate() {
  for (const lang of ["en", "fr"] as const) {
    const s = scenario("long title", lang, {
      roleTitle:
        "Stage - Hiver 2027 - Ingénierie du développement des systèmes de commande / Internship - Winter 2027 - Development Controls Engineer, Flight Systems and Digital Engine Services",
    });
    assertEmailParts(fillOutreachEmail(s.input).body, lang, `long title [${lang}]`);
  }
  console.log("  ok  a very long job title keeps every part of the email template");
}

function checkFactFilter() {
  const en = { lang: "en" as const };
  const fr = { lang: "fr" as const };
  assert(usableCompanyFact("Intact is hiring for Developer DevOPS.", en) === null, "placeholder fact rejected");
  assert(usableCompanyFact("Votre équipe recrute pour le poste.", fr) === null, "french placeholder rejected");
  assert(
    usableCompanyFact("Join us to shape the future of home-based health care View Open Positions Who We Are Join the team.", en) === null,
    "navigation text rejected",
  );
  assert(
    usableCompanyFact("We build ultra-low latency technology for the world's most demanding trading firms.", fr) === null,
    "english fact rejected in a french letter",
  );
  assert(
    usableCompanyFact("We build ultra-low latency technology for the world's most demanding trading firms.", en) === null,
    "the company speaking about itself (we, our) is not put in a letter",
  );
  assert(usableCompanyFact("Nous concevons des logiciels pour les équipes de chantier partout au Canada.", fr) === null, "same in French (nous)");
  assert(
    usableCompanyFact("Exegy builds low-latency market data technology for trading firms.", en) !== null,
    "a third-person statement about the company is fine",
  );
  assert(
    usableCompanyFact("Genetec builds unified security software used by cities and airports", en) ===
      "Genetec builds unified security software used by cities and airports.",
    "good fact accepted and given a period",
  );
  // Facts read off real company pages: only statements that open with the company's name are used.
  const named = (fact: string, company: string, lang: "en" | "fr" = "en") => usableCompanyFact(fact, { lang, companyName: company });
  assert(named("GIRO is a global leader in optimization software for public transit and postal operations.", "GIRO") !== null, "GIRO is ...");
  assert(named("Pomerleau, a Canadian construction company, is building the living environments of tomorrow.", "Pomerleau") !== null, "Pomerleau, a ..., is");
  assert(named("Exegy delivers real-time and historical market data for traders and financial institutions.", "Exegy") !== null, "Exegy delivers ...");
  assert(named("Lockheed Martin is an equal opportunity employer.", "Lockheed Martin") === null, "equal opportunity boilerplate");
  assert(named("Desjardins s’y classe au 1 er rang au Canada (rang par chiffre d'affaires).", "Desjardins", "fr") === null, "footnotes and dangling references");
  assert(
    named("BDO delivers assurance, tax and advisory services worldwide. Learn all about BDO here.", "BDO Canada") ===
      "BDO delivers assurance, tax and advisory services worldwide.",
    "only the first sentence is kept",
  );
  assert(named("I enjoy the teamwork and atmosphere at Bombardier.", "Bombardier") === null, "a testimonial is not a fact about the company");
  assert(named("Explore careers at Matrox Video and join a team of innovators and engineers.", "Matrox Graphics") === null, "an invitation to the reader");
  assert(named("Découvrez les services de livraison rapide et efficace d'Intelcom au Québec.", "Intelcom | Dragonfly", "fr") === null, "an invitation in French");
  assert(named("Global Company Information SAP innovations help thousands of customers worldwide.", "SAP") === null, "navigation text that mentions the company");
  assert(named("Ouvre une boîte de dialogue Se déconnecter des services en ligne de Desjardins.", "Desjardins", "fr") === null, "interface text");
  assert(usableCompanyFact("Short one", { lang: "en", verified: true }) === "Short one.", "typed fact trusted as written");
  assert(usableCompanyFact("", { lang: "en", verified: true }) === null, "empty fact rejected");
  console.log("  ok  company fact filter");
}

async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const outDir = outAt !== -1 ? args[outAt + 1] : null;
  if (outDir) await mkdir(outDir, { recursive: true });

  checkFactFilter();
  checkExampleEmail();
  checkFactPhrasing();
  checkLongTitleKeepsTemplate();
  checkLanguageDetection();
  checkFollowups();
  for (const s of scenarios) await checkScenario(s, outDir);

  if (args.includes("--show")) {
    for (const wanted of ["posting body, verified fact, named contact [en]", "french verified fact, french posting body [fr]", "devops title, placeholder fact [en]"]) {
      const s = scenarios.find((x) => x.name === wanted)!;
      const mail = fillOutreachEmail(s.input);
      console.log(`\n${"=".repeat(72)}\n${s.name}\n${"=".repeat(72)}`);
      console.log(`Subject: ${mail.subject}\n\n${mail.body}\n\n${"-".repeat(72)}\n`);
      console.log(fillLetter(s.input));
    }
  }
  console.log("\nletter-check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
