// A LinkedIn (or Indeed) posting is a copy: its own "Easy Apply" needs the candidate's account, which the
// desk never uses. The role itself usually lives on the company's own careers site, so this looks it up
// there, reading only public pages and public job-board APIs:
//   1. the company's site (home, careers pages, what they link to) is read once and what it points to is
//      remembered per company for two weeks: its Greenhouse / Lever / Ashby / Workable board, or the
//      application system it uses (Workday, iCIMS... which need an account and stay manual)
//   2. the same role is looked for on that board, and in the links of the careers pages
// A match becomes jobs.apply_url, and the application goes through that form like any other portal one.
// No match is reported as such, with the careers page so the application is one click for a person.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../db";
import { Fetcher, readCompanySite, type SitePage } from "../contact-discovery";
import { hostOf, isAtsHost } from "../contact-parse";
import { fetchBoard } from "../discover-core";
import type { ApplicationDetail } from "../types";
import { anchorJobs, careersPageOf, careersPagesOf, findBoardRefs, findPortalLinks, pickRole, type BoardRef, type PortalLink } from "./careers-parse";

const CACHE_DIR = path.join("cache", "careers");
const FOUND_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

type CompanyCareers = {
  checkedAt: string;
  website: string | null;
  careersUrl: string | null;
  /** Careers pages that may list jobs themselves, read again for each role when the company has no job board. */
  listPages?: string[];
  boards: BoardRef[];
  portals: PortalLink[];
  note: string;
};

export type CareersResult = {
  /** The company's own posting for this role, when it was found. */
  hit: { url: string; title: string; via: "board" | "careers-page"; platform: string } | null;
  /** The company's careers page, when one was found. */
  careersUrl: string | null;
  /** An application system that needs an account, when that is what the careers site sends people to. */
  portal: string | null;
  note: string;
};

const off = () => process.env.CAREERS_LOOKUP?.trim().toLowerCase() === "false";

/**
 * Companies whose site could not be read a moment ago, in this process only. A company with eleven applications
 * is not crawled eleven times in a row, and the next run (or half an hour later, in `automate`) tries again.
 */
const RECENT_MISS_MS = 30 * 60 * 1000;
const recentMisses = new Map<string, { at: number; note: string }>();

async function loadCache(companyId: string): Promise<CompanyCareers | null> {
  try {
    const info = JSON.parse(await readFile(path.join(CACHE_DIR, `${companyId}.json`), "utf8")) as CompanyCareers;
    const found = info.boards.length > 0 || info.portals.length > 0 || !!info.careersUrl;
    return Date.now() - new Date(info.checkedAt).getTime() < (found ? FOUND_TTL_MS : MISS_TTL_MS) ? info : null;
  } catch {
    return null;
  }
}

async function saveCache(companyId: string, info: CompanyCareers): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${companyId}.json`), JSON.stringify(info, null, 2));
}

async function crawl(app: ApplicationDetail): Promise<{ info: CompanyCareers; pages: SitePage[] }> {
  const fetcher = new Fetcher();
  try {
    // The posting is on LinkedIn or Indeed: reading it would only read the job board, so it is left out.
    const { read, note } = await readCompanySite({ companyName: app.company_name, website: app.company_website, postingUrl: null }, fetcher);
    if (!read) {
      return {
        info: { checkedAt: new Date().toISOString(), website: null, careersUrl: null, boards: [], portals: [], note: note ?? "The company's own website could not be settled." },
        pages: [],
      };
    }
    let sitePages = read.pages;
    const firstPass = {
      boards: sitePages.flatMap((p) => findBoardRefs(p.html)),
      portals: sitePages.flatMap((p) => findPortalLinks(p.html, p.url)),
    };
    // Large companies often keep careers on a subdomain of their own that the home page only reaches through
    // scripts. Nothing found so far: try the usual ones.
    if (!careersPageOf(sitePages) && firstPass.boards.length === 0 && firstPass.portals.length === 0) {
      sitePages = [...sitePages, ...(await probeCareersSubdomains(read.website, fetcher))];
    }
    const boards = dedupe(sitePages.flatMap((p) => findBoardRefs(p.html)), (b) => `${b.platform}:${b.token.toLowerCase()}`);
    const portals = dedupe(sitePages.flatMap((p) => findPortalLinks(p.html, p.url)), (l) => l.url);
    const careersUrl = careersPageOf(sitePages) ?? subdomainCareers(sitePages, read.website) ?? portals[0]?.url ?? null;
    const summary = boards.length
      ? `Job board: ${boards.map((b) => `${b.platform}/${b.token}`).join(", ")}.`
      : portals.length
        ? `Application system: ${new URL(portals[0].url).hostname}.`
        : `No job board found on ${new URL(read.website).hostname}.`;
    const listPages = [...new Set([...careersPagesOf(sitePages), ...(careersUrl ? [careersUrl] : [])])].slice(0, 4);
    return { info: { checkedAt: new Date().toISOString(), website: read.website, careersUrl, listPages, boards, portals, note: summary }, pages: sitePages };
  } finally {
    await fetcher.close();
  }
}

const CAREERS_SUBDOMAINS = ["careers", "carrieres", "jobs", "emplois"];

/** A subdomain counts only when it stays on the company's own domain or lands on an application system. */
function ownsHost(host: string | null, apex: string): boolean {
  return !!host && (host === apex || host.endsWith(`.${apex}`) || isAtsHost(host));
}

async function probeCareersSubdomains(website: string, fetcher: Fetcher): Promise<SitePage[]> {
  const apex = hostOf(website);
  if (!apex) return [];
  const pages = await Promise.all(CAREERS_SUBDOMAINS.map((s) => fetcher.get(`https://${s}.${apex}/`)));
  return pages.filter((p): p is SitePage => !!p && ownsHost(hostOf(p.url), apex));
}

/** The careers page a subdomain probe reached, when that is the only careers page there is. */
function subdomainCareers(pages: SitePage[], website: string): string | null {
  const apex = hostOf(website);
  const hit = pages.find((p) => {
    const host = hostOf(p.url);
    return !!apex && !!host && host !== apex && CAREERS_SUBDOMAINS.some((s) => host.startsWith(`${s}.`));
  });
  return hit?.url ?? null;
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const PLATFORM_LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workable: "Workable" };

/** Where this role is on the company's own site, and how to get there. Never throws: a lookup that fails is "not found". */
export async function findCompanyPosting(app: ApplicationDetail, opts: { fresh?: boolean } = {}): Promise<CareersResult> {
  if (off()) return { hit: null, careersUrl: null, portal: null, note: "The company careers lookup is off (CAREERS_LOOKUP=false)." };
  try {
    let info = opts.fresh ? null : await loadCache(app.company_id);
    let pages: SitePage[] = [];
    if (!info) {
      const miss = opts.fresh ? undefined : recentMisses.get(app.company_id);
      if (miss && Date.now() - miss.at < RECENT_MISS_MS) return { hit: null, careersUrl: null, portal: null, note: miss.note };
      ({ info, pages } = await crawl(app));
      // Only a site that was actually read is remembered. "Could not be settled" is as likely a network hiccup as a
      // company with no site, and remembering it for long would hide the company's careers page for the next day.
      if (info.website) {
        recentMisses.delete(app.company_id);
        await saveCache(app.company_id, info);
      } else {
        recentMisses.set(app.company_id, { at: Date.now(), note: info.note });
      }
    }

    const wanted = { title: app.title, location: app.location };
    for (const ref of info.boards) {
      const jobs = await fetchBoard(
        { id: app.company_id, name: app.company_name, ats: ref.platform, board_token: ref.token },
        { fresh: opts.fresh },
      ).catch(() => []);
      const match = pickRole(wanted, jobs.map((j) => ({ title: j.title, url: j.url, location: j.location })));
      if (match) {
        return {
          hit: { url: match.url, title: match.title, via: "board", platform: ref.platform },
          careersUrl: info.careersUrl,
          portal: null,
          note: `Found on ${app.company_name}'s own ${PLATFORM_LABEL[ref.platform]} board (${ref.token}): "${match.title}".`,
        };
      }
    }

    // A company with no board may list its jobs as links on the careers pages: read them (again, when remembered).
    if (!pages.length && info.boards.length === 0 && info.listPages?.length) {
      const fetcher = new Fetcher();
      try {
        pages = (await Promise.all(info.listPages.map((u) => fetcher.get(u)))).filter((p): p is SitePage => !!p);
      } finally {
        await fetcher.close();
      }
    }
    if (pages.length) {
      const match = pickRole(wanted, anchorJobs(pages, app.title).map((j) => ({ ...j, location: null })));
      if (match) {
        return {
          hit: { url: match.url, title: match.title, via: "careers-page", platform: "company" },
          careersUrl: info.careersUrl,
          portal: null,
          note: `Found on ${app.company_name}'s careers page: "${match.title}".`,
        };
      }
    }

    const account = info.portals.find((p) => p.account);
    const boardNote = info.boards.length ? `The company's ${info.boards.map((b) => PLATFORM_LABEL[b.platform]).join(" / ")} board has no matching internship.` : info.note;
    return { hit: null, careersUrl: info.careersUrl, portal: account ? new URL(account.url).hostname : null, note: boardNote };
  } catch (err) {
    return { hit: null, careersUrl: null, portal: null, note: `The company careers lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Keeps the company's own posting on the job, so every later step (plan, route, submit) uses it. */
export async function saveCompanyPosting(jobId: string, url: string): Promise<void> {
  try {
    await pool.query(`UPDATE jobs SET apply_url = $2 WHERE id = $1 AND apply_url IS NULL`, [jobId, url]);
  } catch (err) {
    // Before schema-v11.sql there is no apply_url column.
    if ((err as { code?: string }).code !== "42703") throw err;
  }
}
