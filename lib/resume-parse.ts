import { emptyProfile, extractSkillsFromText, type ResumeLanguage, type ResumeProfile } from "./profile";

type PdfParseModule = {
  PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
    getText: () => Promise<{ text?: string } | string>;
    destroy?: () => Promise<void>;
  };
};

async function loadPdfParse(): Promise<PdfParseModule["PDFParse"]> {
  const mod = (await import("pdf-parse")) as PdfParseModule;
  if (typeof mod.PDFParse !== "function") {
    throw new Error("pdf-parse PDFParse class missing");
  }
  return mod.PDFParse;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const PDFParse = await loadPdfParse();
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = typeof result === "string" ? result : result.text ?? "";
    return text
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } finally {
    await parser.destroy?.().catch(() => undefined);
  }
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() || m?.[0]?.trim() || null;
}

type SectionKey =
  | "summary"
  | "education"
  | "experience"
  | "projects"
  | "volunteering"
  | "skills"
  | "certifications"
  | "other";

// Whole-line matches only (after accent/case folding): a partial match is how
// the "projects.vercel.app" portfolio URL used to be mistaken for a heading.
const HEADINGS: Record<string, SectionKey> = {
  profile: "summary",
  profil: "summary",
  summary: "summary",
  objective: "summary",
  objectif: "summary",
  about: "summary",
  "a propos": "summary",
  education: "education",
  formation: "education",
  "work experience": "experience",
  experience: "experience",
  experiences: "experience",
  "experience de travail": "experience",
  "experience professionnelle": "experience",
  emploi: "experience",
  employment: "experience",
  projects: "projects",
  projets: "projects",
  "selected projects": "projects",
  realisations: "projects",
  volunteering: "volunteering",
  "volunteer experience": "volunteering",
  benevolat: "volunteering",
  "technical skills": "skills",
  skills: "skills",
  "competences techniques": "skills",
  competences: "skills",
  certifications: "certifications",
  languages: "other",
  langues: "other",
  interests: "other",
  "centres d'interet": "other",
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const BULLET_RE = /^[-•▪●◦‣∙·*-]\s*/;

function normalizeLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(l) && !/^\d{1,2}$/.test(l))
    .map((l) => (BULLET_RE.test(l) ? `• ${l.replace(BULLET_RE, "")}` : l));
}

function splitSections(lines: string[]): Map<SectionKey, string[]> {
  const sections = new Map<SectionKey, string[]>();
  let current: SectionKey | null = null;
  for (const line of lines) {
    const key = HEADINGS[fold(line)];
    if (key) {
      current = key;
      if (!sections.has(key)) sections.set(key, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
  }
  return sections;
}

// A trailing date on an entry header: "2026", "Sept. 2025 - Nov. 2025",
// "Summer 2024 and Summer 2025", "Été 2024 et été 2025", "2024 - Present".
const PERIOD_WORD =
  "(?:jan|feb|f[eé]v|mar|apr|avr|may|mai|jun|juin|jul|juil|aug|ao[uû]t|sep|oct|nov|dec|d[eé]c|summer|winter|fall|autumn|spring|[eé]t[eé]|hiver|automne|printemps)[a-zéû]*\\.?\\s+";
const TRAILING_DATE_RE = new RegExp(
  `\\s((?:${PERIOD_WORD})?20\\d{2}(?:\\s*(?:[-–—]|to|and|et|à)\\s*(?:(?:${PERIOD_WORD})?20\\d{2}|present|présent|actuel|now|today))?)\\s*$`,
  "i",
);

type Entry = { header: string; years: string | null; meta: string[]; bullets: string[] };

function parseEntries(lines: string[]): Entry[] {
  const entries: Entry[] = [];
  for (const line of lines) {
    if (line.startsWith("• ")) {
      const current = entries.at(-1);
      if (current) current.bullets.push(line.slice(2));
      continue;
    }
    const date = line.match(TRAILING_DATE_RE);
    if (date || entries.length === 0) {
      entries.push({
        header: (date ? line.slice(0, date.index) : line).trim(),
        years: date ? date[1].trim() : null,
        meta: [],
        bullets: [],
      });
      continue;
    }
    const current = entries.at(-1)!;
    if (current.bullets.length === 0) {
      current.meta.push(line);
    } else {
      // Wrapped continuation of the previous bullet. A line ending in "-"
      // mid-word ("AI-" / "controlled") rejoins without a space.
      const last = current.bullets.length - 1;
      const joiner = /[A-Za-zÀ-ÿ]-$/.test(current.bullets[last]) ? "" : " ";
      current.bullets[last] += `${joiner}${line}`;
    }
  }
  return entries;
}

/** "Busser: Restaurant Grillade Nostos" -> ["Busser", "Restaurant Grillade Nostos"] */
function splitHeader(header: string): [string, string | null] {
  const cleaned = header
    .replace(/\s*-?\s*https?:\/\/\S+/g, "")
    .replace(/\s+-\s*$/, "")
    .trim();
  const idx = cleaned.indexOf(":");
  if (idx <= 0) return [cleaned, null];
  return [cleaned.slice(0, idx).trim(), cleaned.slice(idx + 1).trim() || null];
}

function parseEducation(lines: string[]): ResumeProfile["education"] {
  return parseEntries(lines)
    .slice(0, 4)
    .map((e) => {
      const [school, program] = splitHeader(e.header);
      return { school, program, years: e.years };
    });
}

function parseExperience(lines: string[]): ResumeProfile["experience"] {
  return parseEntries(lines)
    .slice(0, 6)
    .map((e) => {
      const [title, organization] = splitHeader(e.header);
      return { title, organization, years: e.years, bullets: e.bullets.slice(0, 4) };
    });
}

function parseProjects(lines: string[]): ResumeProfile["projects"] {
  return parseEntries(lines)
    .slice(0, 6)
    .map((e) => {
      const techLine = e.meta[0] ?? "";
      const listed = techLine
        .split("|")[0]
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t && t.length <= 30);
      const tech = listed.length > 0 ? listed : extractSkillsFromText(e.bullets.join(" "));
      return {
        name: splitHeader(e.header).join(": ").replace(/: $/, "").slice(0, 100),
        tech: [...new Set(tech)].slice(0, 8),
        summary: e.bullets[0]?.slice(0, 280) ?? null,
      };
    });
}

function estimateYears(text: string, experience: ResumeProfile["experience"]): number {
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    if (span >= 0 && span <= 8) return Math.min(span, 3);
  }
  return Math.min(experience.length, 2);
}

function detectSpokenLanguages(text: string): string[] {
  const out: string[] = [];
  if (/english|anglais/i.test(text)) out.push("English");
  if (/french|fran[cç]ais/i.test(text)) out.push("French");
  if (/armenian|arm[eé]nien/i.test(text)) out.push("Armenian");
  if (/russian|russe/i.test(text)) out.push("Russian");
  return out;
}

/** Deterministic profile from resume text — no LLM required. */
export function analyzeResumeText(rawText: string, lang: ResumeLanguage): ResumeProfile {
  const text = rawText.replace(/\u0000/g, "").trim();
  const profile = emptyProfile(lang);
  if (!text) return profile;

  profile.email = firstMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  profile.phone = firstMatch(text, /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  profile.location = firstMatch(
    text,
    /(?:Montr[eé]al|Laval|Qu[eé]bec|Quebec|Canada)[^|.\n@]{0,30}/i,
  );

  const firstLines = text.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  profile.fullName =
    firstLines.find((l) => /^[A-ZÀ-Ö][a-zà-ö]+(?:\s+[A-ZÀ-Ö][a-zà-ö'’-]+){1,3}$/.test(l)) ??
    firstMatch(text, /Ara\s+Ghahramanyan/i) ??
    null;

  const skills = extractSkillsFromText(text);
  profile.skills = skills;
  profile.languages = detectSpokenLanguages(text);

  const sections = splitSections(normalizeLines(text));
  const summaryText = (sections.get("summary") ?? []).join(" ").replace(/\s+/g, " ").trim();

  profile.education = parseEducation(sections.get("education") ?? []);
  profile.experience = parseExperience(sections.get("experience") ?? []);
  profile.projects = parseProjects(sections.get("projects") ?? []);
  profile.summary = summaryText.slice(0, 600) || null;
  profile.estimatedYearsExperience = estimateYears(text, profile.experience);
  profile.analyzedAt = new Date().toISOString();
  profile.sourceLanguage = lang;

  if (/full[- ]?stack/i.test(text)) {
    profile.targetRoles = ["Full-Stack Developer Intern", "Software Developer Intern"];
  } else if (/backend|back[- ]end/i.test(text)) {
    profile.targetRoles = ["Backend Developer Intern", "Software Developer Intern"];
  }

  return profile;
}

export async function analyzePdfBuffer(buffer: Buffer, lang: ResumeLanguage): Promise<{
  text: string;
  profile: ResumeProfile;
}> {
  const text = await extractPdfText(buffer);
  if (!text || text.length < 40) {
    throw new Error("Could not extract enough text from this PDF. Try a text-based resume.");
  }
  return { text, profile: analyzeResumeText(text, lang) };
}
