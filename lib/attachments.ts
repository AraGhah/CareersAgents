import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { GmailAttachment } from "./gmail";
import { detectInternshipCategories } from "./internship-category";
import { detectLetterLang, type LetterLang } from "./letter";
import { loadApplicantContact } from "./package";
import { resolveResumeForJob } from "./resumes";
import { safeDeskPath } from "./safe-path";
import type { ApplicationDetail } from "./types";

// The two files that go with an application email: the CV and the cover letter PDF. One place decides
// which files they are and what they are called, for the download links and for the Gmail draft alike.

export type ApplicationFile = {
  kind: "cv" | "letter";
  /** Path on disk, as recorded for the application. */
  path: string;
  /** The name the recipient sees. */
  filename: string;
  contentType: string;
};

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

/**
 * The application's CV and cover letter, in that order, with the names they are sent under. Only paths
 * recorded for this application are used, only document types, and only files the desk wrote itself (under
 * resumes/ or applications/); a file that is not set, or lies anywhere else, is left out.
 */
export async function applicationFiles(app: ApplicationDetail): Promise<ApplicationFile[]> {
  // The letter's own language (it is in the file name), so "Lettre de motivation" goes with a French letter.
  const lang: LetterLang = /cover-letter\.fr\.pdf$/.test(app.cover_letter_path ?? "")
    ? "fr"
    : detectLetterLang(app.title, app.description);
  const { fullName } = await loadApplicantContact(lang);
  const company = app.company_name.replace(/[\\/:*?"<>|]+/g, "").trim() || "Application";

  let cvPath = app.resume_path;
  if (!cvPath) {
    const resume = await resolveResumeForJob(lang, detectInternshipCategories(app.title, app.description));
    cvPath = resume?.storage_path ?? null;
  }

  const files: ApplicationFile[] = [];
  const add = (kind: ApplicationFile["kind"], file: string | null, name: (ext: string) => string) => {
    const safe = safeDeskPath(file);
    if (!safe) return;
    const ext = path.extname(safe).toLowerCase();
    const contentType = TYPES[ext];
    if (contentType) files.push({ kind, path: safe, filename: name(ext), contentType });
  };
  add("cv", cvPath, (ext) => `CV - ${fullName}${ext}`);
  add("letter", app.cover_letter_path, (ext) => `${lang === "fr" ? "Lettre de motivation" : "Cover Letter"} - ${company}${ext}`);
  return files;
}

/**
 * The same list, but only the files that are actually readable on disk right now. A path can be recorded
 * on the application (or resolved from the active resume) yet point at a file that was since moved or
 * deleted — this is what a download link or an "attached automatically" message should check before
 * promising a file it can't deliver.
 */
export async function existingApplicationFiles(app: ApplicationDetail): Promise<ApplicationFile[]> {
  const files = await applicationFiles(app);
  const checks = await Promise.all(
    files.map(async (f) => {
      try {
        await access(f.path);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return files.filter((_, i) => checks[i]);
}

/** The same files, read into memory and ready to attach. Files missing on disk are skipped and reported. */
export async function loadAttachments(app: ApplicationDetail): Promise<{ attachments: GmailAttachment[]; missing: string[] }> {
  const attachments: GmailAttachment[] = [];
  const missing: string[] = [];
  for (const file of await applicationFiles(app)) {
    try {
      attachments.push({ filename: file.filename, content: await readFile(file.path), contentType: file.contentType });
    } catch {
      missing.push(file.filename);
    }
  }
  return { attachments, missing };
}
