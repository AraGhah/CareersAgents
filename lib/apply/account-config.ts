// The account the desk uses on employer application portals that ask for one (Workday, iCIMS, Taleo...): the email and
// password live in .env.local only (gitignored). This module is the only place they are read, and it has no browser and
// no database so a page that only needs to know "is it configured" never loads either.
//
// Rules everything that touches the password follows:
//   - it is typed into a password field and read nowhere else: never logged, never stored (no table, no file, no plan)
//   - any line that might carry it goes through redact() first
//   - an account is created only on a run you start for one application, never from the queue or `automate`

export type AccountCredentials = { email: string; password: string };

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
