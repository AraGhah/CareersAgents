// The jobs a company careers page shows by itself, when the company has no job board the desk can read (jobseek's
// "structured data" and "DOM" monitors): the schema.org JobPosting data the page publishes for search engines, and the
// links on it whose text is an internship title. Pure: the page is fetched by lib/registry/crawl.ts.

import { anchorsOf } from "../apply/careers-parse";
import { htmlToText, isInternshipTitle } from "../discover-core";

export type PageJob = {
  title: string;
  url: string;
  location: string | null;
  remote: boolean;
  description: string | null;
  postedAt: Date | null;
  /** schema.org's employmentType says INTERN. */
  intern: boolean;
};

type Json = Record<string, unknown>;

const asRecord = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function isJobPosting(node: Json): boolean {
  return asArray(node["@type"]).some((t) => typeof t === "string" && /^(schema:)?JobPosting$/i.test(t));
}

/** Every object in the JSON-LD blocks, @graph and ItemList entries included. */
function nodes(value: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 6) return out;
  for (const item of asArray(value)) {
    const node = asRecord(item);
    if (!Object.keys(node).length) continue;
    out.push(node);
    if (node["@graph"]) nodes(node["@graph"], out, depth + 1);
    for (const el of asArray(node.itemListElement)) {
      const entry = asRecord(el);
      nodes(entry.item ?? entry, out, depth + 1);
    }
  }
  return out;
}

function placeOf(posting: Json): string | null {
  const places = asArray(posting.jobLocation).map((l) => {
    const address = asRecord(asRecord(l).address);
    const country = str(address.addressCountry) ?? str(asRecord(address.addressCountry).name);
    return [str(address.addressLocality), str(address.addressRegion), country].filter(Boolean).join(", ");
  });
  const named = places.filter(Boolean);
  if (named.length) return [...new Set(named)].join(" / ");
  const remote = asArray(posting.applicantLocationRequirements).map((r) => str(asRecord(r).name)).filter(Boolean);
  return remote.length ? `Remote (${remote.join(", ")})` : null;
}

function fromNode(node: Json, pageUrl: string): PageJob | null {
  const title = str(node.title) ?? str(node.name);
  if (!title) return null;
  let url = str(node.url) ?? str(node.sameAs) ?? pageUrl;
  try {
    url = new URL(url, pageUrl).toString();
  } catch {
    url = pageUrl;
  }
  const posted = str(node.datePosted);
  const date = posted ? new Date(posted) : null;
  return {
    title: htmlToText(title) ?? title,
    url,
    location: placeOf(node),
    remote: /TELECOMMUTE/i.test(String(node.jobLocationType ?? "")),
    description: htmlToText(str(node.description)),
    postedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    intern: asArray(node.employmentType).some((t) => typeof t === "string" && /intern/i.test(t)),
  };
}

/** The JobPosting objects of a page's JSON-LD. A block that is not valid JSON is skipped, never fatal. */
export function jsonLdJobs(html: string, pageUrl: string): PageJob[] {
  const out: PageJob[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const node of nodes(parsed)) {
      if (!isJobPosting(node)) continue;
      const job = fromNode(node, pageUrl);
      if (job) out.push(job);
    }
  }
  return out;
}

/**
 * The internships a careers page shows: its JSON-LD postings (an internship by title or by employmentType), then the links
 * whose text is an internship title. One per link.
 */
export function pageJobs(html: string, pageUrl: string): PageJob[] {
  const seen = new Set<string>();
  const out: PageJob[] = [];
  const keep = (j: PageJob) => {
    const key = j.url === pageUrl ? `${j.url}#${j.title}` : j.url;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(j);
  };
  for (const j of jsonLdJobs(html, pageUrl)) if (j.intern || isInternshipTitle(j.title)) keep(j);
  for (const a of anchorsOf(html, pageUrl)) {
    if (a.text.length < 8 || !isInternshipTitle(a.text)) continue;
    keep({ title: a.text, url: a.url, location: null, remote: false, description: null, postedAt: null, intern: true });
  }
  return out;
}
