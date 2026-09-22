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
  than too very own same both each few many much some any all
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

function projectBlurb(project: Project, lang: LetterLang): string {
  if (lang === "fr") {
    const tech = project.tech.slice(0, 4).join(", ");
    return `${project.name} (${tech}) : ${project.summary}`;
  }
  const tech = project.tech.slice(0, 4).join(", ");
  return `${project.name} (${tech}): ${project.summary}`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function trimToWordLimit(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/** Short outreach email (Agent 5), capped at 120 words in the body. */
export function fillOutreachEmail(input: LetterInput): { subject: string; body: string; wordCount: number } {
  const leadProject = input.projects[0];
  const primaryLink = input.links[0] ?? "";

  if (input.lang === "fr") {
    const hook = `${input.companyFact}`.replace(/\s+/g, " ").trim();
    const projectLine = leadProject
      ? `Récemment, j'ai travaillé sur ${leadProject.name} (${leadProject.tech.slice(0, 3).join(", ")}).`
      : "";
    const bodyParts = [
      "Bonjour,",
      "",
      `Je vous écris au sujet du poste ${input.roleTitle} chez ${input.companyName}. ${hook}`,
      projectLine,
      `Je suis disponible à partir de ${input.availability}.`,
      primaryLink ? `Portfolio et liens : ${primaryLink}` : "",
      "",
      "Merci de votre temps,",
      input.fullName,
    ].filter(Boolean);
    let body = bodyParts.join("\n");
    body = trimToWordLimit(body, 120);
    return {
      subject: `Candidature - ${input.roleTitle}`,
      body,
      wordCount: countWords(body),
    };
  }

  const hook = `${input.companyFact}`.replace(/\s+/g, " ").trim();
  const projectLine = leadProject
    ? `Recently I shipped ${leadProject.name} (${leadProject.tech.slice(0, 3).join(", ")}).`
    : "";
  const bodyParts = [
    "Hello,",
    "",
    `I am reaching out about the ${input.roleTitle} role at ${input.companyName}. ${hook}`,
    projectLine,
    `I am available from ${input.availability}.`,
    primaryLink ? `Links: ${primaryLink}` : "",
    "",
    "Thank you,",
    input.fullName,
  ].filter(Boolean);
  let body = bodyParts.join("\n");
  body = trimToWordLimit(body, 120);
  return {
    subject: `Application — ${input.roleTitle}`,
    body,
    wordCount: countWords(body),
  };
}

export function fillLetter(input: LetterInput): string {
  const projects = input.projects.map((p) => projectBlurb(p, input.lang)).join("\n\n");
  const links = input.links.join("\n");

  if (input.lang === "fr") {
    return [
      `${input.fullName}`,
      "",
      `Objet : Candidature — ${input.roleTitle}`,
      "",
      `Madame, Monsieur,`,
      "",
      `Je postule au poste de ${input.roleTitle} chez ${input.companyName}. ${input.companyFact} (source : ${input.companyFactSource}).`,
      "",
      `Je suis disponible à partir de ${input.availability}. ${input.locationRule}.`,
      "",
      `Voici le travail que je mettrais en avant pour ce poste :`,
      "",
      projects || "(aucun projet sélectionné)",
      "",
      `Liens :`,
      links || "(aucun)",
      "",
      `Je reste disponible pour en discuter.`,
      "",
      `Cordialement,`,
      input.fullName,
    ].join("\n");
  }

  return [
    `${input.fullName}`,
    "",
    `Re: ${input.roleTitle}`,
    "",
    `Hello,`,
    "",
    `I am applying for the ${input.roleTitle} role at ${input.companyName}. ${input.companyFact} (source: ${input.companyFactSource}).`,
    "",
    `I am available from ${input.availability}. ${input.locationRule}.`,
    "",
    `The work I would put forward for this posting:`,
    "",
    projects || "(no projects selected)",
    "",
    `Links:`,
    links || "(none)",
    "",
    `I am happy to talk through any of this.`,
    "",
    `Best regards,`,
    input.fullName,
  ].join("\n");
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
