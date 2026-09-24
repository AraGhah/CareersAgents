import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { detectCategories } from "./category";
import {
  bankForForm,
  detectLetterLang,
  fillLetter,
  fillOutreachEmail,
  flagUnknownNouns,
  parseLinks,
  type LetterInput,
  type LetterLang,
  type MatchedAnswer,
  type NounFlag,
} from "./letter";
import { pool } from "./db";
import { listContactsForCompany, updateApplicationFields } from "./queries";
import { pickBestContact } from "./recruiter";
import type { CompanyDossier } from "./research";
import type { Answer, ApplicationDetail, Project } from "./types";

export type ChecklistItem = {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
};

export type PackageResult = {
  dir: string;
  letterPath: string;
  pdfPath: string;
  emailPath: string;
  letter: string;
  emailSubject: string;
  emailBody: string;
  emailWordCount: number;
  lang: LetterLang;
  categories: string[];
  projects: Project[];
  flags: NounFlag[];
  checklist: ChecklistItem[];
  resumeId: string | null;
  resumePath: string | null;
};

function slugPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .toLowerCase() || "item";
}

async function answerText(key: string, lang: LetterLang): Promise<string> {
  const { rows } = await pool.query<Answer>(
    `SELECT id, key, category, answer_en, answer_fr, updated_at FROM answers WHERE key = $1`,
    [key],
  );
  const row = rows[0];
  if (!row) throw new Error(`answer bank is missing ${key}`);
  const text = lang === "fr" ? row.answer_fr ?? row.answer_en : row.answer_en ?? row.answer_fr;
  if (!text) throw new Error(`answer ${key} has no text for ${lang}`);
  return text;
}

export type ApplicantContact = {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  availability: string;
  locationRule: string;
};

/** The applicant's own contact block, pulled from the answer bank in one place. */
export async function loadApplicantContact(lang: LetterLang): Promise<ApplicantContact> {
  const [fullName, email, phone, city, availability, locationRule] = await Promise.all([
    answerText("full_name", lang),
    answerText("email", lang),
    answerText("phone", lang),
    answerText("city", lang),
    answerText("available_from", lang),
    answerText("location_rule", lang),
  ]);
  return { fullName, email, phone, city, availability, locationRule };
}

/** Best-known hiring contact name for a company, or null when none is verified yet. */
export async function bestRecruiterName(companyId: string): Promise<string | null> {
  const contacts = await listContactsForCompany(companyId);
  const contact = pickBestContact(contacts);
  return contact?.name ?? null;
}

export async function projectsForCategories(categories: string[]): Promise<Project[]> {
  if (categories.length === 0) {
    const { rows } = await pool.query<Project>(
      `SELECT id, name, summary, tech, url, highlight_for FROM projects ORDER BY name LIMIT 3`,
    );
    return rows;
  }

  const { rows } = await pool.query<Project>(
    `SELECT id, name, summary, tech, url, highlight_for
       FROM projects
      WHERE highlight_for && $1::text[]
      ORDER BY name
      LIMIT 3`,
    [categories],
  );

  if (rows.length > 0) return rows;

  const fallback = await pool.query<Project>(
    `SELECT id, name, summary, tech, url, highlight_for FROM projects ORDER BY name LIMIT 2`,
  );
  return fallback.rows;
}

async function writePdf(letter: string, filePath: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontSize = 11;
  const lineHeight = 14;
  const margin = 54;
  let page = doc.addPage();
  let { width, height } = page.getSize();
  let y = height - margin;

  const maxWidth = width - margin * 2;
  const paragraphs = letter.split("\n");

  for (const paragraph of paragraphs) {
    const words = paragraph.length === 0 ? [""] : paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, fontSize) > maxWidth && line) {
        page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight;
        line = word;
        if (y < margin) {
          page = doc.addPage();
          ({ width, height } = page.getSize());
          y = height - margin;
        }
      } else {
        line = next;
      }
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lineHeight;
    if (y < margin) {
      page = doc.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    }
  }

  const bytes = await doc.save();
  await writeFile(filePath, bytes);
}

async function fileExists(filePath: string | null): Promise<boolean> {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function linkStatuses(urls: string[]): Promise<Array<{ url: string; ok: boolean; status: string }>> {
  const out: Array<{ url: string; ok: boolean; status: string }> = [];
  const headers = {
    "user-agent": "InternshipDesk/0.1 (+local package checklist)",
    accept: "*/*",
  };
  for (const url of urls) {
    try {
      let res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 405 || res.status === 403 || res.status === 999) {
        res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers,
          signal: AbortSignal.timeout(10000),
        });
      }
      out.push({ url, ok: res.ok || res.status === 999, status: String(res.status) });
    } catch (err) {
      // LinkedIn and some hosts refuse automated checks; try a bare GET once more.
      try {
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers,
          signal: AbortSignal.timeout(10000),
        });
        out.push({ url, ok: res.ok || res.status === 999, status: String(res.status) });
      } catch (inner) {
        out.push({
          url,
          ok: false,
          status: inner instanceof Error ? inner.message : String(inner),
        });
      }
    }
  }
  return out;
}

export async function runChecklist(opts: {
  app: ApplicationDetail;
  letter: string;
  input: LetterInput;
  flags: NounFlag[];
  /** Live HEAD/GET requests per link, ~10s timeout each, sequential — skip for bulk builds. */
  checkLinks?: boolean;
}): Promise<ChecklistItem[]> {
  const { app, letter, input, flags } = opts;
  const checkLinks = opts.checkLinks ?? true;
  const resumeOk = await fileExists(app.resume_path);

  const { rows: twins } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM applications WHERE job_id = $1`,
    [app.job_id],
  );
  const appCount = Number(twins[0]?.n ?? 0);

  const checklist: ChecklistItem[] = [
    {
      id: "company",
      ok: letter.toLowerCase().includes(input.companyName.toLowerCase()),
      label: "Company name appears in the letter",
      detail: input.companyName,
    },
    {
      id: "role",
      ok: letter.toLowerCase().includes(input.roleTitle.toLowerCase()),
      label: "Role title appears in the letter",
      detail: input.roleTitle,
    },
    {
      id: "nouns",
      ok: flags.length === 0,
      label: "No proper noun outside the letter input",
      detail: flags.length ? flags.map((f) => f.word).join(", ") : "clean",
    },
    {
      id: "resume",
      ok: resumeOk,
      label: "Resume file exists on disk",
      detail: app.resume_path ?? "not set",
    },
  ];

  if (checkLinks) {
    const linkChecks = await linkStatuses(input.links);
    const failedLinks = linkChecks.filter((l) => !l.ok);
    checklist.push({
      id: "links",
      ok: failedLinks.length === 0 && input.links.length > 0,
      label: "Portfolio / GitHub / LinkedIn links respond",
      detail:
        input.links.length === 0
          ? "no links in the answer bank"
          : failedLinks.length
            ? failedLinks.map((l) => `${l.url} → ${l.status}`).join("; ")
            : linkChecks.map((l) => `${l.url} → ${l.status}`).join("; "),
    });
  }

  checklist.push({
    id: "unique",
    ok: appCount === 1,
    label: "Only one application row for this job",
    detail: `${appCount} row(s)`,
  });

  return checklist;
}

export async function buildApplicationPackage(opts: {
  app: ApplicationDetail;
  companyFact: string;
  companyFactSource: string;
  lang?: LetterLang;
  /** Skip the live link-reachability check — used for bulk/automated builds. */
  checkLinks?: boolean;
}): Promise<PackageResult> {
  const lang = opts.lang ?? detectLetterLang(opts.app.title, opts.app.description);
  const categories = detectCategories(opts.app.title, opts.app.description);
  const projects = await projectsForCategories(categories);

  const { resolveResumeForJob } = await import("./resumes");
  const { detectInternshipCategories } = await import("./internship-category");
  const resume = await resolveResumeForJob(
    lang,
    detectInternshipCategories(opts.app.title, opts.app.description),
  );

  const contact = await loadApplicantContact(lang);
  const linksRaw = await answerText("links", lang);
  const links = parseLinks(linksRaw);
  const recruiterName = await bestRecruiterName(opts.app.company_id);

  const input: LetterInput = {
    fullName: contact.fullName,
    companyName: opts.app.company_name,
    roleTitle: opts.app.title,
    companyFact: opts.companyFact,
    companyFactSource: opts.companyFactSource,
    projects,
    availability: contact.availability,
    locationRule: contact.locationRule,
    links,
    lang,
    email: contact.email,
    phone: contact.phone,
    city: contact.city,
    recruiterName,
  };

  const letter = fillLetter(input);
  const outreach = fillOutreachEmail(input);
  const flags = flagUnknownNouns(letter, input);

  const dir = path.join(
    "applications",
    `${slugPart(opts.app.company_name)}-${slugPart(opts.app.title)}`,
  );
  await mkdir(dir, { recursive: true });

  const letterPath = path.join(dir, `cover-letter.${lang}.txt`);
  const pdfPath = path.join(dir, `cover-letter.${lang}.pdf`);
  const emailPath = path.join(dir, `outreach-email.${lang}.txt`);
  await writeFile(letterPath, letter, "utf8");
  await writePdf(letter, pdfPath);
  await writeFile(
    emailPath,
    [`Subject: ${outreach.subject}`, "", outreach.body].join("\n"),
    "utf8",
  );

  const checklist = await runChecklist({
    app: {
      ...opts.app,
      resume_path: resume?.storage_path ?? opts.app.resume_path,
    },
    letter,
    input,
    flags,
    checkLinks: opts.checkLinks,
  });

  await writeFile(
    path.join(dir, "checklist.json"),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        lang,
        categories,
        projects: projects.map((p) => p.name),
        flags,
        checklist,
        companyFact: opts.companyFact,
        companyFactSource: opts.companyFactSource,
        emailSubject: outreach.subject,
        emailBody: outreach.body,
        emailWordCount: outreach.wordCount,
        resumeId: resume?.id ?? null,
        resumePath: resume?.storage_path ?? opts.app.resume_path,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    dir,
    letterPath,
    pdfPath,
    emailPath,
    letter,
    emailSubject: outreach.subject,
    emailBody: outreach.body,
    emailWordCount: outreach.wordCount,
    lang,
    categories,
    projects,
    flags,
    checklist,
    resumeId: resume?.id ?? null,
    resumePath: resume?.storage_path ?? opts.app.resume_path ?? null,
  };
}

/**
 * Builds (or reuses) the personalized cover letter for one application, from
 * whatever the company dossier has researched so far. Every application gets
 * a real, company-specific letter this way — not just the ones a recruiter
 * contact happened to be found for — without the caller needing to know
 * anything about company facts or sourcing.
 */
export async function buildPackageFromDossier(opts: {
  app: ApplicationDetail;
  dossier: CompanyDossier | null;
  lang: LetterLang;
  /** Skip the live link-reachability check — on by default for a single, user-facing build. */
  checkLinks?: boolean;
  /** Rebuild even if a cover letter already exists for this application. */
  force?: boolean;
}): Promise<PackageResult | null> {
  if (!opts.force && opts.app.cover_letter_path) return null;

  const fact =
    opts.dossier?.company_fact?.trim() ||
    (opts.lang === "fr"
      ? `${opts.app.company_name} recrute pour ${opts.app.title}.`
      : `${opts.app.company_name} is hiring for ${opts.app.title}.`);
  const source = opts.dossier?.company_fact_source || opts.app.company_website || opts.app.url;

  const result = await buildApplicationPackage({
    app: opts.app,
    companyFact: fact,
    companyFactSource: source,
    lang: opts.lang,
    checkLinks: opts.checkLinks,
  });

  await updateApplicationFields(opts.app.id, {
    notes: opts.app.notes,
    resumePath: result.resumePath ?? opts.app.resume_path,
    coverLetterPath: result.pdfPath,
    resumeId: result.resumeId,
  });

  return result;
}

export async function loadAnswerBank(lang: LetterLang): Promise<MatchedAnswer[]> {
  const { rows } = await pool.query<Answer>(
    `SELECT id, key, category, answer_en, answer_fr, updated_at
       FROM answers
      ORDER BY CASE category WHEN 'green' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, key`,
  );
  return bankForForm(rows, lang);
}
