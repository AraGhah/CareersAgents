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
}): Promise<ChecklistItem[]> {
  const { app, letter, input, flags } = opts;
  const resumeOk = await fileExists(app.resume_path);
  const linkChecks = await linkStatuses(input.links);
  const failedLinks = linkChecks.filter((l) => !l.ok);

  const { rows: twins } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM applications WHERE job_id = $1`,
    [app.job_id],
  );
  const appCount = Number(twins[0]?.n ?? 0);

  return [
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
    {
      id: "links",
      ok: failedLinks.length === 0 && input.links.length > 0,
      label: "Portfolio / GitHub / LinkedIn links respond",
      detail:
        input.links.length === 0
          ? "no links in the answer bank"
          : failedLinks.length
            ? failedLinks.map((l) => `${l.url} → ${l.status}`).join("; ")
            : linkChecks.map((l) => `${l.url} → ${l.status}`).join("; "),
    },
    {
      id: "unique",
      ok: appCount === 1,
      label: "Only one application row for this job",
      detail: `${appCount} row(s)`,
    },
  ];
}

export async function buildApplicationPackage(opts: {
  app: ApplicationDetail;
  companyFact: string;
  companyFactSource: string;
  lang?: LetterLang;
}): Promise<PackageResult> {
  const lang = opts.lang ?? detectLetterLang(opts.app.title, opts.app.description);
  const categories = detectCategories(opts.app.title, opts.app.description);
  const projects = await projectsForCategories(categories);

  const fullName = await answerText("full_name", lang);
  const availability = await answerText("available_from", lang);
  const locationRule = await answerText("location_rule", lang);
  const linksRaw = await answerText("links", lang);
  const links = parseLinks(linksRaw);

  const input: LetterInput = {
    fullName,
    companyName: opts.app.company_name,
    roleTitle: opts.app.title,
    companyFact: opts.companyFact,
    companyFactSource: opts.companyFactSource,
    projects,
    availability,
    locationRule,
    links,
    lang,
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

  const checklist = await runChecklist({ app: opts.app, letter, input, flags });

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
  };
}

export async function loadAnswerBank(lang: LetterLang): Promise<MatchedAnswer[]> {
  const { rows } = await pool.query<Answer>(
    `SELECT id, key, category, answer_en, answer_fr, updated_at
       FROM answers
      ORDER BY CASE category WHEN 'green' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, key`,
  );
  return bankForForm(rows, lang);
}
