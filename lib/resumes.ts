import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db";
import { analyzePdfBuffer } from "./resume-parse";
import type { ResumeLanguage, ResumeProfile, ResumeRow } from "./profile";
import { fallbackHaveSkills } from "./profile";
import type { InternshipCategory } from "./internship-category";

export const RESUMES_DIR = path.join("resumes");

const RESUME_COLUMNS = `id, language, category, label, filename, storage_path, mime_type, byte_size,
            is_active, uploaded_at, analyzed_at, raw_text, profile_json, analysis_error`;

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .slice(0, 80);
}

export async function listResumes(): Promise<ResumeRow[]> {
  const { rows } = await pool.query<ResumeRow>(
    `SELECT ${RESUME_COLUMNS}
       FROM resumes
      ORDER BY language, is_active DESC, uploaded_at DESC`,
  );
  return rows;
}

export async function getResume(id: string): Promise<ResumeRow | null> {
  const { rows } = await pool.query<ResumeRow>(
    `SELECT ${RESUME_COLUMNS}
       FROM resumes
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** The general (category-less) active resume for a language — the original,
 *  still-supported "one CV per language" shape. */
export async function getActiveResume(lang: ResumeLanguage): Promise<ResumeRow | null> {
  return getActiveResumeFor(lang, null);
}

/** The active resume for an exact (language, category) slot. category=null
 *  means the general resume, not "any category." */
export async function getActiveResumeFor(
  lang: ResumeLanguage,
  category: InternshipCategory | null,
): Promise<ResumeRow | null> {
  const { rows } = await pool.query<ResumeRow>(
    `SELECT ${RESUME_COLUMNS}
       FROM resumes
      WHERE language = $1 AND is_active = true AND category IS NOT DISTINCT FROM $2
      LIMIT 1`,
    [lang, category],
  );
  return rows[0] ?? null;
}

/** Every active resume for a language, any category — used to aggregate
 *  skills/profile data across however many category CVs are active. */
export async function getActiveResumesForLang(lang: ResumeLanguage): Promise<ResumeRow[]> {
  const { rows } = await pool.query<ResumeRow>(
    `SELECT ${RESUME_COLUMNS}
       FROM resumes
      WHERE language = $1 AND is_active = true
      ORDER BY category NULLS FIRST`,
    [lang],
  );
  return rows;
}

/**
 * Picks the CV for a job: category correctness first (never a Full-Stack CV
 * for a Back-End role if a better one is active), then posting language,
 * then the general CV as a last resort. `categories` should be ranked
 * most-specific-first (see detectInternshipCategories).
 */
export async function resolveResumeForJob(
  lang: ResumeLanguage,
  categories: InternshipCategory[] = [],
): Promise<ResumeRow | null> {
  const otherLang: ResumeLanguage = lang === "en" ? "fr" : "en";

  for (const category of categories) {
    const exact = await getActiveResumeFor(lang, category);
    if (exact) return exact;
  }
  for (const category of categories) {
    const crossLang = await getActiveResumeFor(otherLang, category);
    if (crossLang) return crossLang;
  }
  return (await getActiveResumeFor(lang, null)) ?? (await getActiveResumeFor(otherLang, null));
}

export async function getActiveSkills(): Promise<string[]> {
  const [en, fr] = await Promise.all([getActiveResumesForLang("en"), getActiveResumesForLang("fr")]);
  const fromProfiles = [...en, ...fr].flatMap(
    (r) => (r.profile_json?.skills as string[] | undefined) ?? [],
  );
  const unique = [...new Set(fromProfiles)];
  return unique.length > 0 ? unique : fallbackHaveSkills();
}

export async function getMergedActiveProfile(): Promise<ResumeProfile | null> {
  const [en, fr] = await Promise.all([getActiveResumesForLang("en"), getActiveResumesForLang("fr")]);
  const primary = en[0]?.profile_json ?? fr[0]?.profile_json ?? null;
  if (!primary) return null;
  const skills = await getActiveSkills();
  return { ...primary, skills };
}

async function persistAnalyzed(
  id: string,
  text: string,
  profile: ResumeProfile,
): Promise<ResumeRow> {
  const { rows } = await pool.query<ResumeRow>(
    `UPDATE resumes
        SET raw_text = $2,
            profile_json = $3::jsonb,
            analyzed_at = now(),
            analysis_error = NULL
      WHERE id = $1
      RETURNING ${RESUME_COLUMNS}`,
    [id, text, JSON.stringify(profile)],
  );
  if (!rows[0]) throw new Error(`resume not found: ${id}`);
  return rows[0];
}

export async function reanalyzeResume(id: string): Promise<ResumeRow> {
  const resume = await getResume(id);
  if (!resume) throw new Error(`resume not found: ${id}`);
  const buffer = await readFile(resume.storage_path);
  try {
    const { text, profile } = await analyzePdfBuffer(buffer, resume.language);
    return persistAnalyzed(id, text, profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE resumes SET analysis_error = $2, analyzed_at = now() WHERE id = $1`,
      [id, message],
    );
    throw err;
  }
}

export async function setActiveResume(id: string): Promise<ResumeRow> {
  const resume = await getResume(id);
  if (!resume) throw new Error(`resume not found: ${id}`);

  // Only deactivate resumes sharing this exact (language, category) slot —
  // other categories (or the general slot) can stay active independently.
  await pool.query(
    `UPDATE resumes SET is_active = false
      WHERE language = $1 AND category IS NOT DISTINCT FROM $2`,
    [resume.language, resume.category],
  );
  const { rows } = await pool.query<ResumeRow>(
    `UPDATE resumes SET is_active = true WHERE id = $1
     RETURNING ${RESUME_COLUMNS}`,
    [id],
  );
  const active = rows[0];
  if (!active) throw new Error(`resume not found: ${id}`);

  if (!active.profile_json) {
    return reanalyzeResume(id);
  }
  return active;
}

export async function storeResumeUpload(opts: {
  buffer: Buffer;
  filename: string;
  language: ResumeLanguage;
  /** Null/omitted = general resume, usable as a fallback for any category. */
  category?: InternshipCategory | null;
  label?: string;
  mimeType?: string;
  activate?: boolean;
}): Promise<ResumeRow> {
  if (!opts.buffer.length) throw new Error("Empty file");
  if (opts.buffer.length > 8 * 1024 * 1024) throw new Error("Resume must be under 8 MB");

  const mime = opts.mimeType ?? "application/pdf";
  if (!mime.includes("pdf") && !opts.filename.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF resumes are supported");
  }

  await mkdir(RESUMES_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = `${opts.language}-${stamp}-${slug(opts.filename) || "resume.pdf"}`;
  const storagePath = path.join(RESUMES_DIR, safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
  await writeFile(storagePath, opts.buffer);

  const label = opts.label?.trim() || opts.filename;
  const { rows } = await pool.query<ResumeRow>(
    `INSERT INTO resumes (language, category, label, filename, storage_path, mime_type, byte_size, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     RETURNING ${RESUME_COLUMNS}`,
    [opts.language, opts.category ?? null, label, opts.filename, storagePath, mime, opts.buffer.length],
  );
  let resume = rows[0];
  if (!resume) throw new Error("failed to insert resume");

  try {
    const { text, profile } = await analyzePdfBuffer(opts.buffer, opts.language);
    resume = await persistAnalyzed(resume.id, text, profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(`UPDATE resumes SET analysis_error = $2 WHERE id = $1`, [resume.id, message]);
    resume = (await getResume(resume.id))!;
  }

  if (opts.activate !== false) {
    resume = await setActiveResume(resume.id);
  }

  return resume;
}

export async function importResumeFromDisk(opts: {
  sourcePath: string;
  language: ResumeLanguage;
  label: string;
  activate?: boolean;
}): Promise<ResumeRow> {
  const buffer = await readFile(opts.sourcePath);
  const filename = path.basename(opts.sourcePath);
  await mkdir(RESUMES_DIR, { recursive: true });
  // Prefer storeResumeUpload so analysis + activation stay consistent.
  return storeResumeUpload({
    buffer,
    filename,
    language: opts.language,
    label: opts.label,
    activate: opts.activate,
  });
}

export async function replaceResume(opts: {
  id: string;
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}): Promise<ResumeRow> {
  const existing = await getResume(opts.id);
  if (!existing) throw new Error(`resume not found: ${opts.id}`);

  await mkdir(RESUMES_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = `${existing.language}-${stamp}-${slug(opts.filename) || "resume.pdf"}`;
  const storagePath = path.join(RESUMES_DIR, safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
  await writeFile(storagePath, opts.buffer);

  await pool.query(
    `UPDATE resumes
        SET filename = $2,
            storage_path = $3,
            mime_type = $4,
            byte_size = $5,
            uploaded_at = now(),
            analyzed_at = NULL,
            raw_text = NULL,
            profile_json = NULL,
            analysis_error = NULL
      WHERE id = $1`,
    [
      opts.id,
      opts.filename,
      storagePath,
      opts.mimeType ?? "application/pdf",
      opts.buffer.length,
    ],
  );

  return reanalyzeResume(opts.id);
}

/** Copy helper used by seed/import scripts when we already wrote the file. */
export async function ensureResumeCopy(sourcePath: string, destName: string): Promise<string> {
  await mkdir(RESUMES_DIR, { recursive: true });
  const dest = path.join(RESUMES_DIR, destName);
  await copyFile(sourcePath, dest);
  return dest;
}
