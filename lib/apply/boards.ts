// Employer job systems with a public search, read to find the company's own copy of a LinkedIn / Indeed posting (the
// idea of ApplyPilot's employers.yaml, here with each entry checked against its public API):
//   - Workday:        POST https://{host}/wday/cxs/{tenant}/{site}/jobs  {searchText}  → title, externalPath, place
//   - SuccessFactors: https://{host}/services/rss/job/?locale=..&keywords=(..)         → RSS items (title, link)
//   - SmartRecruiters: https://api.smartrecruiters.com/v1/companies/{id}/postings?q=..  → postings
//   - iCIMS:          https://{host}/jobs/search?ss=1&searchKeyword=..&in_iframe=1          → job links
//   - IBM:            POST https://www-api.ibm.com/search/api/v2 (its careers site's own search) → postings
// Which system a company uses comes from employers.json (verified by hand), from the company's other postings whose
// link already leads to one, and from the links its careers site shows. Only public endpoints, through safeFetch.

import employersFile from "../../employers.json";
import { safeFetch } from "../net-guard";
import { htmlToText } from "../discover-core";
import { norm } from "./text";
import type { ListedJob } from "./careers-parse";

export type EmployerBoard =
  | { ats: "workday"; host: string; tenant: string; site: string }
  | { ats: "successfactors"; host: string; locale: string }
  | { ats: "smartrecruiters"; company: string }
  | { ats: "icims"; host: string }
  | { ats: "ibm"; host: string };

type EmployerEntry = { name: string; aliases?: string[] } & EmployerBoard;

const EMPLOYERS = (employersFile as { employers: EmployerEntry[] }).employers;

const HEADERS = { "user-agent": "InternshipDesk/0.1 (+public job search)", accept: "application/json, application/rss+xml, text/xml, */*" };

const nameKey = (s: string) => norm(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\b(inc|ltd|ltee|llc|corp|corporation|canada|group|groupe)\b/g, " ").replace(/\s+/g, " ").trim();

/** The verified boards of a company in employers.json, by its name or an alias. */
export function knownBoards(companyName: string): EmployerBoard[] {
  const key = nameKey(companyName);
  return EMPLOYERS.filter((e) => [e.name, ...(e.aliases ?? [])].some((n) => nameKey(n) === key)).map((e) => {
    const board: Partial<EmployerEntry> = { ...e };
    delete board.name;
    delete board.aliases;
    return board as EmployerBoard;
  });
}

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** The board a posting link belongs to, when it is one of the systems above: "autodesk.wd1.myworkdayjobs.com/en-US/Ext/job/..." → Workday autodesk/Ext. */
export function boardFromUrl(raw: string): EmployerBoard | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const wd = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkday(?:jobs|site)\.com$/);
  if (wd) {
    const site = parts.find((p) => !LOCALE.test(p) && p !== "wday" && p !== "cxs");
    return site && site !== "job" ? { ats: "workday", host, tenant: wd[1], site } : null;
  }
  if (/^[a-z0-9-]+\.icims\.com$/.test(host) && !/^(www|login|developer)\./.test(host)) return { ats: "icims", host };
  if (host === "careers.ibm.com") return { ats: "ibm", host };
  const sr = host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com" ? parts[0] : null;
  if (sr) return { ats: "smartrecruiters", company: sr };
  // A SuccessFactors career site: /job/<place-title>/<number>/ on the company's own host.
  if (parts[0] === "job" && /^\d{6,}$/.test(parts[parts.length - 1] ?? "")) {
    return { ats: "successfactors", host, locale: url.searchParams.get("locale") ?? "en_US" };
  }
  return null;
}

export function boardKey(b: EmployerBoard): string {
  if (b.ats === "workday") return `workday:${b.host}/${b.site}`;
  if (b.ats === "smartrecruiters") return `sr:${b.company.toLowerCase()}`;
  return `${b.ats}:${b.host}`;
}

/** What to search a board for: the role's words without the internship and season noise, which every posting shares. */
export function searchText(title: string): string {
  return norm(title)
    .replace(/[^a-z0-9+# ]+/g, " ")
    .replace(/\b(intern(ship)?|stage|stagiaire|co ?op|coop|student|etudiant|winter|summer|fall|hiver|ete|automne|20\d\d|i{1,3}|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

async function workday(b: Extract<EmployerBoard, { ats: "workday" }>, query: string): Promise<ListedJob[]> {
  // safeFetch reads GETs; Workday's search is a POST, so it is called directly after the same public-address check.
  const { assertPublicUrl } = await import("../net-guard");
  const endpoint = await assertPublicUrl(`https://${b.host}/wday/cxs/${encodeURIComponent(b.tenant)}/${encodeURIComponent(b.site)}/jobs`);
  const res = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: { ...HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: query }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Workday ${b.tenant}/${b.site}: HTTP ${res.status}`);
  const data = (await res.json()) as { jobPostings?: Array<{ title?: string; externalPath?: string; locationsText?: string }> };
  return (data.jobPostings ?? [])
    .filter((j) => j.title && j.externalPath)
    // "8 Locations" names no place: the posting is then trusted only on an exact title (pickRole's rule for no place).
    .map((j) => ({
      title: j.title!,
      url: `https://${b.host}/${b.site}${j.externalPath}`,
      location: j.locationsText && !/^\d+\s+(locations?|emplacements?|lieux)$/i.test(j.locationsText.trim()) ? j.locationsText : null,
    }));
}

const decodeXml = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** The jobs of an RSS feed (SuccessFactors' keyword feed and its sitemap.xml share the shape). */
function rssJobs(xml: string): ListedJob[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.flatMap((item) => {
    const title = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").trim();
    const link = decodeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    if (!title || !link) return [];
    let clean: URL;
    try {
      clean = new URL(link);
    } catch {
      return [];
    }
    for (const k of [...clean.searchParams.keys()]) if (/^(utm_|feedId)/i.test(k)) clean.searchParams.delete(k);
    // "Title (City, Province, CA, Postal)": the place is the last parenthesis.
    const place = title.match(/\(([^()]*)\)\s*$/)?.[1] ?? null;
    const fromPath = decodeURIComponent(clean.pathname.split("/")[2] ?? "").replace(/-/g, " ");
    return [{ title: place ? title.replace(/\s*\([^()]*\)\s*$/, "") : title, url: clean.toString(), location: place ?? (htmlToText(fromPath) || null) }];
  });
}

/** Every job of a SuccessFactors site, from its sitemap.xml (an RSS of all open jobs), kept for 30 minutes per host. */
const fullFeeds = new Map<string, { at: number; jobs: ListedJob[] }>();
async function successfactorsAll(b: Extract<EmployerBoard, { ats: "successfactors" }>): Promise<ListedJob[] | null> {
  const cached = fullFeeds.get(b.host);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.jobs;
  const res = await safeFetch(`https://${b.host}/sitemap.xml`, { headers: HEADERS, timeoutMs: 25_000, maxBytes: 8_000_000 }).catch(() => null);
  if (!res?.ok || !/<rss\b/i.test(res.text)) return null;
  const jobs = rssJobs(res.text);
  if (jobs.length === 0) return null;
  fullFeeds.set(b.host, { at: Date.now(), jobs });
  return jobs;
}

async function successfactors(b: Extract<EmployerBoard, { ats: "successfactors" }>, query: string): Promise<ListedJob[]> {
  const url = `https://${b.host}/services/rss/job/?locale=${encodeURIComponent(b.locale)}&keywords=(${encodeURIComponent(query)})`;
  const res = await safeFetch(url, { headers: HEADERS, timeoutMs: 15_000, maxBytes: 3_000_000 });
  if (!res.ok || !/<rss\b/i.test(res.text)) throw new Error(`SuccessFactors ${b.host}: no job feed`);
  return rssJobs(res.text);
}

async function smartrecruiters(b: Extract<EmployerBoard, { ats: "smartrecruiters" }>, query: string): Promise<ListedJob[]> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.company)}/postings?limit=50&q=${encodeURIComponent(query)}`;
  const res = await safeFetch(url, { headers: HEADERS, timeoutMs: 15_000 });
  if (!res.ok) throw new Error(`SmartRecruiters ${b.company}: HTTP ${res.status}`);
  const data = JSON.parse(res.text) as { content?: Array<{ id?: string; name?: string; location?: { city?: string; region?: string; country?: string } }> };
  return (data.content ?? [])
    .filter((p) => p.id && p.name)
    .map((p) => ({
      title: p.name!,
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(b.company)}/${p.id}`,
      location: [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(", ") || null,
    }));
}

async function icims(b: Extract<EmployerBoard, { ats: "icims" }>, query: string): Promise<ListedJob[]> {
  const url = `https://${b.host}/jobs/search?ss=1&searchKeyword=${encodeURIComponent(query)}&in_iframe=1`;
  const res = await safeFetch(url, { headers: { ...HEADERS, accept: "text/html" }, timeoutMs: 20_000, maxBytes: 3_000_000 });
  if (!res.ok) throw new Error(`iCIMS ${b.host}: HTTP ${res.status}`);
  const out = new Map<string, ListedJob>();
  // Each job: a link /jobs/<id>/<slug>/job and a title attribute "<id> - <Title>".
  for (const m of res.text.matchAll(/href="(https:\/\/[^"]+\/jobs\/(\d+)\/[^"]+\/job)[^"]*"/g)) {
    const id = m[2];
    const title = decodeXml(res.text.match(new RegExp(`title="${id} - ([^"]+)"`))?.[1] ?? "").trim();
    if (title && !out.has(id)) out.set(id, { title, url: m[1], location: null });
  }
  return [...out.values()];
}

async function ibm(b: Extract<EmployerBoard, { ats: "ibm" }>, query: string): Promise<ListedJob[]> {
  const { assertPublicUrl } = await import("../net-guard");
  const endpoint = await assertPublicUrl("https://www-api.ibm.com/search/api/v2");
  const res = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: { ...HEADERS, "content-type": "application/json" },
    body: JSON.stringify({
      appId: "careers",
      scopes: ["careers2"],
      query: { bool: { must: [{ simple_query_string: { query, fields: ["title^3", "description^2", "keywords^1", "body^1"] } }] } },
      size: 50,
      sort: [{ _score: "desc" }],
      lang: "zz",
      localeSelector: {},
      sm: { query, lang: "zz" },
      _source: ["_id", "title", "url", "field_keyword_19", "field_keyword_17"],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`IBM careers: HTTP ${res.status}`);
  const data = (await res.json()) as { hits?: { hits?: Array<{ _source?: { title?: string; url?: string; field_keyword_19?: string; field_keyword_17?: string } }> } };
  return (data.hits?.hits ?? [])
    .map((h) => h._source ?? {})
    .filter((s) => s.title && s.url && new URL(s.url).hostname === b.host)
    .map((s) => ({ title: s.title!, url: s.url!, location: s.field_keyword_19 ?? s.field_keyword_17 ?? null }));
}

/** Jobs on the board that answer the search (the role's own words). Never throws: a board that does not answer is empty. */
export async function searchBoard(board: EmployerBoard, title: string): Promise<ListedJob[]> {
  const query = searchText(title) || title;
  try {
    if (board.ats === "workday") {
      // A long search can come back empty: the internship word alone is searched too, and the two lists merged.
      const word = /(stage|stagiaire)/i.test(title) ? "stage" : /co.?op/i.test(title) ? "co-op" : "intern";
      const [a, b] = await Promise.all([workday(board, query).catch(() => []), workday(board, word).catch(() => [])]);
      const seen = new Set<string>();
      return [...a, ...b].filter((j) => !seen.has(j.url) && !!seen.add(j.url));
    }
    if (board.ats === "successfactors") {
      // The whole site at once when it publishes its sitemap feed (Hydro-Québec: every job, not the first 20).
      const all = await successfactorsAll(board);
      if (all) return all;
      // Otherwise its keyword search, which is loose and holds 20 jobs: the internship word itself ("stage", "intern") is
      // searched too, so a posting the first search ranks past 20 is still seen.
      const word = /\b(stage|stagiaire)\b/i.test(title) ? "stage" : /co.?op/i.test(title) ? "co-op" : "intern";
      const [a, b] = await Promise.all([successfactors(board, query).catch(() => []), successfactors(board, word).catch(() => [])]);
      const seen = new Set<string>();
      return [...a, ...b].filter((j) => !seen.has(j.url) && !!seen.add(j.url));
    }
    if (board.ats === "icims") return await icims(board, query);
    if (board.ats === "ibm") return await ibm(board, query);
    return await smartrecruiters(board, query);
  } catch {
    return [];
  }
}
