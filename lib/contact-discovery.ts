import path from "node:path";
import type { Browser } from "playwright";
import {
  CANDIDATE_PATHS,
  companySiteFromPosting,
  corroboratesCompany,
  extractEmails,
  hostCarriesName,
  hostOf,
  linkTargets,
  looksLikeJsShell,
  metaRefreshTarget,
  nameDomainCandidates,
  pageMatchesCompany,
  rankFoundEmails,
  strongHostMatch,
  type ContactKind,
  type FoundEmail,
} from "./contact-parse";
import { addVerifiedContact, listContactsForCompany, setCompanyWebsite } from "./queries";
import type { ApplicationDetail } from "./types";
import { BlockedUrlError, assertPublicUrl, blockPrivateNetwork, safeFetch } from "./net-guard";

// Finds where to send an application. It reads the company's own public pages (home, careers, contact,
// the pages those link to, and the job posting itself) and keeps addresses those pages publish. It never
// builds an address from a pattern, and it stores where each one was found.
//
// Many company sites turn away anything that is not a browser (Intact answers a plain request with 405, Ericsson
// with 403), and many draw their pages with JavaScript, so a plain request sees nothing. When that happens
// the page is opened in a headless browser instead, a few pages per company at most.

// Looks like a browser to sites that refuse unknown clients, and still says who it is.
const BROWSER_UA =
  "Mozilla/5.0 (compatible; InternshipDesk/0.1; +public contact lookup) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 8000;
const MAX_PAGES = 16;
/** Pages opened in a browser per company, and the time all of them together may take. */
const MAX_RENDERS = 6;
const RENDER_BUDGET_MS = 25_000;
/** The whole search for one company stops starting new pages after this; it runs while someone waits on a button. */
const SEARCH_BUDGET_MS = 40_000;

type Page = { url: string; html: string };

/** A page read from a company's site: where it ended up and its HTML. */
export type SitePage = Page;

type Plain = { page: Page | null; blocked: boolean };

/** Errors that mean "nothing lives here", as opposed to "this site will not talk to a script". */
const NO_SUCH_SITE = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"]);

async function fetchPlain(url: string, hops = 0): Promise<Plain> {
  try {
    // Company sites come from scraped listings: each hop must be a public address, and the body is capped.
    const res = await safeFetch(url, {
      headers: { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-CA,en;q=0.9,fr;q=0.8" },
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: 800_000,
    });
    if (!res.ok) return { page: null, blocked: [403, 405, 406, 429, 451, 503].includes(res.status) };
    if (!/html|xml/i.test(res.headers.get("content-type") ?? "")) return { page: null, blocked: false };
    const page = { url: res.url || url, html: res.text };
    // A one-line "Redirection" page (hydroquebec.com) points at the real one.
    const hop = hops < 2 && page.html.length < 4000 ? metaRefreshTarget(page.html, page.url) : null;
    if (hop && hop !== page.url) {
      const next = await fetchPlain(hop, hops + 1);
      if (next.page) return next;
    }
    return { page, blocked: false };
  } catch (err) {
    // A private or local address is "nothing lives here", never a reason to try the browser instead.
    if (err instanceof BlockedUrlError) return { page: null, blocked: false };
    const code = (err as { cause?: { code?: string } })?.cause?.code ?? "";
    return { page: null, blocked: !NO_SUCH_SITE.has(code) };
  }
}

/** A headless browser, started the first time it is needed and closed when the search ends. */
class Renderer {
  private browser: Browser | null = null;
  private used = 0;
  private active = 0;
  private readonly deadline = Date.now() + RENDER_BUDGET_MS;

  private async gate() {
    while (this.active >= 2) await new Promise((r) => setTimeout(r, 150));
    this.active += 1;
  }

  async render(url: string): Promise<Page | null> {
    if (this.used >= MAX_RENDERS || Date.now() > this.deadline) return null;
    if (!(await assertPublicUrl(url).then(() => true, () => false))) return null;
    this.used += 1;
    await this.gate();
    try {
      if (!this.browser) {
        if (process.env.LOCALAPPDATA) process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(process.env.LOCALAPPDATA, "ms-playwright");
        const { chromium } = await import("playwright");
        this.browser = await chromium.launch({ headless: true });
      }
      const context = await this.browser.newContext({
        userAgent: BROWSER_UA.replace("(compatible; InternshipDesk/0.1; +public contact lookup) ", "(Windows NT 10.0; Win64; x64) "),
        locale: "en-CA",
      });
      try {
        await blockPrivateNetwork(context);
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
        return { url: page.url(), html: (await page.content()).slice(0, 800_000) };
      } finally {
        await context.close();
      }
    } catch {
      return null;
    } finally {
      this.active -= 1;
    }
  }

  async close() {
    await this.browser?.close().catch(() => undefined);
  }
}

/**
 * Fetches pages: plainly first, and in the headless browser when the site refuses scripts or draws its
 * content with JavaScript. Once a host has refused a plain request, its other pages go straight to the browser.
 */
export class Fetcher {
  private renderer = new Renderer();
  private refusing = new Set<string>();
  private readonly deadline = Date.now() + SEARCH_BUDGET_MS;

  async get(url: string): Promise<Page | null> {
    if (Date.now() > this.deadline) return null;
    const host = hostOf(url) ?? "";
    if (this.refusing.has(host)) return this.renderer.render(url);

    const plain = await fetchPlain(url);
    if (plain.blocked && host) this.refusing.add(host);
    if (plain.page && !looksLikeJsShell(plain.page.html)) return plain.page;
    if (plain.blocked || plain.page) return (await this.renderer.render(url)) ?? plain.page;
    return null;
  }

  async close() {
    await this.renderer.close();
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export type WebsiteSource = "stored" | "posting" | "guess";

type Candidate = { website: string; source: WebsiteSource; home: Page };

/**
 * The websites this company could have, most trusted first. A stored one is the only candidate. Otherwise
 * the job posting's site, when the posting is not on an application system, and then every domain
 * guessed from the name that returns a page which is really this company's (title or site name, or a
 * domain carrying every word of a multi-word name, and always a domain carrying the whole name). Guesses
 * still have to be corroborated by what is on their pages.
 */
async function websiteCandidates(
  opts: { companyName: string; website: string | null; postingUrl: string | null },
  fetcher: Fetcher,
): Promise<Candidate[]> {
  const origin = (page: Page) => new URL(page.url).origin;

  if (opts.website) {
    const url = opts.website.includes("://") ? opts.website : `https://${opts.website}`;
    const home = await fetcher.get(url);
    return home ? [{ website: origin(home), source: "stored", home }] : [];
  }

  const out: Candidate[] = [];
  const fromPosting = companySiteFromPosting(opts.postingUrl);
  if (fromPosting) {
    const home = await fetcher.get(fromPosting);
    if (home && (pageMatchesCompany(home.html, opts.companyName) || strongHostMatch(home.url, opts.companyName))) {
      out.push({ website: origin(home), source: "posting", home });
    }
  }

  const guesses = await mapLimit(nameDomainCandidates(opts.companyName), 4, (url) => fetcher.get(url));
  for (const page of guesses) {
    if (!page || !hostCarriesName(page.url, opts.companyName)) continue;
    if (!pageMatchesCompany(page.html, opts.companyName) && !strongHostMatch(page.url, opts.companyName)) continue;
    if (!out.some((c) => c.website === origin(page))) out.push({ website: origin(page), source: "guess", home: page });
  }
  return out;
}

export type Discovery = {
  website: string | null;
  websiteSource: WebsiteSource | null;
  pagesScanned: string[];
  found: FoundEmail[];
  /** Why a guessed website was set aside, when it was. */
  note?: string;
};

/**
 * The pages worth reading on a site, in the order they are likely to matter: the links the home page
 * itself offers to careers, students and contact (real pages), the job posting, then the usual paths
 * (mostly guesses that turn out to be 404s), and finally the links found on the careers and contact pages
 * just read, since the student-employment page is often one click below "Careers" (CAE's is).
 */
async function readSite(home: Page, postingUrl: string | null, fetcher: Fetcher): Promise<Page[]> {
  const base = new URL(home.url);
  const seen = new Set<string>([home.url]);
  const pages: Page[] = [home];
  const readAll = async (urls: string[]) => {
    const fresh = [...new Set(urls)].filter((u) => !seen.has(u));
    fresh.forEach((u) => seen.add(u));
    for (const page of await mapLimit(fresh, 5, (url) => fetcher.get(url))) {
      if (page && !pages.some((p) => p.url === page.url)) pages.push(page);
    }
  };

  await readAll(
    [
      ...linkTargets(home.html, home.url, 8),
      ...(postingUrl ? [postingUrl] : []),
      ...CANDIDATE_PATHS.map((p) => new URL(p, base.origin).toString()),
    ].slice(0, MAX_PAGES),
  );

  const deeper = pages
    .filter((p) => p !== home && /career|carri|jobs|emploi|contact|student|etudiant|campus|join|recrut/i.test(new URL(p.url).pathname))
    .flatMap((p) => linkTargets(p.html, p.url, 6));
  await readAll(deeper.slice(0, 8));
  return pages;
}

export type SiteRead = { website: string; websiteSource: WebsiteSource; pages: Page[] };

/**
 * The company's own website and the pages read on it (home, careers, contact, what those link to). A domain
 * guessed from the name is only kept when what is on it fits (this is what keeps giro.com, helmets, from
 * standing in for GIRO, the software company, and lets giro.ca through).
 */
export async function readCompanySite(
  opts: { companyName: string; website: string | null; postingUrl: string | null },
  fetcher: Fetcher,
): Promise<{ read: SiteRead | null; note?: string }> {
  let note: string | undefined;
  for (const candidate of await websiteCandidates(opts, fetcher)) {
    const pages = await readSite(candidate.home, opts.postingUrl, fetcher);
    if (candidate.source === "guess" && !corroboratesCompany(pages)) {
      note ??= `${candidate.website} looks like a different company: nothing on it points to Québec, Canada or software`;
      continue;
    }
    return { read: { website: candidate.website, websiteSource: candidate.source, pages }, note };
  }
  return { read: null, note };
}

export async function discoverCompanyContacts(opts: {
  companyName: string;
  website: string | null;
  postingUrl: string | null;
}): Promise<Discovery> {
  const fetcher = new Fetcher();
  try {
    const rank = (pages: Page[], siteHost: string | null) =>
      rankFoundEmails(
        pages.map((p) => ({ url: p.url, emails: extractEmails(p.html) })),
        opts.companyName,
        siteHost,
      );

    const { read, note } = await readCompanySite(opts, fetcher);
    if (read) {
      return {
        website: read.website,
        websiteSource: read.websiteSource,
        pagesScanned: read.pages.map((p) => p.url),
        found: rank(read.pages, hostOf(read.website)),
      };
    }

    // No website could be settled. The posting itself is still worth reading.
    const posting = opts.postingUrl ? await fetcher.get(opts.postingUrl) : null;
    return {
      website: null,
      websiteSource: null,
      pagesScanned: posting ? [posting.url] : [],
      found: posting ? rank([posting], null) : [],
      note,
    };
  } finally {
    await fetcher.close();
  }
}

const ROLE_LABEL: Record<ContactKind, string> = {
  recruiting: "Careers inbox",
  generic: "General contact",
  other: "Published contact",
};

/** Stores what was found: the website when the company had none, and each address with its source page. */
export async function saveDiscovery(companyId: string, currentWebsite: string | null, found: Discovery): Promise<number> {
  if (found.website && !currentWebsite) await setCompanyWebsite(companyId, found.website);
  let saved = 0;
  for (const hit of found.found) {
    await addVerifiedContact({
      companyId,
      name: null,
      role: ROLE_LABEL[hit.kind],
      email: hit.email,
      sourceUrl: hit.sourceUrl,
    });
    saved += 1;
  }
  return saved;
}

export type RecipientSearch = {
  /** Set when a website was found for a company that had none. */
  newWebsite: string | null;
  searched: boolean;
  found: number;
  contacts: Awaited<ReturnType<typeof listContactsForCompany>>;
};

/**
 * Finds the address for an application: uses the contacts already known for the company, or looks
 * (once) on its public pages and stores the result.
 */
export async function findRecipientForApplication(
  app: ApplicationDetail,
  opts: { force?: boolean } = {},
): Promise<RecipientSearch> {
  const known = await listContactsForCompany(app.company_id);
  if (!opts.force && known.some((c) => c.email)) {
    return { newWebsite: null, searched: false, found: known.filter((c) => c.email).length, contacts: known };
  }

  const discovery = await discoverCompanyContacts({
    companyName: app.company_name,
    website: app.company_website,
    postingUrl: app.url,
  });
  const found = await saveDiscovery(app.company_id, app.company_website, discovery);
  return {
    newWebsite: discovery.website && !app.company_website ? discovery.website : null,
    searched: true,
    found,
    contacts: await listContactsForCompany(app.company_id),
  };
}
