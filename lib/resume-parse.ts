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

function sectionBody(text: string, headings: RegExp): string {
  const lines = text.split(/\n/);
  let collecting = false;
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collecting) out.push("");
      continue;
    }
    if (headings.test(trimmed) && trimmed.length < 48) {
      collecting = true;
      continue;
    }
    if (collecting && /^[A-ZÀ-Ö][A-Za-zÀ-ÖØ-öø-ÿ &/]{2,40}$/.test(trimmed) && !headings.test(trimmed)) {
      // Likely next section heading
      if (out.length > 0) break;
    }
    if (collecting) out.push(trimmed);
  }
  return out.join("\n").trim();
}

function parseEducation(block: string): ResumeProfile["education"] {
  if (!block) return [];
  const chunks = block.split(/\n{2,}|\n(?=[A-ZÀ-Ö])/).map((c) => c.trim()).filter(Boolean);
  return chunks.slice(0, 4).map((chunk) => {
    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean);
    return {
      school: lines[0] ?? chunk.slice(0, 80),
      program: lines[1] ?? null,
      years: firstMatch(chunk, /\b(20\d{2}\s*[-–—to]+\s*20\d{2}|20\d{2})\b/),
    };
  });
}

function parseExperience(block: string): ResumeProfile["experience"] {
  if (!block) return [];
  const chunks = block.split(/\n(?=[A-ZÀ-Ö].{0,60}\n)/).map((c) => c.trim()).filter(Boolean);
  return chunks.slice(0, 6).map((chunk) => {
    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => /^[-•*]/.test(l) || /^[A-ZÀ-Ö].{40,}/.test(l)).slice(0, 4);
    return {
      title: lines[0] ?? "Role",
      organization: lines[1] && !/^[-•*]/.test(lines[1]) ? lines[1] : null,
      years: firstMatch(chunk, /\b(20\d{2}\s*[-–—to]+\s*(?:20\d{2}|[Pp]resent|[Aa]ctuel|now))\b/),
      bullets: bullets.map((b) => b.replace(/^[-•*]\s*/, "")),
    };
  });
}

function parseProjects(block: string, skills: string[]): ResumeProfile["projects"] {
  if (!block) return [];
  const chunks = block.split(/\n(?=[A-ZÀ-Ö])/).map((c) => c.trim()).filter(Boolean);
  return chunks.slice(0, 6).map((chunk) => {
    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const name = lines[0]?.replace(/^[-•*]\s*/, "") ?? "Project";
    const tech = extractSkillsFromText(chunk).filter((s) => skills.includes(s) || true).slice(0, 8);
    return {
      name: name.slice(0, 80),
      tech: [...new Set(tech)].slice(0, 6),
      summary: lines.slice(1).join(" ").slice(0, 280) || null,
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
    /(?:Montr[eé]al|Laval|Qu[eé]bec|Quebec|Canada)[^.\n]{0,40}/i,
  );

  const firstLines = text.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  profile.fullName =
    firstLines.find((l) => /^[A-ZÀ-Ö][a-zà-ö]+(?:\s+[A-ZÀ-Ö][a-zà-ö'’-]+){1,3}$/.test(l)) ??
    firstMatch(text, /Ara\s+Ghahramanyan/i) ??
    null;

  const skills = extractSkillsFromText(text);
  profile.skills = skills;
  profile.languages = detectSpokenLanguages(text);

  const educationBlock = sectionBody(
    text,
    /^(education|formation|études|etudes|academic|scolarité)/i,
  );
  const experienceBlock = sectionBody(
    text,
    /^(experience|expérience|experiences|expériences|work experience|emploi|employment)/i,
  );
  const projectsBlock = sectionBody(
    text,
    /^(projects?|projets?|selected projects|réalisations)/i,
  );
  const summaryBlock =
    sectionBody(text, /^(summary|profil|profile|objective|objectif|à propos|about)/i) ||
    firstLines.slice(1, 5).join(" ");

  profile.education = parseEducation(educationBlock);
  profile.experience = parseExperience(experienceBlock);
  profile.projects = parseProjects(projectsBlock, skills);
  profile.summary = summaryBlock.slice(0, 600) || null;
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
