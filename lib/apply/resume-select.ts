// Which CV goes with this application, and why. Same order as
// resolveResumeForJob (category first, then language, then the general CV), but
// it says which rule picked it, so the record and the preflight can show it.

import { access } from "node:fs/promises";
import { detectInternshipCategories, INTERNSHIP_CATEGORY_LABEL_FR, type InternshipCategory } from "../internship-category";
import type { ResumeRow } from "../profile";
import { getActiveResumeFor } from "../resumes";
import type { Lang } from "./types";

export type ResumeChoice = {
  resume: ResumeRow | null;
  reason: string;
  categories: InternshipCategory[];
  /** True when the CV's language is the posting's language. */
  langMatches: boolean;
  fileExists: boolean;
};

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function selectResume(lang: Lang, title: string, description: string | null): Promise<ResumeChoice> {
  const categories = detectInternshipCategories(title, description);
  const other: Lang = lang === "en" ? "fr" : "en";
  const tries: Array<{ lang: Lang; category: InternshipCategory | null; why: string }> = [
    ...categories.map((c) => ({ lang, category: c, why: `${INTERNSHIP_CATEGORY_LABEL_FR[c]} CV in the posting's language (${lang.toUpperCase()})` })),
    ...categories.map((c) => ({ lang: other, category: c, why: `${INTERNSHIP_CATEGORY_LABEL_FR[c]} CV, but in ${other.toUpperCase()}: no ${lang.toUpperCase()} one is active for this category` })),
    { lang, category: null, why: `General ${lang.toUpperCase()} CV: no CV is tagged for this category` },
    { lang: other, category: null, why: `General ${other.toUpperCase()} CV: nothing better is active` },
  ];
  for (const t of tries) {
    const resume = await getActiveResumeFor(t.lang, t.category);
    if (resume) {
      return { resume, reason: t.why, categories, langMatches: resume.language === lang, fileExists: await exists(resume.storage_path) };
    }
  }
  return { resume: null, reason: "No active CV. Upload one on /resumes.", categories, langMatches: false, fileExists: false };
}
