import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";
import type { ApplicationDetail } from "./types";

export type ResearchSignal = {
  signal: string;
  source: string;
  date: string | null;
};

export type ContactTarget = {
  role: string;
  why: string;
  searchHint: string;
};

export type CompanyDossier = {
  id: string;
  company_id: string;
  application_id: string | null;
  researched_at: Date;
  summary: string;
  company_fact: string;
  company_fact_source: string;
  signals: ResearchSignal[];
  contact_targets: ContactTarget[];
  sources: string[];
  confidence: number;
  model: string | null;
};

const DEFAULT_CONTACT_TARGETS: ContactTarget[] = [
  {
    role: "Talent Acquisition / Recruiter",
    why: "Owns internship pipelines and screening.",
    searchHint: "site:linkedin.com/in \"Talent Acquisition\" OR Recruiter",
  },
  {
    role: "HR / People Operations",
    why: "Often listed on careers pages for student programs.",
    searchHint: "HR OR \"People Operations\" internship OR stage",
  },
  {
    role: "Engineering Manager / Software Development Manager",
    why: "Decides whether an intern can join the team.",
    searchHint: "\"Engineering Manager\" OR \"Software Development Manager\"",
  },
  {
    role: "Technical Recruiter",
    why: "Specializes in developer hiring.",
    searchHint: "\"Technical Recruiter\" OR \"Tech Recruiter\"",
  },
  {
    role: "Internship Coordinator",
    why: "Runs co-op / stage programs when the company has one.",
    searchHint: "\"Internship Coordinator\" OR \"University Relations\" OR stage",
  },
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<{ url: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "InternshipDesk/0.1 (+local company research)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html).slice(0, 12000);
    if (text.length < 80) return null;
    return { url: res.url || url, text };
  } catch {
    return null;
  }
}

function heuristicDossier(opts: {
  companyName: string;
  website: string | null;
  roleTitle: string;
  description: string | null;
  pages: Array<{ url: string; text: string }>;
}): Omit<CompanyDossier, "id" | "company_id" | "application_id" | "researched_at"> {
  const page = opts.pages[0];
  const blob = [opts.description ?? "", ...opts.pages.map((p) => p.text)].join("\n");
  const sentences = blob
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 40 &&
        s.length < 220 &&
        !/enable javascript|cookies?|privacy policy|all rights reserved|sign in|log in/i.test(s),
    );

  const about =
    sentences.find((s) => /we (?:are|build|help|provide|enable)|nous (?:sommes|aidons|offrons)/i.test(s)) ??
    sentences[0] ??
    `${opts.companyName} is hiring for ${opts.roleTitle}.`;

  const techHits = [
    ...blob.matchAll(
      /\b(TypeScript|JavaScript|React|Next\.js|Node\.js|PostgreSQL|Python|Java|AWS|Azure|Docker|Kubernetes)\b/gi,
    ),
  ].map((m) => m[1]);
  const uniqueTech = [...new Set(techHits.map((t) => t))].slice(0, 6);

  const signals: ResearchSignal[] = [];
  if (uniqueTech.length) {
    signals.push({
      signal: `Stack signals on public pages: ${uniqueTech.join(", ")}`,
      source: page?.url ?? opts.website ?? "posting",
      date: null,
    });
  }
  if (/intern|stage|co-?op|stagiaire/i.test(blob)) {
    signals.push({
      signal: "Public materials mention internships / stages / co-op.",
      source: page?.url ?? "posting",
      date: null,
    });
  }
  if (/Montr[eé]al|Laval|Qu[eé]bec/i.test(blob)) {
    signals.push({
      signal: "Company materials reference Montréal / Québec presence.",
      source: page?.url ?? "posting",
      date: null,
    });
  }
  if (signals.length === 0) {
    signals.push({
      signal: `Actively hiring for ${opts.roleTitle}.`,
      source: "job posting",
      date: null,
    });
  }

  const contact_targets = DEFAULT_CONTACT_TARGETS.map((t) => ({
    ...t,
    searchHint: `${opts.companyName} ${t.searchHint}`,
  }));

  const company_fact = about.slice(0, 280);
  const company_fact_source = page?.url ?? opts.website ?? "job posting";

  return {
    summary: [
      `${opts.companyName} — research brief for ${opts.roleTitle}.`,
      company_fact,
      uniqueTech.length ? `Observed technologies: ${uniqueTech.join(", ")}.` : null,
      "Contact emails are never guessed; add verified addresses from a public source_url.",
    ]
      .filter(Boolean)
      .join(" "),
    company_fact,
    company_fact_source,
    signals,
    contact_targets,
    sources: [...new Set([...(opts.website ? [opts.website] : []), ...opts.pages.map((p) => p.url)])],
    confidence: Math.min(0.85, 0.35 + opts.pages.length * 0.2 + signals.length * 0.05),
    model: "heuristic",
  };
}

function parseJsonObject<T>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model response");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

async function claudeEnrich(opts: {
  companyName: string;
  roleTitle: string;
  description: string | null;
  pages: Array<{ url: string; text: string }>;
  base: ReturnType<typeof heuristicDossier>;
}): Promise<ReturnType<typeof heuristicDossier> | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const client = new Anthropic({ apiKey: key });
  const model = process.env.ANTHROPIC_RESEARCH_MODEL?.trim() || "claude-haiku-4-5-20251001";

  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    system:
      "You are a hiring-research analyst for internship outreach. Use only provided text. Do not invent emails, names, or facts. Return valid JSON only.",
    messages: [
      {
        role: "user",
        content: `Company: ${opts.companyName}
Role: ${opts.roleTitle}
Job description excerpt: ${(opts.description ?? "").slice(0, 2500)}
Fetched pages: ${JSON.stringify(
          opts.pages.map((p) => ({ url: p.url, text: p.text.slice(0, 3500) })),
        )}

Return JSON:
{
  "summary": "3-5 sentences",
  "company_fact": "one concrete sentence usable in an email",
  "company_fact_source": "url",
  "signals": [{"signal":"...","source":"url","date":null}],
  "contact_targets": [{"role":"...","why":"...","searchHint":"..."}],
  "confidence": 0-1
}`,
      },
    ],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;
  const parsed = parseJsonObject<{
    summary?: string;
    company_fact?: string;
    company_fact_source?: string;
    signals?: ResearchSignal[];
    contact_targets?: ContactTarget[];
    confidence?: number;
  }>(textBlock.text);

  return {
    summary: parsed.summary?.trim() || opts.base.summary,
    company_fact: parsed.company_fact?.trim() || opts.base.company_fact,
    company_fact_source: parsed.company_fact_source?.trim() || opts.base.company_fact_source,
    signals:
      Array.isArray(parsed.signals) && parsed.signals.length > 0 ? parsed.signals : opts.base.signals,
    contact_targets:
      Array.isArray(parsed.contact_targets) && parsed.contact_targets.length > 0
        ? parsed.contact_targets
        : opts.base.contact_targets,
    sources: opts.base.sources,
    confidence:
      typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : opts.base.confidence,
    model,
  };
}

export async function getLatestDossier(
  companyId: string,
  applicationId?: string | null,
): Promise<CompanyDossier | null> {
  const { rows } = await pool.query<CompanyDossier>(
    `SELECT id, company_id, application_id, researched_at, summary, company_fact,
            company_fact_source, signals, contact_targets, sources, confidence, model
       FROM company_dossiers
      WHERE company_id = $1
        AND ($2::uuid IS NULL OR application_id = $2 OR application_id IS NULL)
      ORDER BY CASE WHEN application_id = $2 THEN 0 ELSE 1 END, researched_at DESC
      LIMIT 1`,
    [companyId, applicationId ?? null],
  );
  return rows[0] ?? null;
}

export async function researchCompanyForApplication(opts: {
  app: ApplicationDetail & { company_id?: string };
  companyId: string;
  force?: boolean;
}): Promise<CompanyDossier> {
  if (!opts.force) {
    const existing = await getLatestDossier(opts.companyId, opts.app.id);
    if (existing && Date.now() - new Date(existing.researched_at).getTime() < 7 * 24 * 60 * 60 * 1000) {
      return existing;
    }
  }

  const urls: string[] = [];
  if (opts.app.company_website) {
    const base = opts.app.company_website.includes("://")
      ? opts.app.company_website
      : `https://${opts.app.company_website}`;
    urls.push(base);
    try {
      const u = new URL(base);
      urls.push(new URL("/careers", u.origin).toString());
      urls.push(new URL("/about", u.origin).toString());
    } catch {
      /* ignore */
    }
  }

  const pages: Array<{ url: string; text: string }> = [];
  for (const url of [...new Set(urls)].slice(0, 3)) {
    const page = await fetchText(url);
    if (page) pages.push(page);
  }

  let draft = heuristicDossier({
    companyName: opts.app.company_name,
    website: opts.app.company_website,
    roleTitle: opts.app.title,
    description: opts.app.description,
    pages,
  });

  try {
    const enriched = await claudeEnrich({
      companyName: opts.app.company_name,
      roleTitle: opts.app.title,
      description: opts.app.description,
      pages,
      base: draft,
    });
    if (enriched) draft = enriched;
  } catch (err) {
    console.error("[research] Claude enrich failed, keeping heuristic:", err);
  }

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM company_dossiers WHERE application_id = $1`,
    [opts.app.id],
  );

  let rows: CompanyDossier[];
  if (existing.rows[0]) {
    const updated = await pool.query<CompanyDossier>(
      `UPDATE company_dossiers SET
          researched_at = now(),
          summary = $2,
          company_fact = $3,
          company_fact_source = $4,
          signals = $5::jsonb,
          contact_targets = $6::jsonb,
          sources = $7::jsonb,
          confidence = $8,
          model = $9
        WHERE id = $1
        RETURNING id, company_id, application_id, researched_at, summary, company_fact,
                  company_fact_source, signals, contact_targets, sources, confidence, model`,
      [
        existing.rows[0].id,
        draft.summary,
        draft.company_fact,
        draft.company_fact_source,
        JSON.stringify(draft.signals),
        JSON.stringify(draft.contact_targets),
        JSON.stringify(draft.sources),
        draft.confidence,
        draft.model,
      ],
    );
    rows = updated.rows;
  } else {
    const inserted = await pool.query<CompanyDossier>(
      `INSERT INTO company_dossiers (
          company_id, application_id, summary, company_fact, company_fact_source,
          signals, contact_targets, sources, confidence, model
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
        RETURNING id, company_id, application_id, researched_at, summary, company_fact,
                  company_fact_source, signals, contact_targets, sources, confidence, model`,
      [
        opts.companyId,
        opts.app.id,
        draft.summary,
        draft.company_fact,
        draft.company_fact_source,
        JSON.stringify(draft.signals),
        JSON.stringify(draft.contact_targets),
        JSON.stringify(draft.sources),
        draft.confidence,
        draft.model,
      ],
    );
    rows = inserted.rows;
  }

  if (!rows[0]) throw new Error("failed to store company dossier");
  return rows[0];
}

/** Extract publicly listed emails from careers HTML — never invent addresses. */
export function extractPublishedEmails(text: string, sourceUrl: string): Array<{
  email: string;
  role: string;
  source_url: string;
}> {
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) =>
    m[0].toLowerCase(),
  );
  const unique = [...new Set(emails)].filter(
    (e) => !/(example\.com|domain\.com|email\.com|sentry\.io|wixpress|cloudflare)/i.test(e),
  );
  return unique.slice(0, 5).map((email) => ({
    email,
    role: /career|jobs|talent|hr|recruit/i.test(email) ? "Careers inbox" : "Published contact",
    source_url: sourceUrl,
  }));
}
