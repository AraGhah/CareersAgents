// A CV made for one posting (the idea of ApplyKit and ApplyPilot's tailoring stage), with one rule above all: it holds
// nothing the real CV does not. What changes is the order and the emphasis:
//   - the skills the posting asks for come first, then the rest, all taken from the CV's own list
//   - the projects closest to the posting, best first (at most three), with their own summaries and tech
//   - the experience most relevant to the posting first, each with its own bullets
//   - the opening summary: the model may reword the CV's own summary toward the role, and the rewording is kept only if
//     every fact in it is found in the candidate's material (checkGrounding); otherwise the CV's summary is used as is
// The model chooses *which* items and in what order, by name; anything it names that is not in the CV is ignored. With
// no API key the order comes from the posting's own words. The PDF is written next to the application's cover letter.
// It goes out instead of the uploaded CV only with CV_TAILORED=true; otherwise it is there to look at and download.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildCorpus, checkGrounding } from "./apply/answers/grounding";
import { loadCandidateProfile, type CandidateProfile } from "./apply/candidate";
import { norm } from "./apply/text";
import { createMessage, pickModel, tokenLimit } from "./claude";
import { pool } from "./db";
import { detectInternshipCategories } from "./internship-category";
import { detectLetterLang, type LetterLang } from "./letter";
import { drawable, wrap } from "./letter-pdf";
import type { ProfileExperience, ResumeProfile } from "./profile";
import { resolveResumeForJob } from "./resumes";
import { safeDeskPath } from "./safe-path";
import type { ApplicationDetail } from "./types";

export function tailoredCvEnabled(): boolean {
  return process.env.CV_TAILORED?.trim().toLowerCase() === "true";
}

type Item = { name: string; tech: string[]; summary: string | null };
export type TailoredPlan = { summary: string | null; skills: string[]; projects: Item[]; experience: ProfileExperience[]; tailoredBy: "model" | "keywords" };

const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 1));

/** How many of the posting's words an item shares (skills are matched as a whole word). */
function relevance(text: string, posting: string): number {
  const p = words(posting);
  return [...words(text)].filter((w) => p.has(w)).length;
}

/** The order from the posting's own words: no model needed. */
export function keywordPlan(profile: ResumeProfile, candidate: CandidateProfile, posting: string): TailoredPlan {
  const p = ` ${norm(posting)} `;
  const skills = [...new Set([...profile.skills, ...candidate.skills])];
  const asked = skills.filter((s) => p.includes(` ${norm(s)} `));
  const rest = skills.filter((s) => !asked.includes(s));
  const projects = [...profile.projects]
    .map((pr) => ({ pr, score: relevance(`${pr.name} ${pr.tech.join(" ")} ${pr.summary ?? ""}`, posting) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ pr }) => ({ name: pr.name, tech: pr.tech, summary: pr.summary }));
  const experience = [...profile.experience].sort(
    (a, b) => relevance(`${b.title} ${b.bullets.join(" ")}`, posting) - relevance(`${a.title} ${a.bullets.join(" ")}`, posting),
  );
  return { summary: profile.summary, skills: [...asked, ...rest], projects, experience, tailoredBy: "keywords" };
}

const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["skills", "projects", "experience", "summary"],
  properties: {
    skills: { type: "array", items: { type: "string" }, description: "Skill names copied from the list, most relevant first" },
    projects: { type: "array", items: { type: "string" }, description: "Up to 3 project names copied from the list, best first" },
    experience: { type: "array", items: { type: "string" }, description: "Experience titles copied from the list, most relevant first" },
    summary: { type: "string", description: "2 sentences: the CV summary reworded toward this role, with no fact that is not in the material" },
  },
} as const;

/** The model's choice of order, held to the CV: names not in it are dropped, anything left out is appended after. */
async function modelPlan(profile: ResumeProfile, candidate: CandidateProfile, app: ApplicationDetail, lang: LetterLang, client: Pick<Anthropic, "messages">): Promise<TailoredPlan | null> {
  const fallback = keywordPlan(profile, candidate, `${app.title} ${app.description ?? ""}`);
  const pick = pickModel("easy", process.env.ANTHROPIC_CV_MODEL);
  let out: { skills: string[]; projects: string[]; experience: string[]; summary: string };
  try {
    const response = await createMessage(client as Anthropic, pick, {
      max_tokens: tokenLimit(900, pick.tier),
      system:
        "You order a candidate's own CV items for one job posting. Copy names exactly from the lists; never add a skill, project or job that is not listed. The summary rewords the given summary toward the role, in the CV's language, and adds no fact.",
      messages: [
        {
          role: "user",
          content: [
            `POSTING: ${app.title} at ${app.company_name}\n${(app.description ?? "").slice(0, 6000)}`,
            `CV LANGUAGE: ${lang}`,
            `SUMMARY: ${profile.summary ?? ""}`,
            `SKILLS: ${fallback.skills.join(" | ")}`,
            `PROJECTS: ${profile.projects.map((p) => `${p.name} (${p.tech.join(", ")}): ${p.summary ?? ""}`).join(" || ")}`,
            `EXPERIENCE: ${profile.experience.map((e) => `${e.title}${e.organization ? ` at ${e.organization}` : ""}: ${e.bullets.join("; ")}`).join(" || ")}`,
          ].join("\n\n"),
        },
      ],
      output_config: { format: { type: "json_schema", schema: PICK_SCHEMA as unknown as Record<string, unknown> } },
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    if (!text) return null;
    out = JSON.parse(text);
  } catch {
    return null;
  }

  const byName = <T>(list: T[], name: (t: T) => string, chosen: string[]) => {
    const picked = chosen.map((c) => list.find((t) => norm(name(t)) === norm(c))).filter((t): t is T => !!t);
    return [...new Set([...picked, ...list])];
  };
  const skills = byName(fallback.skills, (s) => s, out.skills ?? []);
  const projects = byName(profile.projects, (p) => p.name, out.projects ?? []).slice(0, 3).map((p) => ({ name: p.name, tech: p.tech, summary: p.summary }));
  const experience = byName(profile.experience, (e) => e.title, out.experience ?? []);

  // The reworded summary is kept only when every fact in it is in the candidate's material.
  let summary = profile.summary;
  if (out.summary?.trim()) {
    const corpus = buildCorpus({
      candidate,
      job: { companyName: app.company_name, title: app.title, description: app.description, location: app.location },
      companyNotes: [],
      samples: profile.summary ? [profile.summary] : [],
    });
    if (checkGrounding(out.summary, corpus).unverified.length === 0) summary = out.summary.trim();
  }
  return { summary, skills, projects, experience, tailoredBy: "model" };
}

// ---------------------------------------------------------------------------
// The PDF
// ---------------------------------------------------------------------------

const PAGE = { width: 612, height: 792 };
const M = { x: 54, top: 54, bottom: 50 };
const INK = rgb(0.09, 0.13, 0.2);
const MUTED = rgb(0.36, 0.41, 0.47);
const RULE = rgb(0.8, 0.83, 0.87);

const HEADINGS: Record<LetterLang, Record<string, string>> = {
  en: { summary: "Summary", skills: "Skills", projects: "Projects", experience: "Experience", education: "Education", languages: "Languages" },
  fr: { summary: "Profil", skills: "Compétences", projects: "Projets", experience: "Expérience", education: "Formation", languages: "Langues" },
};

export async function renderCvPdf(opts: { candidate: CandidateProfile; profile: ResumeProfile; plan: TailoredPlan; lang: LetterLang }): Promise<{ bytes: Uint8Array; pages: number }> {
  const { candidate: c, profile, plan, lang } = opts;
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - M.x * 2;
  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - M.top;

  const room = (lead: number) => {
    if (y - lead < M.bottom) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - M.top;
    }
  };
  const text = (t: string, font: PDFFont, size: number, color = INK, x = M.x, maxWidth = width) => {
    for (const line of wrap(t, font, size, maxWidth)) {
      room(size * 1.35);
      y -= size * 1.35;
      page.drawText(line, { x, y, size, font, color });
    }
  };
  const heading = (key: string) => {
    room(28);
    y -= 10;
    text(HEADINGS[lang][key].toUpperCase(), bold, 10, INK);
    y -= 3;
    page.drawLine({ start: { x: M.x, y }, end: { x: PAGE.width - M.x, y }, thickness: 0.6, color: RULE });
    y -= 2;
  };

  text(drawable(c.fullName ?? profile.fullName ?? "", bold), bold, 18);
  const contact = [c.email ?? profile.email, c.phone ?? profile.phone, [c.city, c.region].filter(Boolean).join(", ") || profile.location, c.links.linkedin, c.links.github, c.links.portfolio]
    .filter(Boolean)
    .join("  ·  ");
  text(contact, regular, 9, MUTED);

  if (plan.summary) {
    heading("summary");
    text(plan.summary, regular, 10);
  }
  if (plan.skills.length) {
    heading("skills");
    text(plan.skills.join(", "), regular, 10);
  }
  if (plan.projects.length) {
    heading("projects");
    for (const p of plan.projects) {
      text(`${p.name}${p.tech.length ? ` — ${p.tech.join(", ")}` : ""}`, bold, 10);
      if (p.summary) text(p.summary, regular, 9.5, INK, M.x + 10, width - 10);
      y -= 3;
    }
  }
  if (plan.experience.length) {
    heading("experience");
    for (const e of plan.experience) {
      text([e.title, e.organization].filter(Boolean).join(" — ") + (e.years ? `   (${e.years})` : ""), bold, 10);
      for (const b of e.bullets) text(`• ${b}`, regular, 9.5, INK, M.x + 10, width - 10);
      y -= 3;
    }
  }
  if (profile.education.length) {
    heading("education");
    for (const ed of profile.education) text([ed.program, ed.school].filter(Boolean).join(" — ") + (ed.years ? `   (${ed.years})` : ""), regular, 10);
  }
  if (profile.languages.length || c.languagesText) {
    heading("languages");
    text(c.languagesText ?? profile.languages.join(", "), regular, 10);
  }
  return { bytes: await doc.save(), pages: doc.getPageCount() };
}

// ---------------------------------------------------------------------------
// One application
// ---------------------------------------------------------------------------

/** The folder the application's letter lives in, or a new one named like it. */
function folderFor(app: ApplicationDetail): string {
  const letterDir = safeDeskPath(app.cover_letter_path) ? path.dirname(app.cover_letter_path!) : null;
  if (letterDir) return letterDir;
  const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return path.join("applications", `${slug(app.company_name)}-${slug(app.title)}-${app.id.slice(0, 8)}`);
}

export type TailoredCv = { path: string; pages: number; plan: TailoredPlan };

/** Builds the tailored CV for an application and records its path. Null when no analysed CV is active. */
export async function buildTailoredCv(app: ApplicationDetail, opts: { client?: Pick<Anthropic, "messages"> } = {}): Promise<TailoredCv | null> {
  const lang = detectLetterLang(app.title, app.description);
  const resume = await resolveResumeForJob(lang, detectInternshipCategories(app.title, app.description));
  const profile = resume?.profile_json;
  if (!resume || !profile) return null;
  const candidate = await loadCandidateProfile(lang, resume);
  const posting = `${app.title} ${app.description ?? ""}`;
  const client = opts.client ?? (process.env.ANTHROPIC_API_KEY?.trim() ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null);
  const plan = (client ? await modelPlan(profile, candidate, app, lang, client) : null) ?? keywordPlan(profile, candidate, posting);
  const pdf = await renderCvPdf({ candidate, profile, plan, lang: profile.sourceLanguage === "fr" ? "fr" : "en" });

  const dir = folderFor(app);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `cv-tailored.${profile.sourceLanguage === "fr" ? "fr" : "en"}.pdf`);
  await writeFile(file, pdf.bytes);
  try {
    await pool.query(`UPDATE applications SET tailored_cv_path = $2 WHERE id = $1`, [app.id, file]);
  } catch (err) {
    // Before schema-v16.sql there is no column: the file is still there to download.
    if ((err as { code?: string }).code !== "42703") throw err;
  }
  return { path: file, pages: pdf.pages, plan };
}
