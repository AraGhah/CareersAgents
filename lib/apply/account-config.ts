// The account the desk uses on employer application portals that ask for one (Workday, iCIMS, Taleo...): the email and
// password live in .env.local only (gitignored). This module is the only place they are read, and it has no browser and
// no database so a page that only needs to know "is it configured" never loads either.
//
// Rules everything that touches the password follows:
//   - it is typed into a password field and read nowhere else: never logged, never stored (no table, no file, no plan)
//   - any line that might carry it goes through redact() first
//   - an account is created only on a run you start for one application, never from the queue or `automate`
//   - it is typed only on a known application system (Workday, iCIMS...) over https, or a host you list yourself in
//     PORTAL_ACCOUNT_HOSTS: one password serves every portal, so a look-alike page must never receive it

import employersFile from "../../employers.json";

export type AccountCredentials = { email: string; password: string };

/**
 * PORTAL_BATCH_ACCOUNTS=true: the "Postuler automatiquement" batch may also sign in to, or create, accounts (same hosts,
 * same rules). `npm run portal -- --queue` and `automate` never do.
 */
export function batchAccountsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PORTAL_BATCH_ACCOUNTS?.trim().toLowerCase() === "true" && accountCredentials(env) !== null;
}

/** Hosts of the employer sites in employers.json: each one checked by hand, so trusted like a known application system. */
const EMPLOYER_HOSTS = new Set(
  (employersFile as { employers: Array<{ host?: string }> }).employers.flatMap((e) => (e.host ? [e.host.toLowerCase()] : [])),
);

/**
 * The configured account, or null when creating accounts is off or incomplete. Needs all three of
 * PORTAL_CREATE_ACCOUNTS=true, PORTAL_ACCOUNT_EMAIL and PORTAL_ACCOUNT_PASSWORD.
 */
export function accountCredentials(env: Record<string, string | undefined> = process.env): AccountCredentials | null {
  if (env.PORTAL_CREATE_ACCOUNTS?.trim().toLowerCase() !== "true") return null;
  const email = env.PORTAL_ACCOUNT_EMAIL?.trim();
  const password = env.PORTAL_ACCOUNT_PASSWORD ?? "";
  return email && password ? { email, password } : null;
}

/** The text with the password replaced, for anything that is logged or saved. */
export function redact(text: string, creds: AccountCredentials | null = accountCredentials()): string {
  return creds?.password ? text.split(creds.password).join("••••••") : text;
}

/** The host an account belongs to: one per employer portal (autodesk.wd1.myworkdayjobs.com), without "www.". */
export function portalHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Application systems that host employer accounts (and mail their verification links), whatever the employer's domain. */
export const APPLICATION_SYSTEMS =
  /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|myworkday\.com|workday\.com|icims\.com|taleo\.net|successfactors\.(?:com|eu)|oraclecloud\.com|ultipro\.(?:com|ca)|brassring\.com|jobvite\.com|smartrecruiters\.com|njoyn\.com|applytojob\.com|bamboohr\.com|teamtailor\.com|recruitee\.com|adp\.com|eightfold\.ai)$/i;

/**
 * May the account's password be typed on this page? Only over https, and only on a known application system or a host
 * listed (comma-separated, subdomains included) in PORTAL_ACCOUNT_HOSTS.
 */
export function accountHostAllowed(url: string, env: Record<string, string | undefined> = process.env): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (APPLICATION_SYSTEMS.test(host) || EMPLOYER_HOSTS.has(host)) return true;
  const listed = (env.PORTAL_ACCOUNT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
  return listed.some((h) => host === h || host.endsWith(`.${h}`));
}
