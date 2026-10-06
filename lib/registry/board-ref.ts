// What a careers board is, and how to recognise one from a link. Pure: no network, no database.
//
// Three kinds of board, read three ways (jobseek's "monitors"):
//   - a job board with a public API (Greenhouse, Lever, Ashby, Workable): every job, with its description
//   - an employer job system with a public search (Workday, SuccessFactors, SmartRecruiters, iCIMS, IBM): searched for
//     the internship words, lib/apply/boards.ts
//   - a company careers page with neither: its schema.org JobPosting data and its job links (lib/registry/jsonld.ts)

import { boardFromUrl, boardKey, type EmployerBoard } from "../apply/boards";
import type { BoardPlatform } from "../apply/careers-parse";

export type ApiBoard = { platform: BoardPlatform; config: { token: string } };
export type SearchBoard = { platform: EmployerBoard["ats"]; config: EmployerBoard };
export type PageBoard = { platform: "careers-page"; config: { url: string } };
export type RegistryBoard = ApiBoard | SearchBoard | PageBoard;

export const API_PLATFORMS: ReadonlySet<string> = new Set(["greenhouse", "lever", "ashby", "workable"]);

export function isApiBoard(b: RegistryBoard): b is ApiBoard {
  return API_PLATFORMS.has(b.platform);
}

export function isPageBoard(b: RegistryBoard): b is PageBoard {
  return b.platform === "careers-page";
}

/** The careers page with its query and fragment set aside, so the same page found twice is one board. */
export function canonicalPage(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    u.search = "";
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** One name per board: the registry's unique key. */
export function registryKey(b: RegistryBoard): string {
  if (isApiBoard(b)) return `${b.platform}:${b.config.token.toLowerCase()}`;
  if (isPageBoard(b)) return `careers-page:${canonicalPage(b.config.url) ?? b.config.url}`;
  return boardKey(b.config);
}

const TOKEN = /^[a-z0-9][a-z0-9_.-]*$/i;
/** Path pieces that are part of a platform's own URLs, never a company's board. */
const NOT_A_TOKEN = /^(embed|api|v0|v1|static|js|css|assets|jobs|apply|widget|login|signin|sitemap|j|job|posting|postings|careers)$/i;

function token(raw: string | undefined | null): string | null {
  const t = (raw ?? "").replace(/[.-]+$/, "");
  return t && TOKEN.test(t) && !NOT_A_TOKEN.test(t) ? t : null;
}

/**
 * The board a posting or careers link belongs to, or null:
 *   job-boards.greenhouse.io/coveoen/jobs/123        → greenhouse coveoen
 *   jobs.lever.co/eqbank/<uuid>                      → lever eqbank
 *   jobs.ashbyhq.com/exegy/<uuid>                    → ashby exegy
 *   apply.workable.com/genetec-inc/j/ABC             → workable genetec-inc   (apply.workable.com/j/ABC names no account)
 *   autodesk.wd1.myworkdayjobs.com/Ext/job/...       → workday autodesk/Ext    (and the other employer systems)
 */
export function boardFromLink(raw: string): RegistryBoard | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    const t = parts[0] === "embed" ? token(url.searchParams.get("for")) : token(parts[0]);
    return t ? { platform: "greenhouse", config: { token: t } } : null;
  }
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) {
    const t = token(parts[0]);
    return t ? { platform: "lever", config: { token: t } } : null;
  }
  if (host === "jobs.ashbyhq.com") {
    const t = token(parts[0]);
    return t ? { platform: "ashby", config: { token: t } } : null;
  }
  if (host === "apply.workable.com") {
    const t = token(parts[0]);
    return t ? { platform: "workable", config: { token: t } } : null;
  }
  const employer = boardFromUrl(raw);
  return employer ? { platform: employer.ats, config: employer } : null;
}

/**
 * One id per posting whatever source found it, so the freehire copy and the board crawl of the same posting are one job:
 * its link without tracking parameters or locale.
 */
export function postingKey(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|source$|src$|ref$|gh_src$|lever-source)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    u.pathname = u.pathname.replace(/\/[a-z]{2}-[A-Z]{2}(?=\/)/, "").replace(/\/$/, "");
    return `url:${u.toString()}`;
  } catch {
    return `url:${raw}`;
  }
}

/** A link with freehire's and the boards' tracking parameters removed: what is stored and opened. */
export function cleanLink(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}
