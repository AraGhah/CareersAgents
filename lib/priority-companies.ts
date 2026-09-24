/** Major employers to boost/highlight when they're already surfaced by the
 *  general LinkedIn/Indeed search — not a dedicated per-company search, which
 *  would multiply Apify actor runs and credit spend for no guaranteed gain,
 *  since most of these don't run any of the four ATS boards this app can
 *  query directly (Greenhouse/Lever/Workable/Ashby). */
export const PRIORITY_COMPANIES = [
  "Hydro-Québec",
  "CAE",
  "Bombardier",
  "Desjardins",
  "RBC",
  "TD",
  "BMO",
  "Scotiabank",
  "National Bank of Canada",
  "CIBC",
  "Bell",
  "CGI",
  "Ericsson",
  "Ubisoft",
  "SAP",
  "Coveo",
  "Morgan Stanley",
] as const;

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ") // "Hydro-Québec" vs "Hydro Québec" (discovered postings vary)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary match, not plain substring — short acronyms like "TD" or
// "Bell" would otherwise false-positive inside unrelated words ("outdated",
// "Campbell").
const PRIORITY_PATTERNS = PRIORITY_COMPANIES.map(
  (name) => new RegExp(`\\b${escapeRegExp(normalize(name))}\\b`),
);

export function isPriorityCompany(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = normalize(name);
  return PRIORITY_PATTERNS.some((pattern) => pattern.test(normalized));
}
