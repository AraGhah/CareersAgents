// Email or portal? A published recruiting contact means the personalized email
// (the existing V8/V9 flow). No contact means the company's own online form.
// Postings on sites that need the candidate's account are sent to manual.

import { pool } from "../db";
import { listContactsForCompany } from "../queries";
import { pickBestContact } from "../recruiter";
import type { ApplicationDetail } from "../types";
import { manualOnlyReason } from "./platforms";

export type Channel = "email" | "portal" | "manual";

export type ChannelDecision = { channel: Channel; reason: string; contactEmail: string | null };

export async function decideChannel(
  app: ApplicationDetail,
  opts: { forcePortal?: boolean; applyUrl?: string } = {},
): Promise<ChannelDecision> {
  const contact = pickBestContact(await listContactsForCompany(app.company_id));
  if (contact?.email && !opts.forcePortal) {
    return { channel: "email", reason: `Published contact ${contact.email} (${contact.source_url}).`, contactEmail: contact.email };
  }
  // Judged on the company's own form when one is known, not on the job-board listing.
  const manual = manualOnlyReason(opts.applyUrl ?? app.url);
  if (manual) return { channel: "manual", reason: manual, contactEmail: null };
  return {
    channel: "portal",
    reason: opts.forcePortal && contact?.email ? "Portal chosen by hand although a contact exists." : "No recruiter or HR address is published: apply through the company's form.",
    contactEmail: null,
  };
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
