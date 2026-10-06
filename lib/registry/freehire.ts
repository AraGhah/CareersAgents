// freehire (https://freehire.me, MIT, github.com/strelov1/freehire) crawls ~300,000 companies' careers boards every day
// and answers searches over them through a public, unauthenticated API. The desk asks it one thing each day: which
// internships around here were posted recently, and on whose careers board. Each answer names the company and links
// to the posting on the company's own system (Workday, Greenhouse, Lever, Ashby, SuccessFactors...), which is how new
// companies enter the registry. Nothing is sent to freehire but the search itself.
//
//   GET https://freehire.me/api/v1/jobs/search?q=..&q_fields=title&countries=CA&open_within_days=N&limit=100&offset=..

import { safeFetch } from "../net-guard";

const BASE = "https://freehire.me/api/v1/jobs/search";
const HEADERS = { "user-agent": "InternshipDesk/0.1 (+public job search)", accept: "application/json" };
const PAGE = 100;

export type FreehireJob = {
  slug: string;
  /** The ATS or feed freehire read it from: "workday", "greenhouse", "whatjobs-ca"... */
  source: string;
  externalId: string | null;
  url: string;
  title: string;
  company: string;
  location: string | null;
  cities: string[];
  workMode: string | null;
  description: string | null;
  postedAt: Date | null;
};

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function toJob(raw: Raw): FreehireJob | null {
  const url = s(raw.url);
  const title = s(raw.title);
  const company = s(raw.company);
  if (!url || !title || !company) return null;
  const posted = s(raw.posted_at) ?? s(raw.created_at);
  const date = posted ? new Date(posted) : null;
  return {
    slug: s(raw.public_slug) ?? url,
    source: s(raw.source) ?? "freehire",
    externalId: s(raw.external_id),
    url,
    title,
    company,
    location: s(raw.location),
    cities: Array.isArray(raw.cities) ? raw.cities.filter((c): c is string => typeof c === "string") : [],
    workMode: s(raw.work_mode),
    description: s(raw.description),
    postedAt: date && !Number.isNaN(date.getTime()) ? date : null,
  };
}

/** The searches made each day. FREEHIRE_QUERIES overrides the title words (one search per comma-separated entry). */
export function freehireSearches(withinDays: number): URLSearchParams[] {
  const countries = process.env.FREEHIRE_COUNTRIES?.trim() || "CA";
  const words = (process.env.FREEHIRE_QUERIES?.trim() || "intern internship stage stagiaire co-op coop")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  const common = { countries, open_within_days: String(withinDays), sort: "created_at", limit: String(PAGE) };
  return [
    // Titles with an internship word, in English or French.
    ...words.map((q) => new URLSearchParams({ ...common, q, q_fields: "title" })),
    // Postings freehire classified as internships whatever their title says.
    new URLSearchParams({ ...common, employment_type: "internship" }),
    // Postings written for college (CÉGEP / DEC) students, the first ones applied to (lib/match/college.ts).
    new URLSearchParams({ ...common, q: "cégep cegep collégial collegial DEC AEC", q_fields: "description" }),
  ];
}

/**
 * Recent internships in the configured countries, every page of every search, merged by posting. Throws only when
 * freehire does not answer at all (the caller reports it and goes on with the boards it already has).
 */
export async function fetchFreehireInternships(opts: { withinDays: number; maxPerSearch?: number }): Promise<FreehireJob[]> {
  const max = opts.maxPerSearch ?? 1000;
  const out = new Map<string, FreehireJob>();
  let answered = 0;
  let lastError: string | null = null;
  for (const params of freehireSearches(opts.withinDays)) {
    for (let offset = 0; offset < max; offset += PAGE) {
      params.set("offset", String(offset));
      const res = await safeFetch(`${BASE}?${params.toString()}`, { headers: HEADERS, timeoutMs: 30_000, maxBytes: 20_000_000 }).catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        return null;
      });
      if (!res?.ok) {
        if (res) lastError = `HTTP ${res.status}`;
        break;
      }
      answered += 1;
      const body = JSON.parse(res.text) as { data?: Raw[]; meta?: { total?: number } };
      for (const raw of body.data ?? []) {
        const job = toJob(raw);
        if (job && !out.has(job.slug)) out.set(job.slug, job);
      }
      if ((body.data?.length ?? 0) < PAGE || offset + PAGE >= (body.meta?.total ?? 0)) break;
      // A polite pace: freehire is a free public service.
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (answered === 0) throw new Error(`freehire did not answer${lastError ? ` (${lastError})` : ""}`);
  return [...out.values()];
}
