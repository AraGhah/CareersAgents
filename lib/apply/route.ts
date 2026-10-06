// Careers page, or what else? Companies want applications through their own careers page, not in a recruiter's inbox,
// so the company's own form comes first:
//   1. a form on the company's careers site or job system the desk can fill    → portal
//   2. no such form, APPLY_EMAIL_FALLBACK=true and a published recruiting address → email (the V8/V9 flow)
//   3. otherwise                                                                → manual, with where the careers page is
// LinkedIn and Indeed copies never count as the company's form (lib/apply/apply-url.ts looks for the original first).

import { pool } from "../db";
import { listContactsForCompany } from "../queries";
import { pickBestContact } from "../recruiter";
import type { ApplicationDetail } from "../types";
import { isJobBoardUrl } from "./apply-url";
import { manualOnlyReason, neverDrivenReason } from "./platforms";

export type Channel = "email" | "portal" | "manual";

export type ChannelDecision = { channel: Channel; reason: string; contactEmail: string | null };

/** APPLY_EMAIL_FALLBACK=true: a published recruiter address is used when no careers form can be. Off by default. */
export function emailFallbackEnabled(): boolean {
  return process.env.APPLY_EMAIL_FALLBACK?.trim().toLowerCase() === "true";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * `applyUrl` is where the company's form is (lib/apply/apply-url.ts resolveApplyTarget); without it the posting's own
 * link is judged. `forcePortal` never falls back to email.
 */
export async function decideChannel(
  app: ApplicationDetail,
  opts: { forcePortal?: boolean; applyUrl?: string; hint?: string | null; allowAccountPortals?: boolean } = {},
): Promise<ChannelDecision> {
  const url = opts.applyUrl ?? app.url;
  // An employer's account portal is the desk's to try only on a run you started with the account configured.
  const manual = (opts.allowAccountPortals ? neverDrivenReason : manualOnlyReason)(url) ?? (isJobBoardUrl(url) ? "Only a job-board copy of this posting is known." : null);
  if (!manual) {
    return { channel: "portal", reason: `Through the company's own careers form (${hostOf(url)}).`, contactEmail: null };
  }

  const contact = !opts.forcePortal && emailFallbackEnabled() ? pickBestContact(await listContactsForCompany(app.company_id)) : null;
  if (contact?.email) {
    return {
      channel: "email",
      reason: `No careers form the desk can fill (${manual}) Email fallback (APPLY_EMAIL_FALLBACK=true): ${contact.email} (${contact.source_url}).`,
      contactEmail: contact.email,
    };
  }
  // A person applies from here: say where the company's own posting or careers page is.
  const where = opts.applyUrl && opts.applyUrl !== app.url ? ` The company's own posting: ${opts.applyUrl}` : opts.hint ? ` ${opts.hint}` : "";
  return { channel: "manual", reason: `${manual}${where}`, contactEmail: null };
}

let warnedMissingColumn = false;

export async function saveChannel(applicationId: string, channel: Channel): Promise<void> {
  try {
    await pool.query(`UPDATE applications SET channel = $2 WHERE id = $1`, [applicationId, channel]);
  } catch (err) {
    // Before schema-v11.sql is applied the column does not exist; the email flow must keep working.
    if ((err as { code?: string }).code !== "42703") throw err;
    if (!warnedMissingColumn) console.warn("[portal] applications.channel missing: apply schema-v11.sql");
    warnedMissingColumn = true;
  }
}
