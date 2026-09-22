import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkplaceType } from "./types";
import filtersConfig from "../filters.json";

type FiltersConfig = {
  internshipTerms: string[];
  roleTerms: string[];
  excludeTerms: string[];
  autoTrackMinPercent: number;
};

const filters = filtersConfig as FiltersConfig;

function escapeRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match against any of the given terms (case-insensitive). */
function termsToRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  return new RegExp(`\\b(?:${terms.map(escapeRegex).join("|")})\\b`, "i");
}

const INTERNSHIP_RE = termsToRegex(filters.internshipTerms);
const ROLE_RE = termsToRegex(filters.roleTerms);
const EXCLUDE_RE = termsToRegex(filters.excludeTerms);

export type BoardCompany = {
  id: string;
  name: string;
  ats: string;
  board_token: string;
};

export type NormalizedJob = {
  externalId: string;
  title: string;
  location: string | null;
  workplaceType: WorkplaceType | null;
  url: string;
  description: string | null;
  postedAt: Date | null;
  source: string;
};

const CACHE_DIR = path.join("cache", "discover");
const CACHE_MS = 3 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

export function htmlToText(value: string | null | undefined): string | null {
  if (!value) return null;
  const once = decodeEntities(value);
  const text = decodeEntities(once)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

export function workplaceFrom(...parts: Array<string | null | undefined>): WorkplaceType | null {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (/\bremote\b|t[eé]l[eé]travail|work from home|\bwfh\b/.test(text)) return "remote";
  if (/\bhybrid\b|\bhybride\b/.test(text)) return "hybrid";
  if (/\bon-?site\b|\bonsite\b|pr[eé]sentiel|in-office/.test(text)) return "onsite";
  return null;
}

async function loadCache(key: string, fresh: boolean): Promise<unknown | null> {
  if (fresh) return null;
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { savedAt: string; payload: unknown };
    if (Date.now() - new Date(parsed.savedAt).getTime() > CACHE_MS) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

async function saveCache(key: string, payload: unknown) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    path.join(CACHE_DIR, `${key}.json`),
    JSON.stringify({ savedAt: new Date().toISOString(), payload }, null, 2),
  );
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  let wait = 1000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "InternshipDesk/0.1" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429 || res.status === 503) {
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (!res.ok) throw new Error(`${label}: ${res.status}`);
    return res.json();
  }
  throw new Error(`${label}: still rate limited`);
}

export async function cachedFetch(
  key: string,
  url: string,
  label: string,
  fresh: boolean,
): Promise<unknown> {
  const cached = await loadCache(key, fresh);
  if (cached !== null) return cached;
  const payload = await fetchJson(url, label);
  await saveCache(key, payload);
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function greenhouseJobs(payload: unknown): NormalizedJob[] {
  const jobs = asRecord(payload).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((raw) => {
    const job = asRecord(raw);
    const id = job.id;
    const title = str(job.title);
    const url = str(job.absolute_url);
    if (id == null || !title || !url) return [];
    const location = str(asRecord(job.location).name);
    return [
      {
        externalId: String(id),
        title,
        location,
        workplaceType: workplaceFrom(location, str(job.workplace_type)),
        url,
        description: htmlToText(str(job.content)),
        postedAt: str(job.first_published) ? new Date(String(job.first_published)) : null,
        source: "greenhouse",
      },
    ];
  });
}

function leverJobs(payload: unknown): NormalizedJob[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw) => {
    const job = asRecord(raw);
    const id = str(job.id);
    const title = str(job.text);
    const url = str(job.hostedUrl) ?? str(job.applyUrl);
    if (!id || !title || !url) return [];
    const categories = asRecord(job.categories);
    const location = str(categories.location) ?? str(job.country);
    const workplaceRaw = str(job.workplaceType);
    const workplace =
      workplaceRaw === "on-site"
        ? "onsite"
        : workplaceRaw === "hybrid" || workplaceRaw === "remote"
          ? workplaceRaw
          : workplaceFrom(location, workplaceRaw);
    const created = typeof job.createdAt === "number" ? new Date(job.createdAt) : null;
    return [
      {
        externalId: id,
        title,
        location,
        workplaceType: workplace,
        url,
        description: str(job.descriptionPlain) ?? htmlToText(str(job.description)),
        postedAt: created,
        source: "lever",
      },
    ];
  });
}

function workableJobs(payload: unknown): NormalizedJob[] {
  const jobs = asRecord(payload).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((raw) => {
    const job = asRecord(raw);
    const id = str(job.shortcode) ?? str(job.code);
    const title = str(job.title);
    const url = str(job.url) ?? str(job.shortlink);
    if (!id || !title || !url) return [];
    const locObj = asRecord(job.location);
    const locList = Array.isArray(job.locations) ? job.locations.map(asRecord) : [];
    const firstList = locList[0] ?? {};
    const location =
      [
        str(job.city) ?? str(locObj.city) ?? str(firstList.city),
        str(job.state) ?? str(locObj.region) ?? str(firstList.region),
        str(job.country) ?? str(locObj.country) ?? str(firstList.country),
      ]
        .filter(Boolean)
        .join(", ") || null;
    const telecommuting = locObj.telecommuting === true || job.telecommuting === true;
    return [
      {
        externalId: id,
        title,
        location,
        workplaceType: telecommuting ? "remote" : workplaceFrom(location, str(job.employment_type)),
        url,
        description: htmlToText(str(job.description)),
        postedAt:
          str(job.created_at) ?? str(job.published_on)
            ? new Date(String(str(job.created_at) ?? str(job.published_on)))
            : null,
        source: "workable",
      },
    ];
  });
}

/** Ashby public job board API — real endpoint, no scraping. */
function ashbyJobs(payload: unknown): NormalizedJob[] {
  const jobs = asRecord(payload).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((raw) => {
    const job = asRecord(raw);
    const id = str(job.id) ?? str(job.jobId);
    const title = str(job.title);
    const url = str(job.jobUrl) ?? str(job.applyUrl);
    if (!id || !title || !url) return [];
    const location = str(job.location) ?? str(asRecord(job.address).postalAddress);
    const isRemote = job.isRemote === true;
    return [
      {
        externalId: id,
        title,
        location,
        workplaceType: isRemote ? "remote" : workplaceFrom(location),
        url,
        description: htmlToText(str(job.descriptionHtml) ?? str(job.descriptionPlain)),
        postedAt: str(job.publishedAt) ? new Date(String(job.publishedAt)) : null,
        source: "ashby",
      },
    ];
  });
}

export async function fetchBoard(
  company: BoardCompany,
  opts: { fresh?: boolean } = {},
): Promise<NormalizedJob[]> {
  const token = company.board_token;
  const encoded = encodeURIComponent(token);
  const fresh = opts.fresh === true;

  if (company.ats === "greenhouse") {
    const payload = await cachedFetch(
      `greenhouse-${token}`,
      `https://boards-api.greenhouse.io/v1/boards/${encoded}/jobs?content=true`,
      `Greenhouse ${token}`,
      fresh,
    );
    return greenhouseJobs(payload);
  }

  if (company.ats === "lever") {
    try {
      const payload = await cachedFetch(
        `lever-${token}`,
        `https://api.lever.co/v0/postings/${encoded}?mode=json`,
        `Lever ${token}`,
        fresh,
      );
      return leverJobs(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("404")) throw err;
      const payload = await cachedFetch(
        `lever-eu-${token}`,
        `https://api.eu.lever.co/v0/postings/${encoded}?mode=json`,
        `Lever EU ${token}`,
        fresh,
      );
      return leverJobs(payload);
    }
  }

  if (company.ats === "workable") {
    const payload = await cachedFetch(
      `workable-${token}`,
      `https://apply.workable.com/api/v1/widget/accounts/${encoded}`,
      `Workable ${token}`,
      fresh,
    );
    return workableJobs(payload);
  }

  if (company.ats === "ashby") {
    const payload = await cachedFetch(
      `ashby-${token}`,
      `https://api.ashbyhq.com/posting-api/job-board/${encoded}?includeCompensation=true`,
      `Ashby ${token}`,
      fresh,
    );
    return ashbyJobs(payload);
  }

  return [];
}

/** Title filter for internship / stage / co-op roles. Terms live in filters.json. */
export function isInternshipTitle(title: string): boolean {
  return INTERNSHIP_RE ? INTERNSHIP_RE.test(title) : false;
}

/** Title-level hard exclude (seniority, management, ...). Terms live in filters.json. */
export function isExcludedTitle(title: string): boolean {
  return EXCLUDE_RE ? EXCLUDE_RE.test(title) : false;
}

/** Full-stack / software developer relevance vs generic roles. Terms live in filters.json. */
export function isSoftwareRelevant(title: string, description: string | null): boolean {
  if (isExcludedTitle(title)) return false;
  const text = `${title}\n${description ?? ""}`;
  if (ROLE_RE?.test(text)) return true;
  // The middle "internship-titled + narrower tech word" case from the old
  // hardcoded version was a strict subset of isInternshipTitle(title) and
  // could never change the outcome — this fallback covers it identically.
  return isInternshipTitle(title);
}
