// LinkedIn and Indeed sourcing, via Apify — opt-in, BYO actor, for both.
//
// Neither of these scrapes the platform itself, and neither ever touches the
// user's own LinkedIn/Indeed account: each calls whatever Apify actor the
// user configures, on Apify's infrastructure, with the user's own Apify
// token. Reputable public "jobs" actors on both platforms read only public
// job-listing pages — no login, no cookies, no session — so there is no
// account of the user's to get restricted. The actor choice (and that
// actor's own compliance posture) stays the user's decision; this module is
// a generic caller, not a scraper.
//
// Indeed's own official Publisher API — the only route that ever let a
// third party pull listings directly from Indeed, no actor involved — was
// retired in 2023. That path stays dead regardless of any credential; the
// Apify route below is the only way either source works today.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { htmlToText, isInternshipTitle, isSoftwareRelevant, workplaceFrom } from "./discover-core";
import type { NormalizedJob } from "./discover-core";

export type ExternalJob = NormalizedJob & { companyName: string };

const CACHE_DIR = path.join("cache", "discover");
const CACHE_MS = 3 * 60 * 60 * 1000; // 3h — Apify runs cost credits, don't re-pay on every retry.

async function loadCache(key: string, fresh: boolean): Promise<unknown | null> {
  if (fresh) return null;
  try {
    const raw = await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
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

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Reads the first present field across an actor's possible naming variants. */
function pick(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(record[key]);
    if (value) return value;
  }
  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function apifyToken(): string | null {
  return (
    process.env.APIFY_TOKEN?.trim() ||
    process.env.APIFY_API_TOKEN?.trim() ||
    process.env.LINKEDIN_ACCESS_TOKEN?.trim() ||
    null
  );
}

/**
 * Apify actor ids are almost always "username/actor-name" — sanitize before
 * using as a filename, or the "/" tries to create a subdirectory that was
 * never mkdir'd and the cache write fails with ENOENT.
 */
function cacheKeyFor(prefix: string, discriminator: string): string {
  return `${prefix}-apify-${discriminator.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Normalizes one dataset item into a NormalizedJob. Different actors name
 * fields differently, so every lookup tries several common variants rather
 * than assuming one specific actor's schema.
 */
function normalizeJobItem(raw: unknown, source: string): ExternalJob | null {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const title = pick(item, ["title", "jobTitle", "position", "positionName", "name"]);
  const companyName = pick(item, ["companyName", "company", "organization", "employer"]);
  const url = pick(item, ["link", "url", "jobUrl", "applyUrl", "postingUrl", "externalApplyLink"]);
  if (!title || !companyName || !url) return null;

  const location = pick(item, ["location", "jobLocation", "place", "formattedLocation"]);
  const descriptionHtml = pick(item, [
    "description",
    "jobDescription",
    "descriptionText",
    "descriptionHtml",
    "snippet",
  ]);
  const employmentType = pick(item, ["employmentType", "workType", "jobType", "workplaceType"]);
  const postedRaw = pick(item, ["postedAt", "datePosted", "publishedAt", "postedDate", "listedAt"]);
  const externalId = pick(item, ["id", "jobId", "postingId"]) ?? url;

  return {
    externalId: `${source}-${externalId}`,
    title,
    companyName,
    location,
    workplaceType: workplaceFrom(location, employmentType),
    url,
    description: htmlToText(descriptionHtml),
    postedAt: parseDate(postedRaw),
    source,
  };
}

type ApifyJobsSource = {
  /** "linkedin" | "indeed" — used as the cache-key prefix and job source tag. */
  source: string;
  /** Human label for error messages, e.g. "LinkedIn". */
  label: string;
  actorEnvVar: string;
  inputEnvVar: string;
  queryEnvVar: string;
  locationEnvVar: string;
  defaultQuery: string;
};

async function callApifyActor(
  token: string,
  actorId: string,
  input: unknown,
  label: string,
): Promise<unknown[]> {
  const encodedActor = encodeURIComponent(actorId);
  const res = await fetch(
    `https://api.apify.com/v2/acts/${encodedActor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120000), // actor runs can take a while
    },
  );
  if (!res.ok) {
    throw new Error(`Apify ${label} actor ${actorId}: HTTP ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload) ? payload : [];
}

/**
 * Calls the configured Apify actor synchronously and returns normalized,
 * filtered jobs. The search query env var accepts a comma-separated list —
 * "software engineering intern, full stack intern, backend intern" — and the
 * actor runs once per query, since internship postings use varied titles
 * that one search string alone tends to miss. Results are merged and
 * deduped by their normalized job id.
 */
async function runApifyActorJobs(
  cfg: ApifyJobsSource,
  opts: { fresh?: boolean } = {},
): Promise<ExternalJob[]> {
  const token = apifyToken();
  const actorId = process.env[cfg.actorEnvVar]?.trim();
  if (!token || !actorId) return [];

  const customInput = process.env[cfg.inputEnvVar]?.trim();
  const location = process.env[cfg.locationEnvVar]?.trim() || "Montreal, Quebec, Canada";
  const queries = (process.env[cfg.queryEnvVar]?.trim() || cfg.defaultQuery)
    .split(",")
    .map((q) => q.trim())
    .filter(Boolean);

  // A full custom input (as JSON) always wins if the user's actor needs a
  // specific shape — it can't safely be split per query, so it runs once.
  const runs: Array<{ cacheKey: string; input: unknown }> = customInput
    ? [{ cacheKey: cacheKeyFor(cfg.source, `${actorId}-custom`), input: JSON.parse(customInput) }]
    : queries.map((query) => ({
        cacheKey: cacheKeyFor(cfg.source, `${actorId}-${query}`),
        input: { title: query, location, rows: 60 },
      }));

  const allItems: unknown[] = [];
  for (const run of runs) {
    const cached = await loadCache(run.cacheKey, opts.fresh === true);
    if (cached !== null && Array.isArray(cached)) {
      allItems.push(...cached);
      continue;
    }
    const items = await callApifyActor(token, actorId, run.input, cfg.label);
    await saveCache(run.cacheKey, items);
    allItems.push(...items);
  }

  const seen = new Set<string>();
  const jobs: ExternalJob[] = [];
  for (const raw of allItems) {
    const job = normalizeJobItem(raw, cfg.source);
    if (!job) continue;
    if (seen.has(job.externalId)) continue;
    if (!isInternshipTitle(job.title)) continue;
    if (!isSoftwareRelevant(job.title, job.description)) continue;
    seen.add(job.externalId);
    jobs.push(job);
  }
  return jobs;
}

/**
 * LinkedIn: runs only when APIFY_TOKEN + APIFY_LINKEDIN_JOBS_ACTOR are set.
 * Empty array (not an error) when unconfigured — availability is reported
 * separately via listSourceCapabilities().
 */
export function fetchLinkedInJobs(opts: { fresh?: boolean } = {}): Promise<ExternalJob[]> {
  return runApifyActorJobs(
    {
      source: "linkedin",
      label: "LinkedIn",
      actorEnvVar: "APIFY_LINKEDIN_JOBS_ACTOR",
      inputEnvVar: "APIFY_LINKEDIN_JOBS_INPUT",
      queryEnvVar: "APIFY_LINKEDIN_SEARCH_QUERY",
      locationEnvVar: "APIFY_LINKEDIN_SEARCH_LOCATION",
      defaultQuery: "software engineering internship",
    },
    opts,
  );
}

/**
 * Indeed: same pattern as LinkedIn, via APIFY_INDEED_JOBS_ACTOR. Indeed's
 * own official Publisher API is dead (see module comment) — this never
 * calls it, only a user-configured Apify actor reading public listings.
 */
export function fetchIndeedJobs(opts: { fresh?: boolean } = {}): Promise<ExternalJob[]> {
  return runApifyActorJobs(
    {
      source: "indeed",
      label: "Indeed",
      actorEnvVar: "APIFY_INDEED_JOBS_ACTOR",
      inputEnvVar: "APIFY_INDEED_JOBS_INPUT",
      queryEnvVar: "APIFY_INDEED_SEARCH_QUERY",
      locationEnvVar: "APIFY_INDEED_SEARCH_LOCATION",
      defaultQuery: "software engineering internship",
    },
    opts,
  );
}
