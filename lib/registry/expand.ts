// New companies, every day. Two ways in:
//   1. freehire's index of company careers boards (lib/registry/freehire.ts): the internships posted around here in the
//      last days, each one naming its company and linking to the company's own job system. A company the desk did not
//      know is added, and so is its board, which the daily crawl then reads every day.
//   2. the companies the desk knows without a board (found through LinkedIn, Indeed, a job-board copy on freehire, or added
//      by hand): their own site is read once for its careers board (lib/apply/careers.ts), a few each day.
// Plus, each time, the boards the desk already knew before the registry (seed/companies.ts and employers.json).

import { htmlToText, isInternshipTitle, workplaceFrom } from "../discover-core";
import { isJobBoardUrl } from "../apply/apply-url";
import { companyCareers } from "../apply/careers";
import { upsertJob } from "../job-store";
import { boardFromLink, cleanLink, isApiBoard, isPageBoard, postingKey, registryKey, type RegistryBoard } from "./board-ref";
import { fetchFreehireInternships, type FreehireJob } from "./freehire";
import { backfillRegistry, boardOwner, CompanyIndex, companiesToLookUp, isPlaceholderCompany, markCareersChecked, registerBoard } from "./store";
import { fitsWhere } from "./where";

/** Feeds that republish other sites' postings: their link is not the company's careers page. */
const AGGREGATOR = /whatjobs|jobstash|jobgether|adzuna|himalayas|jobtech|trudvsem|arbeitsagentur|telegram|remotive|remoteok|glassdoor|jooble|talent\.com|careerjet|eluta|workopolis|jobbank|guichet|simplyhired|ziprecruiter|monster|builtin|wellfound|otta|welcometothejungle/i;

export type ExpandSummary = {
  backfill: { boards: number; companies: number };
  freehire: { fetched: number; aroundHere: number; jobs: number; error: string | null };
  lookups: { checked: number; boards: number; careersPages: number };
  newCompanies: string[];
  newBoards: number;
};

function placeOf(job: FreehireJob): string {
  return [job.location, ...job.cities].filter(Boolean).join(", ");
}

/** freehire's posting comes straight from the company's careers board (not from a job board that copied it). */
function isDirect(job: FreehireJob, link: string): boolean {
  if (AGGREGATOR.test(job.source) || isJobBoardUrl(link)) return false;
  try {
    return !AGGREGATOR.test(new URL(link).hostname);
  } catch {
    return false;
  }
}

async function fromFreehire(index: CompanyIndex, summary: ExpandSummary, withinDays: number, log: (line: string) => void): Promise<void> {
  let jobs: FreehireJob[];
  try {
    jobs = await fetchFreehireInternships({ withinDays });
  } catch (err) {
    summary.freehire.error = err instanceof Error ? err.message : String(err);
    log(`freehire: ${summary.freehire.error}`);
    return;
  }
  summary.freehire.fetched = jobs.length;
  for (const job of jobs) {
    if (!fitsWhere(placeOf(job), job.workMode) || !isInternshipTitle(job.title)) continue;
    summary.freehire.aroundHere += 1;
    const link = cleanLink(job.url);
    const board: RegistryBoard | null = boardFromLink(link);
    // A job aggregator's own board on a real ATS (Lever "jobgether") is not an employer's careers board.
    if (board && AGGREGATOR.test(registryKey(board))) continue;
    // The same board found again is the same company, whatever name freehire gives it ("Cadence" / "Cadence Design Systems").
    const owner = board ? await boardOwner(board) : null;
    // "Confidential", a feed's own name, a Workday sandbox: not an employer to add.
    if (!owner && isPlaceholderCompany(job.company)) continue;
    const company = owner ? { id: owner, created: false } : await index.ensure(job.company, "freehire");
    if (company.created) summary.newCompanies.push(job.company);
    if (board && (await registerBoard(company.id, board, "freehire"))) summary.newBoards += 1;

    // A job board with an API is read in full by the crawl, which finds this posting too, with its whole text. An employer
    // system or a careers site is searched, which can miss one: freehire's copy is kept, under the same id the crawl uses.
    if (!isDirect(job, link) || (board && isApiBoard(board))) continue;
    const outcome = await upsertJob(company.id, {
      externalId: postingKey(link),
      title: job.title,
      location: job.location ?? (job.cities.join(", ") || null),
      workplaceType: job.workMode === "remote" || job.workMode === "hybrid" || job.workMode === "onsite" ? job.workMode : workplaceFrom(job.location),
      url: link,
      description: htmlToText(job.description),
      postedAt: job.postedAt,
      source: job.source,
    });
    if (outcome === "inserted") summary.freehire.jobs += 1;
  }
}

/** Reads the careers site of companies with no board yet, two at a time (a site that only renders in a browser opens one). */
async function lookUpCareers(limit: number, summary: ExpandSummary, log: (line: string) => void): Promise<void> {
  const companies = await companiesToLookUp(limit);
  let next = 0;
  const worker = async () => {
    while (next < companies.length) {
      const company = companies[next++];
      const info = await companyCareers(company);
      summary.lookups.checked += 1;
      let found = 0;
      for (const ref of info.boards) {
        if (await registerBoard(company.id, { platform: ref.platform, config: { token: ref.token } }, "careers-site", info.careersUrl)) found += 1;
      }
      for (const portal of info.portals) {
        const board = boardFromLink(portal.url);
        if (board && !isPageBoard(board) && (await registerBoard(company.id, board, "careers-site", info.careersUrl))) found += 1;
      }
      // No board at all: the careers page itself is read (its JobPosting data and job links).
      if (!found && info.boards.length === 0 && info.careersUrl) {
        if (await registerBoard(company.id, { platform: "careers-page", config: { url: info.careersUrl } }, "careers-site", info.careersUrl)) {
          summary.lookups.careersPages += 1;
        }
      }
      summary.lookups.boards += found;
      summary.newBoards += found;
      await markCareersChecked(company.id, info.careersUrl, info.note, info.website);
      log(`${company.name}: ${found ? `${found} board(s)` : info.careersUrl ? `careers page ${info.careersUrl}` : info.note}`);
    }
  };
  await Promise.all([worker(), worker()]);
}

export async function expandRegistry(opts: { withinDays: number; lookups: number; log?: (line: string) => void }): Promise<ExpandSummary> {
  const log = opts.log ?? (() => undefined);
  const index = await CompanyIndex.load();
  const summary: ExpandSummary = {
    backfill: await backfillRegistry(index),
    freehire: { fetched: 0, aroundHere: 0, jobs: 0, error: null },
    lookups: { checked: 0, boards: 0, careersPages: 0 },
    newCompanies: [],
    newBoards: 0,
  };
  summary.newBoards += summary.backfill.boards;
  await fromFreehire(index, summary, opts.withinDays, log);
  if (opts.lookups > 0) await lookUpCareers(opts.lookups, summary, log);
  return summary;
}
