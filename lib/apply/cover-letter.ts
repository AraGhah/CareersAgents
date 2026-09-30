// The cover letter for a portal application. It is the same personalized letter
// the email path builds (lib/package.ts), reused when it already exists and
// built when the form requires one. Before it goes on a form it is checked
// against this exact company, role and language.

import { access } from "node:fs/promises";
import { buildPackageFromDossier } from "../package";
import { loadStoredPackage } from "../package-store";
import type { CompanyDossier } from "../research";
import type { ApplicationDetail } from "../types";
import { norm } from "./text";
import type { Check, Lang } from "./types";

export type CoverLetter = { pdfPath: string; text: string | null; lang: Lang; built: boolean; checks: Check[] };

async function exists(p: string | null): Promise<boolean> {
  if (!p) return false;
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function coverLetterChecks(text: string | null, lang: string | null, opts: { companyName: string; title: string; lang: Lang }): Check[] {
  const t = norm(text ?? "");
  return [
    { id: "cl_company", ok: t.includes(norm(opts.companyName)), label: "Cover letter names this company", detail: opts.companyName },
    { id: "cl_role", ok: t.includes(norm(opts.title)), label: "Cover letter names this exact role", detail: opts.title },
    { id: "cl_lang", ok: lang === opts.lang, label: "Cover letter is in the posting's language", detail: `${lang ?? "?"} vs ${opts.lang}` },
    { id: "cl_placeholder", ok: !/\[[^\]]+\]/.test(text ?? ""), label: "No [placeholder] left in the letter" },
  ];
}

export async function ensureCoverLetter(opts: {
  app: ApplicationDetail;
  dossier: CompanyDossier | null;
  lang: Lang;
  /** Build one if none exists. Without this, an existing letter is reused and nothing is built. */
  build: boolean;
}): Promise<CoverLetter | null> {
  const ask = { companyName: opts.app.company_name, title: opts.app.title, lang: opts.lang };
  if (await exists(opts.app.cover_letter_path)) {
    const stored = await loadStoredPackage(opts.app.cover_letter_path);
    const lang = (stored?.lang === "fr" ? "fr" : "en") as Lang;
    const checks = coverLetterChecks(stored?.letter ?? null, stored?.lang ?? null, ask);
    // A letter in the wrong language is rebuilt rather than attached.
    if (lang === opts.lang || !opts.build) {
      return { pdfPath: opts.app.cover_letter_path!, text: stored?.letter ?? null, lang, built: false, checks };
    }
  }
  if (!opts.build) return null;
  const built = await buildPackageFromDossier({ app: opts.app, dossier: opts.dossier, lang: opts.lang, checkLinks: false, force: true });
  if (!built) return null;
  return {
    pdfPath: built.pdfPath,
    text: built.letter,
    lang: built.lang,
    built: true,
    checks: coverLetterChecks(built.letter, built.lang, ask),
  };
}
