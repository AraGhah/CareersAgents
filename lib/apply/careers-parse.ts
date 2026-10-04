// The parts of "find this role on the company's own site" that need neither the network nor the database:
// spotting a company's job board in the HTML of its careers pages, and deciding whether a listed job is the
// same role as the posting we hold. lib/apply/careers.ts does the fetching.
//
// A wrong match sends an application to the wrong job, which is worse than not finding one, so matching is
// strict: the same role once the internship words are set aside, an internship itself (never the full-time
// job of the same name), the same term and year when both name one, and a place that fits.

import { isAtsHost, hostOf } from "../contact-parse";
import { isExcludedTitle, isInternshipTitle } from "../discover-core";
import { roleKey } from "./dedupe";
import { manualOnlyReason } from "./platforms";
import { norm } from "./text";

export type BoardPlatform = "greenhouse" | "lever" | "ashby" | "workable";

/** A company job board the desk can read through the platform's public API, and drive the form of. */
export type BoardRef = { platform: BoardPlatform; token: string };

const BOARD_PATTERNS: Array<{ platform: BoardPlatform; re: RegExp }> = [
  { platform: "greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/gi },
  { platform: "greenhouse", re: /greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9_-]+)/gi },
  { platform: "lever", re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+)/gi },
  { platform: "ashby", re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi },
  { platform: "workable", re: /apply\.workable\.com\/([a-z0-9_-]+)/gi },
];

/** Path pieces that are part of a platform's own URLs, not a company's board. */
const NOT_A_TOKEN = /^(embed|api|v1|static|js|css|assets|jobs|apply|widget|login|signin|sitemap)$/i;

/** Every supported job board the HTML links to or embeds. */
export function findBoardRefs(html: string): BoardRef[] {
  const seen = new Set<string>();
  const out: BoardRef[] = [];
  for (const { platform, re } of BOARD_PATTERNS) {
    for (const m of html.matchAll(re)) {
      const token = m[1].replace(/[.-]+$/, "");
      if (!token || NOT_A_TOKEN.test(token)) continue;
      const key = `${platform}:${token.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ platform, token });
    }
  }
  return out;
}

/** Application systems a company sends candidates to that are not a supported board (Workday, iCIMS...). */
const PORTAL_HOST =
  /(?:^|\.)(?:myworkdayjobs|workday|icims|taleo|successfactors|oraclecloud|jobvite|smartrecruiters|bamboohr|recruitee|teamtailor|breezy|applytojob|jazz|paylocity|ultipro|dayforce|adp|cornerstoneondemand|njoyn|brassring|phenom|eightfold|talentbrew|hire\.trakstar|pinpointhq)\./i;

export type PortalLink = { url: string; account: boolean };

/** Stylesheets, scripts, images and fonts: pages load them from a portal's CDN, which makes them no link to it. */
const ASSET = /\.(?:css|js|mjs|json|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|pdf)(?:[?#].*)?$/i;

/**
 * Links on a page to some other application system (anchors, and iframes that embed one). `account` = the desk
 * never drives it (it needs a login).
 */
export function findPortalLinks(html: string, baseUrl: string): PortalLink[] {
  const seen = new Set<string>();
  const out: PortalLink[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["']|<iframe\b[^>]*?src=["']([^"'#]+)["']/gi)) {
    let url: URL;
    try {
      url = new URL((m[1] ?? m[2]).trim(), baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || ASSET.test(url.pathname)) continue;
    const host = url.hostname.toLowerCase();
    if (!PORTAL_HOST.test(`${host}.`) || /(^|\.)(linkedin|indeed|glassdoor)\./.test(host)) continue;
    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ url: href, account: !!manualOnlyReason(href) });
    if (out.length >= 12) break;
  }
  return out;
}

const CAREERS_PATH = /career|carri|\/jobs?\b|emploi|recrut|join-?us|join-?our|rejoign|work-with|travailler/i;
/** "nous-joindre" is "contact us", not "join us". */
const CONTACT_PATH = /nous-joindre|contact/i;

/** The pages on the company's site that look like careers pages, the shallowest first. */
export function careersPagesOf(pages: Array<{ url: string }>, max = 4): string[] {
  return pages
    .map((p) => {
      try {
        const path = new URL(p.url).pathname.toLowerCase();
        if (path === "/" || !CAREERS_PATH.test(path) || CONTACT_PATH.test(path)) return null;
        return { url: p.url, depth: path.split("/").filter(Boolean).length };
      } catch {
        return null;
      }
    })
    .filter((p): p is { url: string; depth: number } => !!p)
    .sort((a, b) => a.depth - b.depth)
    .slice(0, max)
    .map((p) => p.url);
}

/** The page on the company's site most likely to be its careers page, or null. */
export function careersPageOf(pages: Array<{ url: string }>): string | null {
  return careersPagesOf(pages, 1)[0] ?? null;
}

export type Anchor = { url: string; text: string };

/** Links on a page with the text they show. */
export function anchorsOf(html: string, baseUrl: string): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length > 200) continue;
    try {
      const url = new URL(m[1].trim(), baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      out.push({ url: url.toString(), text });
    } catch {
      /* not a URL */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Is it the same role?
// ---------------------------------------------------------------------------

/**
 * "Intern, Software Developer / Stagiaire en développement logiciel" is one role written twice. Only "/" and "|"
 * separate the two: a dash usually introduces a specialization ("... Intern - Software Testing"), and reading
 * that as a second name would match the wrong job.
 */
/** A title half that only names the program ("Stage universitaire", "Co-op collégial"), shared by every posting of it. */
const PROGRAM_ONLY = /^((universitaire|collegiale?|university|college|cegep|technique|technical|programme?|undergraduate|graduate|new grad)\s*)+$/;

function keysOf(title: string): string[] {
  const parts = title.split(/\s*[/|]\s*/);
  return [...new Set([title, ...parts].map(roleKey).filter((k) => k.length > 3 && !PROGRAM_ONLY.test(k)))];
}

function termOf(title: string): string | null {
  const t = norm(title);
  if (/\b(winter|hiver)\b/.test(t)) return "winter";
  if (/\b(summer|ete)\b/.test(t)) return "summer";
  if (/\b(fall|autumn|automne)\b/.test(t)) return "fall";
  if (/\b(spring|printemps)\b/.test(t)) return "spring";
  return null;
}

function yearOf(title: string): string | null {
  return title.match(/\b(20\d{2})\b/)?.[1] ?? null;
}

function jaccard(a: string, b: string): number {
  const wa = new Set(a.split(" ").filter((w) => w.length > 1));
  const wb = new Set(b.split(" ").filter((w) => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / new Set([...wa, ...wb]).size;
}

/** 0 = not the same role; 1 = the same role word for word (season words, "intern" and the like aside). */
export function roleScore(wanted: string, candidate: string): number {
  if (!isInternshipTitle(candidate) || isExcludedTitle(candidate)) return 0;
  const tw = termOf(wanted);
  const tc = termOf(candidate);
  if (tw && tc && tw !== tc) return 0;
  const yw = yearOf(wanted);
  const yc = yearOf(candidate);
  if (yw && yc && yw !== yc) return 0;

  const a = keysOf(wanted);
  const b = keysOf(candidate);
  if (a.some((x) => b.includes(x))) return 1;
  let best = 0;
  for (const x of a) for (const y of b) best = Math.max(best, jaccard(x, y));
  return best >= 0.85 ? best : 0;
}

const IN_CANADA = /canada|qu[eé]bec|\bqc\b|montr|laval|longueuil|gatineau|sherbrooke|hyacinthe|\bremote\b|t[eé]l[eé]travail/i;

/** A listed job's place fits ours: it says Québec or Canada, or names our city. Unknown places do not count. */
function placeFits(candidate: string | null, wanted: string | null): boolean {
  if (!candidate) return false;
  if (IN_CANADA.test(candidate)) return true;
  const city = wanted?.split(",")[0]?.trim().toLowerCase();
  return !!city && city.length > 2 && candidate.toLowerCase().includes(city);
}

export type ListedJob = { title: string; url: string; location?: string | null };

/**
 * The listed job that is this role, or null. One clear winner is needed: two different jobs with the same
 * best score are a tie, and a tie is "not found", never the first one.
 */
export function pickRole(wanted: { title: string; location: string | null }, jobs: ListedJob[]): (ListedJob & { score: number }) | null {
  const scored = jobs
    .map((j) => ({ ...j, score: roleScore(wanted.title, j.title) }))
    .filter((j) => j.score > 0)
    // A listed place has to fit. A job with no place listed is trusted only when the title is the same word for word.
    .filter((j) => (j.location ? placeFits(j.location, wanted.location) : j.score === 1));
  if (scored.length === 0) return null;
  const top = Math.max(...scored.map((j) => j.score));
  const best = scored.filter((j) => j.score === top);
  const urls = new Set(best.map((j) => j.url));
  return urls.size === 1 ? best[0] : null;
}

/** Links on the given pages whose text is this role, as listed jobs (for careers pages that list jobs themselves). */
export function anchorJobs(pages: Array<{ url: string; html: string }>, wantedTitle: string): ListedJob[] {
  const out: ListedJob[] = [];
  for (const p of pages) {
    const pageHost = hostOf(p.url);
    for (const a of anchorsOf(p.html, p.url)) {
      const host = hostOf(a.url);
      // Same site, or an application system: never a job board that holds only a copy of the posting.
      if (!host || (host !== pageHost && !PORTAL_HOST.test(`${host}.`) && !isAtsHost(host))) continue;
      if (/(^|\.)(linkedin|indeed|glassdoor)\./.test(host)) continue;
      if (roleScore(wantedTitle, a.text) > 0) out.push({ title: a.text, url: a.url, location: null });
    }
  }
  return out;
}
