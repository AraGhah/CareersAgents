import type { Answer, AnswerCategory, Project } from "./types";

export type LetterLang = "en" | "fr";

export type LetterInput = {
  fullName: string;
  companyName: string;
  roleTitle: string;
  companyFact: string;
  companyFactSource: string;
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

export function detectLetterLang(title: string, description: string | null): LetterLang {
  const text = `${title}\n${description ?? ""}`;
  const frHits = (text.match(/\b(le|la|les|des|une|pour|avec|stage|stagiaire|hiver|développeur|développeuse|ingénieur|logiciel|équipe)\b/gi) ?? [])
    .length;
  const enHits = (text.match(/\b(the|and|with|for|intern|internship|winter|software|developer|engineer|team)\b/gi) ?? [])
    .length;
  if (frHits > enHits + 2) return "fr";
  return "en";
}

export function parseLinks(raw: string | null): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0].replace(/[.,;)]+$/, ""));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function trimToWordLimit(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
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

function contactLinkLine(links: string[]): string {
  const { linkedin, github, portfolio } = splitContactLinks(links);
  return [linkedin, github, portfolio].filter(Boolean).join(" | ");
}

function topTechnologies(projects: Project[], max = 4): string {
  const seen = new Set<string>();
  const out: string[] = [];
  outer: for (const project of projects) {
    for (const tech of project.tech) {
      if (seen.has(tech)) continue;
      seen.add(tech);
      out.push(tech);
      if (out.length >= max) break outer;
    }
  }
  return out.join(", ");
}

/** Prose paragraph(s) covering the top one or two projects, for the cover letter body. */
function letterProjectParagraph(projects: Project[], lang: LetterLang): string {
  const [p1, p2] = projects;
  if (!p1) {
    return lang === "fr"
      ? "Mes projets personnels et académiques couvrent le développement full-stack, les systèmes backend et l’infrastructure infonuagique; je serais heureux d’en présenter des exemples précis en entrevue."
      : "My personal and academic projects span full-stack development, backend systems, and cloud infrastructure; I would be glad to walk through specific examples in an interview.";
  }
  const tech1 = p1.tech.slice(0, 4).join(", ");
  if (lang === "fr") {
    let text = `Un projet particulièrement pertinent pour cette opportunité est ${p1.name} : ${p1.summary} Je l’ai construit avec ${tech1}.`;
    if (p2) {
      const tech2 = p2.tech.slice(0, 4).join(", ");
      text += ` J’ai aussi développé ${p2.name}, où j’ai travaillé avec ${tech2}. Ces expériences ont renforcé ma capacité à apprendre de nouvelles technologies, à résoudre des problèmes techniques de façon autonome et à livrer des solutions complètes.`;
    }
    return text;
  }
  let text = `One project that is particularly relevant to this opportunity is ${p1.name}: ${p1.summary} I built it with ${tech1}.`;
  if (p2) {
    const tech2 = p2.tech.slice(0, 4).join(", ");
    text += ` I also developed ${p2.name}, where I worked with ${tech2}. These experiences strengthened my ability to learn unfamiliar technologies, solve technical problems independently, and build complete solutions.`;
  }
  return text;
}

/** Outreach / application email. Capped generously so a long company fact can't run away with it. */
export function fillOutreachEmail(input: LetterInput): { subject: string; body: string; wordCount: number } {
  const leadProject = input.projects[0];
  const topTech = topTechnologies(input.projects, 3);
  const fact = `${input.companyFact}`.replace(/\s+/g, " ").trim();
  const recruiter = input.recruiterName?.trim() || null;
  const signOffLinks = contactLinkLine(input.links);

  if (input.lang === "fr") {
    const greeting = recruiter ? `Bonjour ${recruiter},` : "Bonjour,";
    const workLine = leadProject
      ? `J’ai surtout travaillé avec ${topTech || "plusieurs technologies modernes"} dernièrement, notamment sur ${leadProject.name}, et j’aimerais mettre cette expérience au service de votre équipe.`
      : `J’ai surtout travaillé avec ${topTech || "le développement full-stack et les systèmes backend"} dernièrement, et j’aimerais mettre cette expérience au service de votre équipe.`;

    const lines = [
      greeting,
      "",
      `Je m’appelle ${input.fullName}, étudiant en troisième année de Techniques de l’informatique au Collège de Bois-de-Boulogne, à la recherche d’un stage en développement logiciel à partir de ${input.availability}.`,
      "",
      fact,
      "",
      `C’est précisément ce qui m’a donné envie de postuler ici. ${workLine}`,
      "",
      `Mon CV et ma lettre de motivation sont joints. Mon GitHub et mon portfolio sont liés ci-dessous si vous voulez voir d’autres projets.`,
      "",
      `Je serais heureux d’échanger sur ce poste ou sur d’autres opportunités à venir.`,
      "",
      "Cordialement,",
      input.fullName,
    ];
    if (input.phone) lines.push(input.phone);
    if (signOffLinks) lines.push(signOffLinks);

    const body = trimToWordLimit(lines.join("\n"), 260);
    return {
      subject: `Candidature - ${input.roleTitle}`,
      body,
      wordCount: countWords(body),
    };
  }

  const greeting = recruiter ? `Dear ${recruiter},` : "Dear Hiring Team,";
  const workLine = leadProject
    ? `Most of my recent work has been in ${topTech || "several modern technologies"}, including ${leadProject.name}, and I'd like to bring that experience to your team.`
    : `Most of my recent work has been in ${topTech || "full-stack development and backend systems"}, and I'd like to bring that experience to your team.`;

  const lines = [
    greeting,
    "",
    `I'm ${input.fullName}, a third-year Computer Science Technology student at Collège de Bois-de-Boulogne, looking for a software development internship starting ${input.availability}.`,
    "",
    fact,
    "",
    `That's specifically what drew me to apply here. ${workLine}`,
    "",
    `My CV and cover letter are attached. My GitHub and portfolio are linked below if you'd like to see more of what I've built.`,
    "",
    `I'd welcome the chance to talk about this role or any other upcoming opportunities.`,
    "",
    "Best regards,",
    input.fullName,
  ];
  if (input.phone) lines.push(input.phone);
  if (signOffLinks) lines.push(signOffLinks);

  const body = trimToWordLimit(lines.join("\n"), 260);
  return {
    subject: `Application - ${input.roleTitle}`,
    body,
    wordCount: countWords(body),
  };
}

export function fillLetter(input: LetterInput): string {
  const date = formatLetterDate(input.lang);
  const contactLine = [input.phone, input.email].filter(Boolean).join(" | ");
  const linksLine = contactLinkLine(input.links);
  const recruiter = input.recruiterName?.trim() || null;
  const topTech = topTechnologies(input.projects);
  const projectParagraph = letterProjectParagraph(input.projects, input.lang);

  const header = [input.fullName, input.city || "", contactLine, linksLine].filter(Boolean);

  if (input.lang === "fr") {
    const lines = [...header, "", date, ""];
    if (recruiter) lines.push(recruiter);
    lines.push(input.companyName, "");
    lines.push(recruiter ? `Bonjour ${recruiter},` : "Madame, Monsieur,");
    lines.push(
      "",
      `Je suis étudiant en troisième année de Techniques de l’informatique au Collège de Bois-de-Boulogne, actuellement à la recherche d’un stage en développement logiciel à partir de ${input.availability}. Je postule au poste de ${input.roleTitle} chez ${input.companyName}. ${input.companyFact} Ce type de travail correspond directement à mon intérêt pour ${topTech || "le développement logiciel"}.`,
      "",
      `Par mes études et mes projets personnels, j’ai développé une expérience pratique avec ${topTech || "plusieurs technologies modernes"}. J’ai travaillé sur des applications full-stack, des systèmes backend, des API REST, des bases de données, de l’infrastructure infonuagique et de l’automatisation logicielle. Ces projets m’ont permis d’aller au-delà des exercices de cours et de suivre le processus complet de développement, de la conception à la mise en production, en passant par le débogage et les tests.`,
      "",
      projectParagraph,
      "",
      `Ce qui m’intéresse particulièrement dans un stage chez ${input.companyName} est l’occasion de travailler sur des logiciels réels, en production, au sein d’une équipe d’ingénierie. Mon expérience avec ${topTech || "le développement logiciel"} me permettrait de contribuer à votre équipe tout en continuant à apprendre auprès de développeurs expérimentés et à acquérir une expérience professionnelle en développement logiciel.`,
      "",
      `Je serais heureux de discuter de la façon dont mon parcours, mes projets et mes compétences techniques pourraient contribuer à ${input.companyName}. Mon CV est joint, et d’autres exemples de mon travail sont disponibles sur mon GitHub et mon portfolio.`,
      "",
      `Merci de votre temps et de votre considération.`,
      "",
      `Cordialement,`,
      "",
      input.fullName,
    );
    return lines.join("\n");
  }

  const lines = [...header, "", date, ""];
  if (recruiter) lines.push(recruiter);
  lines.push(input.companyName, "");
  lines.push(recruiter ? `Dear ${recruiter},` : "Dear Hiring Team,");
  lines.push(
    "",
    `I am a third-year Computer Science Technology student at Collège de Bois-de-Boulogne, currently seeking a software development internship starting in ${input.availability}. I am writing to apply for the ${input.roleTitle} position at ${input.companyName}. ${input.companyFact} That kind of work closely matches my interest in ${topTech || "software development"}.`,
    "",
    `Through my studies and personal projects, I have developed practical experience with ${topTech || "several modern technologies"}. I have worked on full-stack applications, backend systems, REST APIs, databases, cloud infrastructure, and software automation. These projects have allowed me to go beyond classroom exercises and work through the complete development process, from designing and implementing features to debugging, testing, and deploying applications.`,
    "",
    projectParagraph,
    "",
    `What particularly interests me about an internship at ${input.companyName} is the opportunity to work on real, production software as part of an engineering team. My background in ${topTech || "software development"} would allow me to contribute to your team while continuing to learn from experienced developers and gain professional software development experience.`,
    "",
    `I would appreciate the opportunity to discuss how my background, projects, and technical skills could contribute to ${input.companyName}. My CV is attached, and additional examples of my work are available through my GitHub and portfolio.`,
    "",
    `Thank you for your time and consideration.`,
    "",
    `Sincerely,`,
    "",
    input.fullName,
  );
  return lines.join("\n");
}

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
    input.availability,
    input.locationRule,
    input.email ?? "",
    input.phone ?? "",
    input.city ?? "",
    input.recruiterName ?? "",
    formatLetterDate(input.lang),
    ...input.links,
    ...input.projects.flatMap((p) => [p.name, p.summary, ...(p.tech ?? []), p.url ?? ""]),
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
