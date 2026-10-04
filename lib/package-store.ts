import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NounFlag } from "./letter";
import type { ChecklistItem } from "./package";
import { safeDeskPath } from "./safe-path";
export type StoredPackage = {
  dir: string;
  letter: string | null;
  letterPath: string | null;
  pdfPath: string | null;
  checklist: ChecklistItem[] | null;
  flags: NounFlag[] | null;
  categories: string[] | null;
  projects: string[] | null;
  lang: string | null;
  companyFact: string | null;
  companyFactSource: string | null;
  /** True when a person typed the fact, so it can safely be shown back in the form. */
  companyFactVerified: boolean;
  emailSubject: string | null;
  emailBody: string | null;
  emailWordCount: number | null;
};

type ChecklistFile = {
  lang?: string;
  categories?: string[];
  projects?: string[];
  flags?: NounFlag[];
  checklist?: ChecklistItem[];
  companyFact?: string;
  companyFactSource?: string;
  companyFactVerified?: boolean;
  emailSubject?: string;
  emailBody?: string;
  emailWordCount?: number;
};

export async function loadStoredPackage(storedPath: string | null): Promise<StoredPackage | null> {
  // The package folder is one the desk wrote, under applications/: any other path reads nothing.
  const coverLetterPath = safeDeskPath(storedPath);
  if (!coverLetterPath) return null;
  const dir = path.dirname(coverLetterPath);
  const base = path.basename(coverLetterPath);
  const langMatch = base.match(/cover-letter\.(en|fr)\.pdf$/);
  const lang = langMatch?.[1] ?? "en";
  const letterPath = path.join(dir, `cover-letter.${lang}.txt`);

  let letter: string | null = null;
  try {
    letter = await readFile(letterPath, "utf8");
  } catch {
    letter = null;
  }

  let meta: ChecklistFile = {};
  try {
    meta = JSON.parse(await readFile(path.join(dir, "checklist.json"), "utf8")) as ChecklistFile;
  } catch {
    meta = {};
  }

  return {
    dir,
    letter,
    letterPath,
    pdfPath: coverLetterPath,
    checklist: meta.checklist ?? null,
    flags: meta.flags ?? null,
    categories: meta.categories ?? null,
    projects: meta.projects ?? null,
    lang: meta.lang ?? lang,
    companyFact: meta.companyFact ?? null,
    companyFactSource: meta.companyFactSource ?? null,
    companyFactVerified: meta.companyFactVerified ?? false,
    emailSubject: meta.emailSubject ?? null,
    emailBody: meta.emailBody ?? null,
    emailWordCount: meta.emailWordCount ?? null,
  };
}
