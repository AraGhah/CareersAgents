// Reads every careers board in the registry and keeps their internships as jobs (freehire's run-once crawler, jobseek's
// monitors): a board's API when it has one, the employer system's own search otherwise, and the careers page itself for a
// company with neither. Re-reading is free: a posting already known only has its last_seen_at moved (upsertJob).

import { fetchBoard, htmlToText, isInternshipTitle, workplaceFrom, type NormalizedJob } from "../discover-core";
import { searchBoard, type EmployerBoard } from "../apply/boards";
import { safeFetch } from "../net-guard";
import { pool } from "../db";
import { upsertJob } from "../job-store";
import { isApiBoard, isPageBoard, postingKey, type RegistryBoard } from "./board-ref";
import { jsonLdJobs, pageJobs } from "./jsonld";
import { dueBoards, recordCrawl, type BoardRow } from "./store";

const HEADERS = { "user-agent": "InternshipDesk/0.1 (+public job search)", accept: "text/html,application/json;q=0.9,*/*;q=0.8" };

/** What an employer system is searched for: its internships, in both languages. */
const SEARCH_WORDS = ["intern", "stage", "stagiaire", "co-op"];

export type CrawlSummary = {
  boards: number;
  ok: number;
  failed: number;
  inserted: number;
  updated: number;
  skipped: number;
  described: number;
  errors: string[];
};

function asBoard(row: BoardRow): RegistryBoard {
  return { platform: row.platform, config: row.config } as RegistryBoard;
}

/** The internships an employer system lists, from one search per internship word. */
async function searchedJobs(board: EmployerBoard): Promise<NormalizedJob[]> {
  const seen = new Map<string, NormalizedJob>();
  for (const word of board.ats === "successfactors" ? ["intern"] : SEARCH_WORDS) {
    for (const j of await searchBoard(board, word)) {
      if (!isInternshipTitle(j.title)) continue;
      const key = postingKey(j.url);
      if (seen.has(key)) continue;
      seen.set(key, {
        externalId: key,
        title: j.title,
        location: j.location ?? null,
        workplaceType: workplaceFrom(j.location),
        url: j.url,
        description: null,
        postedAt: null,
        source: board.ats,
      });
    }
  }
  return [...seen.values()];
}

async function pageJobsOf(url: string): Promise<NormalizedJob[]> {
  const res = await safeFetch(url, { headers: HEADERS, timeoutMs: 20_000, maxBytes: 4_000_000 });
  if (!res.ok) throw new Error(`careers page: HTTP ${res.status}`);
  return pageJobs(res.text, res.url).map((j) => ({
    // A posting listed on the page itself has no link of its own: its title tells it apart.
    externalId: j.url === res.url ? `${postingKey(j.url)}#${j.title.toLowerCase()}` : postingKey(j.url),
    title: j.title,
    location: j.location,
    workplaceType: j.remote ? "remote" : workplaceFrom(j.location),
    url: j.url,
    description: j.description,
    postedAt: j.postedAt,
    source: "careers-page",
  }));
}

/** Every job a board lists (the API boards return all of them; upsertJob keeps the internships around here). */
export async function jobsOfBoard(row: BoardRow, opts: { fresh?: boolean } = {}): Promise<NormalizedJob[]> {
  const board = asBoard(row);
  if (isApiBoard(board)) {
    return fetchBoard({ id: row.company_id, name: row.company_name, ats: board.platform, board_token: board.config.token }, opts);
  }
  if (isPageBoard(board)) return pageJobsOf(board.config.url);
  return searchedJobs(board.config);
}

/**
 * The text of a posting that arrived without one, so it can be matched against the CV: Workday's own job API, or the
 * JobPosting data (else the readable text) of the posting page. Null when neither gives a real description.
 */
export async function describePosting(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    const wd = u.hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkday(?:jobs|site)\.com$/i);
    if (wd) {
      const parts = u.pathname.split("/").filter(Boolean).filter((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
      const [site, ...rest] = parts;
      if (site && rest[0] === "job") {
        const res = await safeFetch(`https://${u.hostname}/wday/cxs/${wd[1]}/${site}/${rest.join("/")}`, { headers: { ...HEADERS, accept: "application/json" }, timeoutMs: 15_000 });
        if (res.ok) {
          const info = (JSON.parse(res.text) as { jobPostingInfo?: { jobDescription?: string } }).jobPostingInfo;
          const text = htmlToText(info?.jobDescription ?? null);
          if (text && text.length > 200) return text;
        }
      }
    }
    const res = await safeFetch(url, { headers: HEADERS, timeoutMs: 15_000, maxBytes: 3_000_000 });
    if (!res.ok) return null;
    const fromLd = jsonLdJobs(res.text, res.url).find((j) => (j.description?.length ?? 0) > 200)?.description;
    if (fromLd) return fromLd;
    const main = res.text.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? res.text.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? "";
    const text = htmlToText(main.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi, " "));
    return text && text.length > 400 ? text.slice(0, 20_000) : null;
  } catch {
    return null;
  }
}

/** Fills the text of open internships that have none and came from a careers board (LinkedIn/Indeed copies are left to their twins). */
async function describeMissing(limit: number): Promise<number> {
  const { rows } = await pool.query<{ id: string; url: string }>(
    `SELECT id, url FROM jobs
      WHERE closed_at IS NULL AND description IS NULL AND COALESCE(source, '') NOT IN ('linkedin', 'indeed')
      ORDER BY first_seen_at DESC LIMIT $1`,
    [limit],
  );
  let filled = 0;
  for (const r of rows) {
    const text = await describePosting(r.url);
    if (!text) continue;
    await pool.query(`UPDATE jobs SET description = $2 WHERE id = $1 AND description IS NULL`, [r.id, text]);
    filled += 1;
  }
  return filled;
}

/**
 * Reads every active board not read in the last `maxAgeHours`, a few at a time, and stores what they list. A board that
 * fails is counted (and retired after repeated failures, lib/registry/store.ts), never fatal to the others.
 */
export async function crawlRegistry(opts: { maxAgeHours: number; fresh?: boolean; concurrency?: number; log?: (line: string) => void }): Promise<CrawlSummary> {
  const log = opts.log ?? (() => undefined);
  const boards = await dueBoards(opts.maxAgeHours);
  const summary: CrawlSummary = { boards: boards.length, ok: 0, failed: 0, inserted: 0, updated: 0, skipped: 0, described: 0, errors: [] };
  let next = 0;
  const worker = async () => {
    while (next < boards.length) {
      const row = boards[next++];
      try {
        const jobs = await jobsOfBoard(row, { fresh: opts.fresh });
        let matches = 0;
        for (const job of jobs) {
          const outcome = await upsertJob(row.company_id, job);
          summary[outcome] += 1;
          if (outcome !== "skipped") matches += 1;
        }
        await recordCrawl(row.id, { ok: true, jobs: jobs.length, matches });
        summary.ok += 1;
        if (matches) log(`${row.company_name} (${row.platform}): ${matches} internship(s) around here of ${jobs.length} listed`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordCrawl(row.id, { ok: false, error: message });
        summary.failed += 1;
        summary.errors.push(`${row.company_name} (${row.platform}): ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  summary.described = await describeMissing(60);
  return summary;
}
