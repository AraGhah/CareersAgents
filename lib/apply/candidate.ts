// The candidate, as one object the planner and the answer engine read from. Every
// field comes from something Ara wrote or uploaded: the answer bank, the projects
// and their hand-written facts, and the parsed CV. Nothing here is inferred beyond
// splitting what is already written ("Montréal, QC" → city + province), and when a
// piece is missing it is null, so the planner sends the question to manual review.

import { pool } from "../db";
import { extractSkillsFromText, fallbackHaveSkills, type ProfileExperience, type ResumeRow } from "../profile";
import { projectFacts, type ProjectFacts } from "../project-facts";
import type { Answer, AnswerCategory, Project } from "../types";
import type { Lang } from "./types";

export type BankEntry = { category: AnswerCategory; en: string | null; fr: string | null };

export type CandidateProject = Project & { facts: ProjectFacts | null };

export type CandidateProfile = {
  lang: Lang;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  /** Province/state as written ("QC"). */
  region: string | null;
  regionName: string | null;
  country: string | null;
  links: { linkedin: string | null; github: string | null; portfolio: string | null; all: string[] };
  education: {
    school: string | null;
    program: string | null;
    credential: string | null;
    startYear: number | null;
    graduation: string | null;
    graduationYear: number | null;
    graduationMonth: number | null;
  };
  availableFrom: string | null;
  availableYear: number | null;
  availableMonth: number | null;
  locationRule: string | null;
  languagesText: string | null;
  languages: string[];
  skills: string[];
  projects: CandidateProject[];
  experience: ProfileExperience[];
  bank: Record<string, BankEntry>;
  resumeText: string | null;
};

const MONTHS: Record<string, number> = {
  january: 1, janvier: 1, jan: 1,
  february: 2, fevrier: 2, février: 2, feb: 2,
  march: 3, mars: 3, mar: 3,
  april: 4, avril: 4, apr: 4,
  may: 5, mai: 5,
  june: 6, juin: 6, jun: 6,
  july: 7, juillet: 7, jul: 7,
  august: 8, aout: 8, août: 8, aug: 8,
  september: 9, septembre: 9, sep: 9, sept: 9,
  october: 10, octobre: 10, oct: 10,
  november: 11, novembre: 11, nov: 11,
  december: 12, decembre: 12, décembre: 12, dec: 12,
};

export function parseMonthYear(text: string | null): { month: number | null; year: number | null } {
  if (!text) return { month: null, year: null };
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? NaN);
  const monthWord = text.toLowerCase().match(/[a-zéû]+/g)?.find((w) => w in MONTHS);
  return { month: monthWord ? MONTHS[monthWord] : null, year: Number.isFinite(year) ? year : null };
}

const PROVINCES: Record<string, { en: string; fr: string }> = {
  QC: { en: "Quebec", fr: "Québec" },
  ON: { en: "Ontario", fr: "Ontario" },
  BC: { en: "British Columbia", fr: "Colombie-Britannique" },
  AB: { en: "Alberta", fr: "Alberta" },
  MB: { en: "Manitoba", fr: "Manitoba" },
  NB: { en: "New Brunswick", fr: "Nouveau-Brunswick" },
  NS: { en: "Nova Scotia", fr: "Nouvelle-Écosse" },
  NL: { en: "Newfoundland and Labrador", fr: "Terre-Neuve-et-Labrador" },
  PE: { en: "Prince Edward Island", fr: "Île-du-Prince-Édouard" },
  SK: { en: "Saskatchewan", fr: "Saskatchewan" },
};

function pick(bank: Record<string, BankEntry>, key: string, lang: Lang): string | null {
  const row = bank[key];
  if (!row) return null;
  const text = lang === "fr" ? row.fr ?? row.en : row.en ?? row.fr;
  return text?.trim() || null;
}

/** "Third-year Computer Science Technology (DEC) at Collège de Bois-de-Boulogne, 2024 to now." */
function parseSchoolProgram(text: string | null) {
  if (!text) return { school: null, program: null, credential: null, startYear: null };
  const t = text.replace(/\s+/g, " ").trim();
  const credential = t.match(/\(([A-Z]{2,6})\)/)?.[1] ?? null;
  const school = t.match(/\b(?:at|au|à la|à l’|à l'|à)\s+(.+?)(?:,|\.|$)/)?.[1]?.trim() ?? null;
  const program =
    t
      .replace(/\(([A-Z]{2,6})\)/, "")
      .split(/\s+(?:at|au|à la|à l’|à l'|à)\s+/)[0]
      .replace(/^(?:first|second|third|fourth|final)[- ]year\s+/i, "")
      .replace(/^(?:premi[eè]re|deuxi[eè]me|troisi[eè]me|derni[eè]re) ann[ée]e (?:en|de)\s+/i, "")
      .trim() || null;
  const startYear = Number(t.match(/\b(20\d{2})\b/)?.[1] ?? NaN);
  return { school, program, credential, startYear: Number.isFinite(startYear) ? startYear : null };
}

function linkOf(all: string[], re: RegExp): string | null {
  return all.find((u) => re.test(u)) ?? null;
}

export function buildCandidateProfile(opts: {
  lang: Lang;
  answers: Answer[];
  projects: Project[];
  resume: ResumeRow | null;
}): CandidateProfile {
  const bank: Record<string, BankEntry> = {};
  for (const a of opts.answers) bank[a.key] = { category: a.category, en: a.answer_en, fr: a.answer_fr };
  const lang = opts.lang;
  // Only green answers are facts that can be pasted; yellow and red never feed a form field directly.
  const green = (key: string) => (bank[key]?.category === "green" ? pick(bank, key, lang) : null);

  const profile = opts.resume?.profile_json ?? null;
  const fullName = green("full_name") ?? profile?.fullName ?? null;
  const parts = fullName?.trim().split(/\s+/) ?? [];

  const cityRaw = green("city") ?? profile?.location ?? null;
  const [cityPart, regionPart] = (cityRaw ?? "").split(",").map((s) => s.trim());
  const region = regionPart ? regionPart.toUpperCase() : null;
  const province = region ? PROVINCES[region] : undefined;

  const linksRaw = green("links");
  const all = [...(linksRaw ?? "").matchAll(/https?:\/\/[^\s]+/gi)].map((m) => m[0].replace(/[.,;)]+$/, ""));

  const fromBank = parseSchoolProgram(green("school_program"));
  const cvEdu = profile?.education?.[0];
  const graduation = green("graduation_date");
  const grad = parseMonthYear(graduation);
  const availableFrom = green("available_from");
  const avail = parseMonthYear(availableFrom);

  const languagesText = green("languages");
  const languages = [
    ...(languagesText && /english|anglais/i.test(languagesText) ? ["English"] : []),
    ...(languagesText && /french|fran[cç]ais/i.test(languagesText) ? ["French"] : []),
  ];

  const projectTech = opts.projects.flatMap((p) => p.tech);
  const resumeSkills = profile?.skills ?? [];
  const skills = [...new Set([...resumeSkills, ...projectTech, ...(resumeSkills.length ? [] : fallbackHaveSkills())])];

  return {
    lang,
    fullName,
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    email: green("email") ?? profile?.email ?? null,
    phone: green("phone") ?? profile?.phone ?? null,
    city: cityPart || null,
    region,
    regionName: province ? province[lang] : null,
    country: province ? "Canada" : null,
    links: {
      linkedin: linkOf(all, /linkedin\.com/i),
      github: linkOf(all, /github\.com/i),
      portfolio: all.find((u) => !/linkedin\.com|github\.com/i.test(u)) ?? null,
      all,
    },
    education: {
      school: fromBank.school ?? cvEdu?.school ?? null,
      program: fromBank.program ?? cvEdu?.program ?? null,
      credential: fromBank.credential,
      startYear: fromBank.startYear,
      graduation,
      graduationYear: grad.year,
      graduationMonth: grad.month,
    },
    availableFrom,
    availableYear: avail.year,
    availableMonth: avail.month,
    locationRule: green("location_rule"),
    languagesText,
    languages,
    skills,
    projects: opts.projects.map((p) => ({ ...p, facts: projectFacts(p) })),
    experience: profile?.experience ?? [],
    bank,
    resumeText: opts.resume?.raw_text ?? null,
  };
}

export async function loadCandidateProfile(lang: Lang, resume: ResumeRow | null): Promise<CandidateProfile> {
  const [{ rows: answers }, { rows: projects }] = await Promise.all([
    pool.query<Answer>(`SELECT id, key, category, answer_en, answer_fr, updated_at FROM answers`),
    pool.query<Project>(`SELECT id, name, summary, tech, url, highlight_for FROM projects ORDER BY name`),
  ]);
  return buildCandidateProfile({ lang, answers, projects, resume });
}

/** True when the candidate's own material names this skill (CV, projects' tech, or CV text). */
export function candidateHasSkill(candidate: CandidateProfile, skill: string): boolean {
  const s = skill.toLowerCase();
  if (candidate.skills.some((k) => k.toLowerCase() === s)) return true;
  if (candidate.resumeText && extractSkillsFromText(candidate.resumeText).some((k) => k.toLowerCase() === s)) return true;
  return false;
}
