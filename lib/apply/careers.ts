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
import { anchorJobs, careersPageOf, careersPagesOf, findBoardRefs, findPortalLinks, pickRole, roleScore, type BoardRef, type PortalLink } from "./careers-parse";
import { boardFromUrl, boardKey, knownBoards, searchBoard, type EmployerBoard } from "./boards";

const CACHE_DIR = path.join("cache", "careers");
const FOUND_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

export type CompanyCareers = {
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

async function crawl(app: { company_name: string; company_website: string | null }): Promise<{ info: CompanyCareers; pages: SitePage[] }> {
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

const PLATFORM_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  workday: "Workday",
  successfactors: "SuccessFactors",
  smartrecruiters: "SmartRecruiters",
  icims: "iCIMS",
  ibm: "careers",
  bamboohr: "BambooHR",
  njoyn: "Njoyn",
};

/**
 * The company's Workday / SuccessFactors / SmartRecruiters sites that can be searched: the verified ones in employers.json,
 * the ones its other postings already link to, and the ones its careers site links to (`extraUrls`).
 */
async function employerBoardsFor(app: ApplicationDetail, extraUrls: string[] = []): Promise<EmployerBoard[]> {
  const boards = [...knownBoards(app.company_name)];
  try {
    const { rows } = await pool.query<{ url: string; apply_url: string | null }>(
      `SELECT url, apply_url FROM jobs WHERE company_id = $1`,
      [app.company_id],
    );
    for (const r of rows) for (const u of [r.apply_url, r.url]) if (u) boards.push(...[boardFromUrl(u)].filter((b): b is EmployerBoard => !!b));
  } catch (err) {
    // Before schema-v11.sql there is no apply_url column.
    if ((err as { code?: string }).code !== "42703") throw err;
  }
  for (const u of extraUrls) boards.push(...[boardFromUrl(u)].filter((b): b is EmployerBoard => !!b));
  return dedupe(boards, boardKey);
}

/** The role on one of those sites, or null. */
/**
 * Sites searched that answered but do not list the role, by name: a posting that is nowhere on the company's own job
 * system, while that system lists its other jobs, has most likely been filled or closed.
 */
type BoardMiss = { searched: string[]; ambiguous: string[] };

async function searchEmployerBoards(app: ApplicationDetail, boards: EmployerBoard[], miss?: BoardMiss): Promise<CareersResult | null> {
  const wanted = { title: app.title, location: app.location };
  for (const board of boards) {
    const jobs = await searchBoard(board, app.title);
    const match = pickRole(wanted, jobs);
    if (!match && jobs.length > 0) {
      // The same title listed more than once (two cities, two requisitions) is not "closed": it is a choice for a person.
      const same = jobs.filter((j) => roleScore(app.title, j.title) > 0).length;
      (same > 1 ? miss?.ambiguous : miss?.searched)?.push(PLATFORM_LABEL[board.ats] ?? board.ats);
    }
    if (match) {
      return {
        hit: { url: match.url, title: match.title, via: "board", platform: board.ats },
        careersUrl: null,
        portal: null,
        note: `Found on ${app.company_name}'s own ${PLATFORM_LABEL[board.ats]} site: "${match.title}".`,
      };
    }
  }
  return null;
}

/** Where this role is on the company's own site, and how to get there. Never throws: a lookup that fails is "not found". */
export async function findCompanyPosting(app: ApplicationDetail, opts: { fresh?: boolean } = {}): Promise<CareersResult> {
  if (off()) return { hit: null, careersUrl: null, portal: null, note: "The company careers lookup is off (CAREERS_LOOKUP=false)." };
  try {
    // The company's own job system first, when it is known: one search, no crawl.
    const miss: BoardMiss = { searched: [], ambiguous: [] };
    const known = await searchEmployerBoards(app, await employerBoardsFor(app), miss);
    if (known) return known;
    const closedNote = miss.ambiguous.length
      ? `${app.company_name}'s own ${[...new Set(miss.ambiguous)].join(" / ")} site lists this title more than once (other places or requisitions): choose the right one there yourself.`
      : miss.searched.length
        ? `Not listed on ${app.company_name}'s own ${[...new Set(miss.searched)].join(" / ")} site, which lists its other jobs: this posting is probably filled or closed.`
        : null;

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

    // The careers site links to a Workday / SuccessFactors / SmartRecruiters site not tried above: search it too.
    const tried = new Set((await employerBoardsFor(app)).map(boardKey));
    const fromSite = dedupe(info.portals.map((p) => boardFromUrl(p.url)).filter((b): b is EmployerBoard => !!b), boardKey).filter((b) => !tried.has(boardKey(b)));
    const linked = await searchEmployerBoards(app, fromSite.slice(0, 4));
    if (linked) return { ...linked, careersUrl: info.careersUrl };

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
    const boardNote =
      closedNote ?? (info.boards.length ? `The company's ${info.boards.map((b) => PLATFORM_LABEL[b.platform]).join(" / ")} board has no matching internship.` : info.note);
    return { hit: null, careersUrl: info.careersUrl, portal: account ? new URL(account.url).hostname : null, note: boardNote };
  } catch (err) {
    return { hit: null, careersUrl: null, portal: null, note: `The company careers lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * A company's careers site, read once and remembered (two weeks when something was found, a day otherwise): the job
 * boards it uses, the application systems it links to, its careers page. For a company the desk has no posting of yet
 * (lib/registry/expand.ts). Never throws: a site that cannot be read is a note.
 */
export async function companyCareers(company: { id: string; name: string; website: string | null }, opts: { fresh?: boolean } = {}): Promise<CompanyCareers> {
  const cached = opts.fresh ? null : await loadCache(company.id);
  if (cached) return cached;
  try {
    const { info } = await crawl({ company_name: company.name, company_website: company.website });
    if (info.website) await saveCache(company.id, info);
    return info;
  } catch (err) {
    return {
      checkedAt: new Date().toISOString(),
      website: null,
      careersUrl: null,
      boards: [],
      portals: [],
      note: `The careers site could not be read: ${err instanceof Error ? err.message : String(err)}`,
    };
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
