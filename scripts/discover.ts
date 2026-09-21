// Pull published job boards. Never scrape HTML, never touch a submit endpoint.
// Run once:  npx tsx scripts/discover.ts
// Loop:      npx tsx scripts/discover.ts --loop     (every four hours)
// Skip cache: npx tsx scripts/discover.ts --fresh

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { pool } from "../lib/db";
import type { WorkplaceType } from "../lib/types";

const CACHE_DIR = path.join("cache", "discover");
const CACHE_MS = 3 * 60 * 60 * 1000;
const GAP_MS = 200;
const FRESH = process.argv.includes("--fresh");
const LOOP = process.argv.includes("--loop");

type BoardCompany = {
  id: string;
  name: string;
  ats: string;
  board_token: string;
};

type NormalizedJob = {
  externalId: string;
  title: string;
  location: string | null;
  workplaceType: WorkplaceType | null;
  url: string;
  description: string | null;
  postedAt: Date | null;
};

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

function htmlToText(value: string | null | undefined): string | null {
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

function workplaceFrom(...parts: Array<string | null | undefined>): WorkplaceType | null {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (/\bremote\b|t[eé]l[eé]travail|work from home|\bwfh\b/.test(text)) return "remote";
  if (/\bhybrid\b|\bhybride\b/.test(text)) return "hybrid";
  if (/\bon-?site\b|\bonsite\b|pr[eé]sentiel|in-office/.test(text)) return "onsite";
  return null;
}

async function loadCache(key: string): Promise<unknown | null> {
  if (FRESH) return null;
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { savedAt: string; payload: unknown };
    if (Date.now() - new Date(parsed.savedAt).getTime() > CACHE_MS) return null;
    console.log(`  cache hit ${key}`);
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
    const res = await fetch(url);
    if (res.status === 429 || res.status === 503) {
      console.log(`  ${label}: ${res.status}, retry in ${wait}ms`);
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (!res.ok) throw new Error(`${label}: ${res.status}`);
    return res.json();
  }
  throw new Error(`${label}: still rate limited`);
}

async function cachedFetch(key: string, url: string, label: string): Promise<unknown> {
  const cached = await loadCache(key);
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
      [str(job.city) ?? str(locObj.city) ?? str(firstList.city),
        str(job.state) ?? str(locObj.region) ?? str(firstList.region),
        str(job.country) ?? str(locObj.country) ?? str(firstList.country)]
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
        postedAt: str(job.created_at) ?? str(job.published_on)
          ? new Date(String(str(job.created_at) ?? str(job.published_on)))
          : null,
      },
    ];
  });
}

async function fetchBoard(company: BoardCompany): Promise<NormalizedJob[]> {
  const token = company.board_token;
  const encoded = encodeURIComponent(token);

  if (company.ats === "greenhouse") {
    const payload = await cachedFetch(
      `greenhouse-${token}`,
      `https://boards-api.greenhouse.io/v1/boards/${encoded}/jobs?content=true`,
      `Greenhouse ${token}`,
    );
    return greenhouseJobs(payload);
  }

  if (company.ats === "lever") {
    const us = `https://api.lever.co/v0/postings/${encoded}?mode=json`;
    try {
      const payload = await cachedFetch(`lever-${token}`, us, `Lever ${token}`);
      return leverJobs(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("404")) throw err;
      const payload = await cachedFetch(
        `lever-eu-${token}`,
        `https://api.eu.lever.co/v0/postings/${encoded}?mode=json`,
        `Lever EU ${token}`,
      );
      return leverJobs(payload);
    }
  }

  if (company.ats === "workable") {
    // Published widget JSON, same idea as the Greenhouse/Lever boards: a read endpoint, not HTML.
    const payload = await cachedFetch(
      `workable-${token}`,
      `https://apply.workable.com/api/v1/widget/accounts/${encoded}`,
      `Workable ${token}`,
    );
    return workableJobs(payload);
  }

  return [];
}

async function upsertJob(companyId: string, job: NormalizedJob): Promise<"inserted" | "updated" | "skipped"> {
  const result = await pool.query<{ inserted: boolean }>(
    `INSERT INTO jobs (company_id, external_id, title, location, workplace_type, url, description, posted_at)
     SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::timestamptz
      WHERE (
              $3 ~* '\\mintern(s|ship|ships)?\\M'
           OR $3 ~* '\\mstage(s)?\\M'
           OR $3 ~* '\\mstagiaire(s)?\\M'
           OR $3 ~* '\\minterne(s)?\\M'
           OR $3 ~* '\\mco-?op\\M'
           OR $3 ~* '\\mcoop\\M'
            )
        AND (
              $4 IS NULL
           OR $5 = 'remote'
           OR $4 ~* 'montr|laval|vaudreuil|saint-?laurent|st[ .\\-]?laurent|qu[eé]bec|quebec'
           OR (
                $4 ~* 'canada|remote|anywhere'
            AND $4 !~* 'toronto|vancouver|calgary|ottawa|mississauga|waterloo|edmonton|winnipeg'
              )
            )
     ON CONFLICT (company_id, external_id)
     DO UPDATE SET
          last_seen_at    = now(),
          title           = EXCLUDED.title,
          location        = EXCLUDED.location,
          workplace_type  = EXCLUDED.workplace_type,
          url             = EXCLUDED.url,
          description     = EXCLUDED.description,
          posted_at       = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
          closed_at       = NULL
     RETURNING (xmax = 0) AS inserted`,
    [
      companyId,
      job.externalId,
      job.title,
      job.location,
      job.workplaceType,
      job.url,
      job.description,
      job.postedAt,
    ],
  );

  if (result.rowCount === 0) return "skipped";
  return result.rows[0].inserted ? "inserted" : "updated";
}

async function closeMissing(companyId: string, runStartedAt: Date) {
  const { rowCount } = await pool.query(
    `UPDATE jobs
        SET closed_at = now()
      WHERE company_id = $1
        AND closed_at IS NULL
        AND last_seen_at < $2
        AND external_id NOT LIKE 'manual:%'`,
    [companyId, runStartedAt],
  );
  return rowCount ?? 0;
}

async function run() {
  const runStartedAt = new Date();
  const { rows: companies } = await pool.query<BoardCompany>(
    `SELECT id, name, ats, board_token
       FROM companies
      WHERE board_token IS NOT NULL
        AND ats IN ('greenhouse', 'lever', 'workable')
      ORDER BY is_target DESC, name`,
  );

  console.log(`Discovery started ${runStartedAt.toISOString()} · ${companies.length} boards`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let closed = 0;

  for (const [i, company] of companies.entries()) {
    process.stdout.write(`${company.name} (${company.ats}/${company.board_token})… `);
    try {
      const jobs = await fetchBoard(company);
      let companyInserted = 0;
      let companyUpdated = 0;
      let companySkipped = 0;
      for (const job of jobs) {
        const outcome = await upsertJob(company.id, job);
        if (outcome === "inserted") companyInserted += 1;
        else if (outcome === "updated") companyUpdated += 1;
        else companySkipped += 1;
      }
      const companyClosed = await closeMissing(company.id, runStartedAt);
      inserted += companyInserted;
      updated += companyUpdated;
      skipped += companySkipped;
      closed += companyClosed;
      console.log(
        `${jobs.length} listed, ${companyInserted} new, ${companyUpdated} seen, ` +
          `${companySkipped} filtered, ${companyClosed} closed`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAILED (${message}) — left existing rows alone`);
    }
    if (i < companies.length - 1) await sleep(GAP_MS);
  }

  console.log(
    `Done. ${inserted} new, ${updated} refreshed, ${skipped} filtered out, ${closed} marked closed.`,
  );
}

async function main() {
  await run();
  if (!LOOP) {
    await pool.end();
    return;
  }
  console.log("Looping every four hours. Ctrl+C to stop.");
  cron.schedule("0 */4 * * *", () => {
    run().catch((err) => console.error(err));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
