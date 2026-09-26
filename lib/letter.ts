import { detectRoleFocuses, type RoleCategory } from "./category";
import { companyTokens, normalize } from "./contact-parse";
import { projectFacts, projectFactsText, type ProjectFacts } from "./project-facts";
import { findSkills } from "./score";
import type { Answer, AnswerCategory, Project } from "./types";

export type LetterLang = "en" | "fr";

export type LetterInput = {
  fullName: string;
  companyName: string;
  /** The posting's exact job title. It is used verbatim, never shortened or translated. */
  roleTitle: string;
  companyFact: string;
  companyFactSource: string;
  /** True when a person typed the fact and its source, so the scraper-junk filters are skipped. */
  companyFactVerified?: boolean;
  /** Posting body, when there is one. Used to find the skills and the focus of the role. */
  postingDescription?: string | null;
  projects: Project[];
  availability: string;
  locationRule: string;
  links: string[];
  lang: LetterLang;
  /** Optional contact block used for the letter header and email signature. */
  email?: string;
  phone?: string;
  city?: string;
  /** Hiring contact's name, when one has been verified. Falls back to a generic greeting. */
  recruiterName?: string | null;
};

export type NounFlag = {
  word: string;
  reason: string;
};

/**
 * The application guide asks for "about 150–200 words". The template is never cut down to fit, so a
 * very long job title (the exact title is always used) can add a few dozen words; up to 230 is accepted.
 */
export const EMAIL_WORD_RANGE = { min: 120, max: 230 } as const;

const STOP = new Set(
  `
  a an the and or but if then else when while for of to in on at by from with without
  into onto over under about after before between among against during through
  is are was were be been being have has had do does did will would can could
  should may might must shall this that these those it its i me my we our you your
  he she they them their as so not no yes also just only more most other such
  than too very own same both each few many much some any all one what who which where how
  je tu il elle on nous vous ils elles le la les un une des du de mon ma mes ton ta tes
  son sa ses notre nos votre vos leur leurs et ou mais donc car ni que qui dont où
  pour avec sans dans sur sous chez par plus moins très bien déjà aussi comme
  eté été etre être avoir fait faire suis es est sommes êtes sont
  `.split(/\s+/).filter(Boolean),
);

// Word matching that understands accents: the regex word boundary treats "é" as a non-letter,
// so "équipe" and "développeur" were never matched reliably.
const FR_POSTING_WORDS =
  /(?<![\p{L}])(?:stage|stagiaires?|hiver|été|développeu(?:r|se|rs|ses)|développement|ingénieu(?:r|re|rs|res)|ingénierie|logiciels?|équipe|poste|emploi|données|analytique|conception|numériques?|étudiant(?:e|s|es)?|alternance|coopératif|programmeu(?:r|se)|programmation|informatique|secteur|universitaire|réalité|apprentissage|automatique|mois|gestion|spécialiste|responsable|ia|pour|avec|dans|des|les|une)(?![\p{L}])/giu;
const EN_POSTING_WORDS =
  /(?<![\p{L}])(?:the|and|with|for|intern|internship|winter|software|developer|engineer|team)(?![\p{L}])/giu;

/**
 * "fr" when the posting reads as French, else "en". A bilingual title with as many English
 * markers as French ones stays English, as does anything with no clear French wording.
 */
export function detectLetterLang(title: string, description: string | null): LetterLang {
  const text = `${title}\n${description ?? ""}`;
  const fr = (text.match(FR_POSTING_WORDS) ?? []).length;
  const en = (text.match(EN_POSTING_WORDS) ?? []).length;
  return fr >= 2 && fr > en ? "fr" : "en";
}

export function parseLinks(raw: string | null): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0].replace(/[.,;)]+$/, ""));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatLetterDate(lang: LetterLang): string {
  const now = new Date();
  return now.toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function splitContactLinks(links: string[]): { portfolio: string; github: string; linkedin: string } {
  const github = links.find((u) => /github\.com/i.test(u)) ?? "";
  const linkedin = links.find((u) => /linkedin\.com/i.test(u)) ?? "";
  const portfolio = links.find((u) => u !== github && u !== linkedin) ?? "";
  return { portfolio, github, linkedin };
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
}

/**
 * The letter header, laid out like the template: name, then city | phone | email,
 * then LinkedIn | GitHub, then the portfolio, with the protocol dropped.
 */
function headerLines(input: LetterInput): string[] {
  const { linkedin, github, portfolio } = splitContactLinks(input.links);
  const reach = [input.city, input.phone, input.email].filter(Boolean).join(" | ");
  const profiles = [linkedin, github].filter(Boolean).map(displayUrl).join(" | ");
  return [input.fullName, reach, profiles, portfolio ? displayUrl(portfolio) : ""].filter(Boolean);
}

/** "A, B, and C" in English (with the serial comma, as in Ara's example email); "A, B et C" in French. */
function joinList(items: string[], lang: LetterLang): string {
  if (items.length <= 1) return items[0] ?? "";
  const last = items[items.length - 1];
  if (lang === "fr") return `${items.slice(0, -1).join(", ")} et ${last}`;
  if (items.length === 2) return `${items[0]} and ${last}`;
  return `${items.slice(0, -1).join(", ")}, and ${last}`;
}

/** Long or compound titles read badly as a bare noun phrase mid-sentence, so those get quoted. */
function titleRef(title: string, lang: LetterLang): string {
  if (!/[-–/,:(]/.test(title)) return title;
  return lang === "fr" ? `« ${title} »` : `“${title}”`;
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0] ?? text;
}

function withPeriod(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// ---------------------------------------------------------------------------
// What the posting is about
// ---------------------------------------------------------------------------

/**
 * How a kind of role is named in a sentence. `en` follows "involves" / "focus on";
 * `enWork` follows "the ... described in the posting"; `enSkill` sits in front of
 * "skills". The French forms take their article or preposition with them.
 */
type Focus = { en: string; enWork: string; enSkill: string; frDef: string; frTravaux: string; frEn: string };

function focus(en: string, frNoun: string, over: Partial<Focus> = {}): Focus {
  return {
    en,
    enWork: en,
    enSkill: en,
    frDef: `le ${frNoun}`,
    frTravaux: `travaux de ${frNoun}`,
    frEn: `en ${frNoun}`,
    ...over,
  };
}

const FOCUS: Record<RoleCategory | "software", Focus> = {
  backend: focus("backend development", "développement backend"),
  fullstack: focus("full-stack development", "développement full stack"),
  cloud: focus("cloud technologies", "développement infonuagique", {
    enWork: "cloud and infrastructure work",
    enSkill: "cloud development",
    frDef: "les technologies infonuagiques",
    frTravaux: "travaux d’infonuagique et d’infrastructure",
  }),
  // Kept general on purpose: nothing in the project list says which ML techniques were used.
  ai: focus("AI-focused software development", "développement logiciel axé sur l’IA", {
    frTravaux: "travaux de développement logiciel axés sur l’IA",
  }),
  gamedev: focus("game development", "développement de jeux"),
  software: focus("software development", "développement logiciel"),
};

/**
 * Two or three skills to name in the "match" paragraph. Skills the posting names
 * and the applicant actually has come first; only when that gives fewer than two
 * are they topped up from the projects' own tech, and then the letter stops
 * claiming the posting names them all.
 */
function matchedSkills(input: LetterInput, projects: Project[]): { list: string[]; fromPosting: string[] } {
  const text = `${input.roleTitle}\n${input.postingDescription ?? ""}`;
  // Skills the letter's own projects used come first, so a backend posting that also
  // mentions React leads with what the proof project actually shows.
  const rank = (skill: string): number => {
    const needle = skill.toLowerCase();
    for (const [i, project] of projects.slice(0, 2).entries()) {
      const at = project.tech.findIndex((t) => {
        const tech = t.toLowerCase();
        return tech === needle || (needle.length >= 3 && tech.includes(needle));
      });
      if (at !== -1) return i * 100 + at;
    }
    return 1000;
  };
  const fromPosting = findSkills(text)
    .filter((s) => s.have)
    .map((s) => s.name)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 3);
  if (fromPosting.length >= 2) return { list: fromPosting, fromPosting };

  // Topped up from what the projects actually used, in the order Ara lists them. The email
  // names up to four; the letter uses the first three.
  const list = [...fromPosting];
  for (const project of projects.slice(0, 2)) {
    for (const skill of projectFacts(project)?.skills ?? project.tech) {
      if (list.length >= 4) break;
      if (!list.some((s) => s.toLowerCase() === skill.toLowerCase())) list.push(skill);
    }
  }
  return { list, fromPosting };
}

// ---------------------------------------------------------------------------
// The company fact
// ---------------------------------------------------------------------------

/** Placeholder text the pipeline writes when research found nothing, and site navigation scraped as "about" text. */
const FALLBACK_FACT =
  /\bis hiring for\b|\brecrute pour\b|\bpublishes this internship\b|^your team is hiring|^votre équipe recrute/i;
const SITE_CHROME =
  /view open positions|who we are|join (?:us|the team)|learn more|contact us|sign (?:in|up)|cookies?|privacy|subscribe|skip to|menu|voir les postes|qui sommes-nous|nous joindre|en savoir plus/i;

const EN_WORDS = new Set("the and of to in for with that is are we our you your it its as at by from this".split(" "));
const FR_WORDS = new Set(
  "le la les des du de et en pour avec que qui est sont nous notre nos vous votre il elle son sa ses au aux une un sur dans par".split(
    " ",
  ),
);

function languageOf(text: string): LetterLang | null {
  const words = text.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
  let en = 0;
  let fr = 0;
  for (const word of words) {
    if (EN_WORDS.has(word)) en += 1;
    if (FR_WORDS.has(word)) fr += 1;
  }
  if (en === fr) return null;
  return en > fr ? "en" : "fr";
}

/**
 * The company fact, cleaned up, when it is fit to put in front of a hiring
 * manager as "a verified detail about the company"; null when it is not. A fact
 * a person typed with a source is trusted. One that came out of the research
 * step is not: it is often the "X is hiring for Y" placeholder, page navigation,
 * or in the wrong language for the letter.
 */
export function usableCompanyFact(
  fact: string,
  opts: { lang: LetterLang; verified?: boolean; companyName?: string },
): string | null {
  let clean = fact.replace(/\s+/g, " ").trim();
  if (!clean || FALLBACK_FACT.test(clean)) return null;

  if (!opts.verified) {
    // One sentence: a page description often runs on into a slogan or a link, and only the first is judged.
    clean = firstSentence(clean);
    if (SITE_CHROME.test(clean)) return null;
    // Scraped from the company's own site, "we build X" is the company speaking about itself. Dropped into
    // "I am interested in X because ..." it would put words in the wrong mouth, so only statements about the
    // company in the third person get through.
    if (/\b(?:we|we're|we've|our|ours|us|nous|notre|nos|vous|votre|vos|your|you|you're)\b/i.test(clean)) return null;
    // Not a testimonial ("I enjoy the atmosphere at ..."), and not an invitation to the reader ("Explore
    // careers at ...", "Découvrez ..."): those are page copy, not a fact about the company.
    if (/(?:^|[\s"“(])I(?:['’](?:m|ve|ll|d))?(?=[\s.,;:!?)]|$)|\b(?:my|me|myself)\b/.test(clean)) return null;
    if (/\b(?:je|moi|mon|ma|mes)\b|\bj['’]/i.test(clean)) return null;
    if (/^(?:explore|discover|learn|join|find|see|read|meet|get|start|apply|visit|welcome|open|ouvre|ouvrez|d[eé]couvrez|rejoignez|explorez|apprenez|trouvez|bienvenue)\b/i.test(clean)) return null;
    // Legal and HR boilerplate ("an equal opportunity employer"), footnotes in brackets, and lines that point
    // at something else on the page ("Learn all about us here", "s'y classe") are not a reason to apply.
    if (/equal opportunity|opportunit[eé] [eé]gale|[eé]galit[eé] (?:en emploi|des chances)|affirmative action|diversity|diversit[eé]|inclusi|accommodat|terms of|conditions d.utilisation|©|all rights|we value/i.test(clean)) return null;
    if (/[()]/.test(clean) || /\b(?:here|there|this page|below|above|ici|ci-dessous|ci-dessus)\b|\bs['’]y\b/i.test(clean)) return null;
    // It has to be about the company: the sentence opens with its name ("GIRO is ...", "Pomerleau, a Canadian
    // construction company, is ..."), which also rules out navigation text that merely mentions it.
    if (opts.companyName) {
      const primary = companyTokens(opts.companyName)[0];
      if (!primary || !normalize(clean).replace(/^[^a-z0-9]+/, "").startsWith(primary)) return null;
    }
    const tokens = clean.split(" ");
    const capitalized = tokens.filter((t) => /^[A-ZÀ-Ý]/.test(t)).length;
    if (tokens.length >= 6 && capitalized / tokens.length > 0.3) return null;
    const detected = languageOf(clean);
    if (detected && detected !== opts.lang) return null;
    if (clean.length < 30 || clean.length > 240) return null;
  }
  return withPeriod(clean);
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

type Ctx = {
  lang: LetterLang;
  /** The primary focus, used wherever the letter names a single area. */
  focus: Focus;
  /** Up to two focus areas the posting names (never empty), in the order a sentence lists them. */
  focuses: Focus[];
  focusKeys: Array<RoleCategory | "software">;
  /** The project that gets the "proof" paragraph. */
  proof: Project | undefined;
  proofFacts: ProjectFacts | null;
  /** The project that backs the "match" paragraph: a second one when there is one, so the two do not repeat. */
  match: Project | undefined;
  matchFacts: ProjectFacts | null;
  skills: { list: string[]; fromPosting: string[] };
  /** Skills the posting names that are not in the applicant's list: what the internship would teach. */
  growing: string[];
  availability: string;
};

function buildContext(input: LetterInput): Ctx {
  const [proof, second] = input.projects;
  const match = second ?? proof;
  const detected = detectRoleFocuses(input.roleTitle, input.postingDescription ?? null);
  const focusKeys: Ctx["focusKeys"] = detected.length ? detected : ["software"];
  return {
    lang: input.lang,
    focus: FOCUS[focusKeys[0]],
    focuses: focusKeys.map((key) => FOCUS[key]),
    focusKeys,
    proof,
    proofFacts: projectFacts(proof),
    match,
    matchFacts: projectFacts(match),
    skills: matchedSkills(input, input.projects),
    growing: findSkills(`${input.roleTitle}\n${input.postingDescription ?? ""}`)
      .filter((skill) => !skill.have)
      .map((skill) => skill.name)
      .slice(0, 2),
    // French months are lower-case mid-sentence; the answer bank stores "Janvier 2027".
    availability: input.lang === "fr" ? input.availability.toLowerCase() : input.availability,
  };
}

function techList(project: Project, lang: LetterLang, max = 3): string {
  return joinList(project.tech.slice(0, max), lang);
}

/** "Match" paragraph: 2–3 skills from the posting, tied to something actually done. */
function matchParagraph(ctx: Ctx): string {
  const { lang, skills, match, matchFacts, focus } = ctx;
  const named = joinList(skills.list.slice(0, 3), lang);
  const fromPostingOnly = skills.fromPosting.length >= 2;

  if (lang === "fr") {
    const tail = fromPostingOnly ? ", des technologies que l’offre mentionne aussi" : "";
    const experience = `Par mes cours et mes projets personnels, j’ai acquis de l’expérience avec ${named}${tail}.`;
    if (matchFacts) {
      return `${experience} En particulier, ${matchFacts.action.fr}, ce qui m’a permis de développer ${matchFacts.skill.fr}.`;
    }
    if (match) {
      return `${experience} En particulier, j’ai travaillé avec ${techList(match, lang)} dans ${match.name}, ce qui m’a permis de développer des compétences pratiques ${focus.frEn}.`;
    }
    return experience;
  }

  const tail = fromPostingOnly ? ", technologies the posting also names" : "";
  const experience = `Through my coursework and personal projects, I have gained experience with ${named}${tail}.`;
  if (matchFacts) {
    return `${experience} In particular, ${matchFacts.action.en}, which has helped me develop ${matchFacts.skill.en}.`;
  }
  if (match) {
    return `${experience} In particular, I have worked with ${techList(match, lang)} in ${match.name}, which has helped me develop practical skills in ${focus.enSkill}.`;
  }
  return experience;
}

/** "Proof" paragraph: one project — the problem, what I built, the tools, an honest result and status. */
function proofParagraph(ctx: Ctx): string {
  const { lang, proof, proofFacts, focus } = ctx;

  if (lang === "fr") {
    const close = `Cette expérience m’aiderait à contribuer aux ${focus.frTravaux} décrits dans l’offre.`;
    if (proof && proofFacts) {
      return `Dans ${proof.name}, ${proofFacts.built.fr}. ${proofFacts.contribution.fr} ${proofFacts.outcome.fr} ${close}`;
    }
    if (proof) {
      return `Dans ${proof.name}, j’ai travaillé avec ${techList(proof, lang, 4)}. ${close}`;
    }
    return `Mes projets personnels et académiques couvrent le développement full stack, les systèmes backend et l’infrastructure infonuagique. ${close}`;
  }

  const close = `This experience would help me contribute to the ${focus.enWork} described in the posting.`;
  if (proof && proofFacts) {
    return `In ${proof.name}, ${proofFacts.built.en}. ${proofFacts.contribution.en} ${proofFacts.outcome.en} ${close}`;
  }
  if (proof) {
    return `In ${proof.name}, I worked with ${techList(proof, lang, 4)}. ${proof.summary} ${close}`;
  }
  return `My personal and academic projects span full-stack development, backend systems, and cloud infrastructure. ${close}`;
}

/** "Company fit" paragraph: a verified detail, then what I would bring and what I would learn. */
function fitParagraph(input: LetterInput, ctx: Ctx): string {
  const { lang, focus, proofFacts } = ctx;
  const fact = usableCompanyFact(input.companyFact, {
    lang,
    verified: input.companyFactVerified,
    companyName: input.companyName,
  });
  const company = input.companyName;
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "Genetec builds X" reads better after "because" as "it builds X". A fact that opens any other way
  // ("Pomerleau, a Canadian company, is ..." or "Genetec's platform ...") would repeat the name, so
  // it is quoted after a colon instead.
  const opensWithVerb = fact !== null && new RegExp(`^${escaped}\\s+(?=[a-zà-ÿ])`).test(fact);
  const asClause = (subject: string) =>
    (opensWithVerb ? fact!.replace(new RegExp(`^${escaped}`), subject) : fact!).replace(/\.$/, "");

  if (lang === "fr") {
    const interest = fact
      ? opensWithVerb
        ? `Je m’intéresse à ${company} parce que ${asClause("l’entreprise")}.`
        : `Je m’intéresse à ${company} pour une raison précise : ${fact}`
      : `Je m’intéresse à ${company} parce que ce stage me permettrait de mettre en pratique ce que j’ai construit jusqu’ici au sein d’une équipe d’ingénierie professionnelle.`;
    const strength = proofFacts?.strength.fr ?? "ma curiosité et ma capacité à apprendre de nouvelles technologies";
    return `${interest} J’apporterais à l’équipe ${strength}, tout en continuant à développer mes compétences ${focus.frEn}.`;
  }

  const interest = fact
    ? opensWithVerb
      ? `I am interested in ${company} because ${asClause("it")}.`
      : `I am interested in ${company} for one specific reason: ${fact}`
    : `I am interested in ${company} because this internship would let me apply what I have built so far on a professional engineering team.`;
  const strength = proofFacts?.strength.en ?? "curiosity and a habit of learning new technologies quickly";
  return `${interest} I would bring to the team ${strength}, while continuing to develop my skills in ${focus.enSkill}.`;
}

// ---------------------------------------------------------------------------
// Application email
// ---------------------------------------------------------------------------

/**
 * The sign-off every email ends with: closing line, a blank line, the name, the phone
 * number, then LinkedIn, GitHub and Portfolio on their own labelled lines.
 */
export function signatureLines(p: {
  fullName: string;
  phone?: string;
  links: string[];
  lang: LetterLang;
}): string[] {
  const { linkedin, github, portfolio } = splitContactLinks(p.links);
  const colon = p.lang === "fr" ? " :" : ":";
  return [
    p.lang === "fr" ? "Cordialement," : "Best regards,",
    "",
    p.fullName,
    ...[
      p.phone ?? "",
      linkedin ? `LinkedIn${colon} ${linkedin}` : "",
      github ? `GitHub${colon} ${github}` : "",
      portfolio ? `Portfolio${colon} ${portfolio}` : "",
    ].filter(Boolean),
  ];
}

/**
 * The application email. Every one follows the same template, written by Ara:
 * who I am and when I am available; the exact role and why it interests me; my
 * hands-on experience and one main project; the attachments and links; an invitation
 * to talk; the signature. Subject: "Application - [exact role title] - [name]".
 */
export function fillOutreachEmail(input: LetterInput): { subject: string; body: string; wordCount: number } {
  const ctx = buildContext(input);
  const { lang, focuses, focusKeys, proof, proofFacts, skills, growing } = ctx;
  const recruiter = input.recruiterName?.trim() || null;
  const title = input.roleTitle;
  const company = input.companyName;

  // With two focus areas, the first (backend, full-stack, game development) is something I have done
  // and goes in the experience list; the second (cloud) is what the internship would help me grow.
  const experienceFocus =
    focuses.length === 2 && ["backend", "fullstack", "gamedev"].includes(focusKeys[0]) ? focuses[0] : null;
  const growFocus = experienceFocus ? focuses[1] : focuses[0];

  const interest = joinList(focuses.map((f) => (lang === "fr" ? f.frDef : f.en)), lang);
  const experience = joinList(
    [...skills.list, ...(experienceFocus ? [lang === "fr" ? experienceFocus.frDef : experienceFocus.enSkill] : [])],
    lang,
  );
  // "my Java and cloud development skills" / "mes compétences en Java et en développement infonuagique"
  const growth =
    lang === "fr"
      ? joinList([...growing, growFocus.frEn.replace(/^en /, "")].map((item) => `en ${item}`), lang)
      : joinList([...growing, growFocus.enSkill], lang);

  const enabled = proofFacts
    ? proofFacts.enabled[lang]
    : proof
      ? lang === "fr"
        ? `travailler avec ${techList(proof, lang)}`
        : `work with ${techList(proof, lang)}`
      : null;

  const signOff = signatureLines({ fullName: input.fullName, phone: input.phone, links: input.links, lang });

  const compose = (): string => {
    if (lang === "fr") {
      const project =
        proof && enabled
          ? `L’un de mes principaux projets, ${proof.name}, m’a permis de ${enabled}, et je serais enthousiaste à l’idée de mettre cette expérience à profit`
          : "Je serais enthousiaste à l’idée de mettre cette expérience à profit";
      return [
        recruiter ? `Bonjour ${recruiter},` : "Bonjour,",
        "",
        `Je m’appelle ${input.fullName} et je suis en troisième année de Techniques de l’informatique au Collège de Bois-de-Boulogne, à la recherche d’un stage en développement logiciel à partir de ${ctx.availability}.`,
        "",
        `Je vous écris au sujet du poste de ${title}. L’occasion m’intéresse particulièrement en raison de son accent sur ${interest}.`,
        "",
        `Grâce à mes projets récents, j’ai acquis une expérience concrète avec ${experience}. ${project} tout en continuant à développer mes compétences ${growth} chez ${company}.`,
        "",
        "J’ai joint mon CV et ma lettre de motivation. Vous trouverez aussi des exemples de mon travail sur mon GitHub et mon portfolio, ci-dessous.",
        "",
        `Je serais disponible pour discuter de mon parcours et de la façon dont je pourrais contribuer à ce stage ou à d’autres occasions pertinentes à venir chez ${company}.`,
        "",
        ...signOff,
      ].join("\n");
    }
    const project =
      proof && enabled
        ? `One of my main projects, ${proof.name}, allowed me to ${enabled}, and I would be excited to bring that experience`
        : "I would be excited to bring that experience";
    return [
      recruiter ? `Dear ${recruiter},` : "Dear Hiring Team,",
      "",
      `My name is ${input.fullName}, and I am a third-year Computer Science Technology student at Collège de Bois-de-Boulogne seeking a software development internship starting in ${ctx.availability}.`,
      "",
      `I am reaching out regarding the ${title} position. The opportunity particularly interests me because of its focus on ${interest}.`,
      "",
      `Through my recent projects, I have gained hands-on experience with ${experience}. ${project} while continuing to develop my ${growth} skills at ${company}.`,
      "",
      "I have attached my CV and cover letter for your consideration. You can also find examples of my work through my GitHub and portfolio below.",
      "",
      `I would be glad to discuss my background and how I could contribute to this internship or other relevant upcoming opportunities at ${company}.`,
      "",
      ...signOff,
    ].join("\n");
  };

  // The template is never shortened: every email has every part. A very long job title can push it past
  // the guide's "about 150-200 words"; the checklist points that out instead.
  const body = compose();

  return {
    subject: `${lang === "fr" ? "Candidature" : "Application"} - ${input.roleTitle} - ${input.fullName}`,
    body,
    wordCount: countWords(body),
  };
}

/**
 * A follow-up on an application already sent. It is a different message from the
 * application email, so it does not repeat the introduction, but it is written in the
 * same voice and ends with the same signature block.
 */
export function fillFollowupEmail(input: {
  fullName: string;
  companyName: string;
  roleTitle: string;
  phone?: string;
  links: string[];
  lang: LetterLang;
  recruiterName?: string | null;
  /** Days since the application was sent, when known. */
  daysSinceSubmit?: number;
}): { subject: string; body: string; wordCount: number } {
  const { lang, roleTitle, companyName } = input;
  const recruiter = input.recruiterName?.trim() || null;
  const days = input.daysSinceSubmit;
  const signOff = signatureLines({ fullName: input.fullName, phone: input.phone, links: input.links, lang });

  const lines =
    lang === "fr"
      ? [
          recruiter ? `Bonjour ${recruiter},` : "Bonjour,",
          "",
          `Je me permets de relancer ma candidature au poste de ${roleTitle} chez ${companyName}, envoyée ${
            days ? `il y a environ ${days} jours` : "récemment"
          }. Le poste continue de m’intéresser, et je serais disponible pour préciser mon parcours, mes projets ou mes disponibilités si cela peut vous être utile.`,
          "",
          ...signOff,
        ]
      : [
          recruiter ? `Dear ${recruiter},` : "Dear Hiring Team,",
          "",
          `I am following up on my application for the ${roleTitle} position at ${companyName}, which I sent ${
            days ? `about ${days} days ago` : "recently"
          }. I remain very interested in the opportunity and would be glad to share more about my background, my projects, or my availability if that would be helpful.`,
          "",
          ...signOff,
        ];

  const body = lines.join("\n");
  return {
    subject: `${lang === "fr" ? "Relance" : "Following up"} - ${roleTitle} - ${input.fullName}`,
    body,
    wordCount: countWords(body),
  };
}

// ---------------------------------------------------------------------------
// Cover letter: six parts
// ---------------------------------------------------------------------------

/**
 * The cover letter, in the template's order and wording: header, opening (exact
 * position, availability, reason), match (2–3 skills tied to something done),
 * proof (one project with its real status), company fit, closing.
 */
export function fillLetter(input: LetterInput): string {
  const ctx = buildContext(input);
  const { lang, focus, proof } = ctx;
  const recruiter = input.recruiterName?.trim() || null;
  const title = titleRef(input.roleTitle, lang);

  const opening =
    lang === "fr"
      ? `Je suis en troisième année de Techniques de l’informatique au Collège de Bois-de-Boulogne et je cherche un stage à partir de ${ctx.availability}. Je pose ma candidature au poste de ${title} parce que l’offre porte sur ${focus.frDef}, un domaine que j’ai pratiqué dans mes projets personnels${proof ? ` comme ${proof.name}` : ""} et que je souhaite exercer au sein d’une équipe professionnelle.`
      : `I am a third-year Computer Science Technology student at Collège de Bois-de-Boulogne seeking an internship starting in ${ctx.availability}. I am applying for the ${title} position because the role involves ${focus.en}, which I have practised in personal projects${proof ? ` such as ${proof.name}` : ""} and want to do on a professional team.`;

  const closing =
    lang === "fr"
      ? "Je souhaiterais avoir l’occasion de discuter de la façon dont mon expérience pourrait contribuer à votre équipe. Merci de l’attention portée à ma candidature."
      : "I would welcome the opportunity to discuss how my experience could contribute to your team. Thank you for considering my application.";

  const lines = [...headerLines(input), "", formatLetterDate(lang), "", input.companyName];
  if (recruiter) lines.push(recruiter);
  lines.push(
    "",
    lang === "fr" ? (recruiter ? `Bonjour ${recruiter},` : "Madame, Monsieur,") : recruiter ? `Dear ${recruiter},` : "Dear Hiring Team,",
    "",
    opening,
    "",
    matchParagraph(ctx),
    "",
    proofParagraph(ctx),
    "",
    fitParagraph(input, ctx),
    "",
    closing,
    "",
    lang === "fr" ? "Cordialement," : "Sincerely,",
    "",
    input.fullName,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Proper-noun check
// ---------------------------------------------------------------------------

function tokenizeProper(text: string): string[] {
  const words = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9+.#/-]*/g) ?? [];
  return words
    .map((w) => w.replace(/[.,;:!?]+$/g, ""))
    .filter((w) => {
      if (!w) return false;
      if (STOP.has(w.toLowerCase())) return false;
      if (/^\d/.test(w)) return false;
      if (w.length <= 2 && w !== "C#") return false;
      return /[A-ZÀ-Ö]/.test(w[0]) || /[#.]/.test(w) || /\d/.test(w);
    });
}

export function allowedTokens(input: LetterInput): Set<string> {
  const parts = [
    input.fullName,
    input.companyName,
    input.roleTitle,
    input.companyFact,
    input.companyFactSource,
    input.postingDescription ?? "",
    input.availability,
    input.locationRule,
    input.email ?? "",
    input.phone ?? "",
    input.city ?? "",
    input.recruiterName ?? "",
    formatLetterDate(input.lang),
    ...input.links,
    ...input.projects.flatMap((p) => [
      p.name,
      p.summary,
      ...(p.tech ?? []),
      p.url ?? "",
      ...projectFactsText(p),
    ]),
  ];
  const set = new Set<string>();
  for (const part of parts) {
    for (const token of tokenizeProper(part)) {
      set.add(token.toLowerCase());
    }
  }
  // Common letter framing that is not a "fact about me".
  for (const word of [
    "Hello",
    "Best",
    "regards",
    "Madame",
    "Monsieur",
    "Objet",
    "Candidature",
    "Cordialement",
    "Re",
    "Links",
    "Liens",
    "source",
    "January",
    "Janvier",
    "June",
    "Juin",
    "Montréal",
    "Montreal",
    "Laval",
    "Canada",
    "Winter",
    "Hiver",
    "Dear",
    "Sincerely",
    "Hiring",
    "Team",
    "Bonjour",
    "Collège",
    "Bois-de-Boulogne",
    "Computer",
    "Science",
    "Technology",
    "Techniques",
    "Informatique",
    "REST",
    "APIs",
    "GitHub",
    "LinkedIn",
    "Thank",
    "Merci",
    "CV",
    "Cette",
    "Ce",
    "Sur",
    "Mon",
    "Ma",
    "AI-focused",
  ]) {
    set.add(word.toLowerCase());
  }
  return set;
}

export function flagUnknownNouns(letter: string, input: LetterInput): NounFlag[] {
  const allowed = allowedTokens(input);
  const flags: NounFlag[] = [];
  const seen = new Set<string>();
  for (const word of tokenizeProper(letter)) {
    const key = word.toLowerCase();
    if (allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    flags.push({
      word,
      reason: "not present in the letter input (name, fact, projects, answers, links)",
    });
  }
  return flags;
}

export type MatchedAnswer = {
  key: string;
  category: AnswerCategory;
  text: string | null;
  mode: "verbatim" | "reword" | "manual";
};

const KEY_ALIASES: Array<{ key: string; pattern: RegExp }> = [
  { key: "full_name", pattern: /\b(full\s*name|legal\s*name|nom\s*complet)\b/i },
  { key: "email", pattern: /\b(e-?mail|courriel)\b/i },
  { key: "phone", pattern: /\b(phone|telephone|téléphone|mobile)\b/i },
  { key: "links", pattern: /\b(portfolio|github|linkedin|website|site\s*web|links?)\b/i },
  { key: "school_program", pattern: /\b(school|program|degree|études|programme|diplôme|cégep|cegep)\b/i },
  { key: "graduation_date", pattern: /\b(graduat|diplôm|fin\s*d['’]études)\b/i },
  { key: "available_from", pattern: /\b(availab|disponible|start\s*date|date\s*de\s*début)\b/i },
  { key: "location_rule", pattern: /\b(location|relocat|où\s*trav|work\s*from|on-?site|remote|télétravail)\b/i },
  { key: "languages", pattern: /\b(language|langue|bilingual|bilingue|english|french|anglais|français)\b/i },
  { key: "why_backend", pattern: /\b(why\s*(backend|this\s*role)|pourquoi\s*(le\s*)?(backend|ce\s*poste))\b/i },
  { key: "why_this_company", pattern: /\b(why\s*(this\s*)?(company|us)|pourquoi\s*(cette\s*)?(entreprise|compagnie))\b/i },
  { key: "biggest_project", pattern: /\b(project|projet|proud|réalisation)\b/i },
  { key: "strengths", pattern: /\b(strength|force|compétence)\b/i },
  { key: "weakness", pattern: /\b(weakness|faiblesse|amélioration)\b/i },
  { key: "teamwork_example", pattern: /\b(team|équipe|collaboration|équipe)\b/i },
  { key: "career_goal", pattern: /\b(career|goal|objectif|ambition)\b/i },
  { key: "work_authorization", pattern: /\b(work\s*auth|legally\s*author|permis\s*de\s*travail|autorisation)\b/i },
  { key: "salary_expectation", pattern: /\b(salary|compensation|rémunération|salaire)\b/i },
  { key: "criminal_record_check", pattern: /\b(criminal|background\s*check|casier)\b/i },
  { key: "security_clearance", pattern: /\b(security\s*clearance|cote\s*de\s*sécurité)\b/i },
  { key: "self_identification", pattern: /\b(self[- ]identif|equity|diversity|équité|diversité)\b/i },
];

export function matchAnswer(
  question: string,
  answers: Answer[],
  lang: LetterLang,
): MatchedAnswer | null {
  const alias = KEY_ALIASES.find((a) => a.pattern.test(question));
  if (!alias) return null;
  const row = answers.find((a) => a.key === alias.key);
  if (!row) return null;
  const text = lang === "fr" ? row.answer_fr ?? row.answer_en : row.answer_en ?? row.answer_fr;
  if (row.category === "green") {
    return { key: row.key, category: row.category, text, mode: "verbatim" };
  }
  if (row.category === "yellow") {
    return { key: row.key, category: row.category, text, mode: "reword" };
  }
  return { key: row.key, category: row.category, text, mode: "manual" };
}

export function bankForForm(answers: Answer[], lang: LetterLang): MatchedAnswer[] {
  return answers.map((row) => {
    const text = lang === "fr" ? row.answer_fr ?? row.answer_en : row.answer_en ?? row.answer_fr;
    if (row.category === "green") {
      return { key: row.key, category: row.category, text, mode: "verbatim" as const };
    }
    if (row.category === "yellow") {
      return { key: row.key, category: row.category, text, mode: "reword" as const };
    }
    return { key: row.key, category: row.category, text, mode: "manual" as const };
  });
}
