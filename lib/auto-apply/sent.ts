// "Did you send it?" The desk only ever makes Gmail drafts; you press Send. This finds the ones that have since gone
// out and moves their application to "applied" (shown as "Envoyé"), so the Tracker is true without a manual click.
//
// For each draft the desk made that is not marked sent yet:
//   - the draft still exists in Gmail            → still waiting for you
//   - it is gone, and a message to the same address is in Sent since the draft was made → sent: recorded
//   - it is gone and nothing was sent            → you deleted it: left alone (the application page can make a new one)
// Needs only the readonly scope the desk already has.

import type { gmail_v1 } from "googleapis";
import { pool } from "../db";
import { getGmail, headerValue, isNotFound } from "../gmail";
import { markApplicationSent } from "../outreach";

export type SentSync = {
  checked: number;
  /** Drafts found sent and recorded. */
  sent: number;
  /** Drafts still sitting in Gmail. */
  waiting: number;
  /** Drafts that disappeared without a matching sent message. */
  deleted: number;
  errors: string[];
};

type PendingDraft = {
  id: string;
  application_id: string;
  gmail_draft_id: string;
  to_email: string;
  subject: string;
  created_at: Date;
};

const sameSubject = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export async function pendingDrafts(): Promise<PendingDraft[]> {
  const { rows } = await pool.query<PendingDraft>(
    `SELECT o.id, o.application_id, o.gmail_draft_id, o.to_email, o.subject, o.created_at
       FROM outreach_drafts o JOIN applications a ON a.id = o.application_id
      WHERE o.gmail_draft_id IS NOT NULL AND o.sent_at IS NULL AND o.sent_detected_at IS NULL
        AND o.kind IN ('application', 'outreach')
        AND a.status IN ('discovered', 'qualified', 'ready')
      ORDER BY o.created_at`,
  );
  return rows;
}

async function draftExists(gmail: gmail_v1.Gmail, id: string): Promise<boolean> {
  try {
    await gmail.users.drafts.get({ userId: "me", id, format: "minimal" });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** The message in Sent that is this draft: same subject to the same address, else the first one to that address since. */
async function findSentMessage(gmail: gmail_v1.Gmail, draft: PendingDraft): Promise<{ id: string; at: Date } | null> {
  // An hour before the draft was made, to be safe about clocks. Without a recipient only the subject can match.
  const after = Math.floor(draft.created_at.getTime() / 1000) - 3600;
  const q = ["in:sent", `after:${after}`, draft.to_email ? `to:${draft.to_email}` : null].filter(Boolean).join(" ");
  const listed = await gmail.users.messages.list({ userId: "me", q, maxResults: 15 });

  const found: Array<{ id: string; at: Date; subject: string }> = [];
  for (const ref of listed.data.messages ?? []) {
    if (!ref.id) continue;
    const m = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "metadata", metadataHeaders: ["Subject"] });
    found.push({
      id: ref.id,
      at: m.data.internalDate ? new Date(Number(m.data.internalDate)) : new Date(),
      subject: headerValue(m.data.payload?.headers, "Subject"),
    });
  }
  const exact = found.find((m) => sameSubject(m.subject, draft.subject));
  const hit = exact ?? (draft.to_email ? [...found].sort((a, b) => a.at.getTime() - b.at.getTime())[0] : undefined);
  return hit ? { id: hit.id, at: hit.at } : null;
}

export async function syncSentDrafts(gmail?: gmail_v1.Gmail): Promise<SentSync> {
  const result: SentSync = { checked: 0, sent: 0, waiting: 0, deleted: 0, errors: [] };
  const drafts = await pendingDrafts();
  if (drafts.length === 0) return result;

  const client = gmail ?? (await getGmail());
  for (const draft of drafts) {
    result.checked += 1;
    try {
      if (await draftExists(client, draft.gmail_draft_id)) {
        result.waiting += 1;
        continue;
      }
      const message = await findSentMessage(client, draft);
      if (!message) {
        result.deleted += 1;
        continue;
      }
      await pool.query(
        `UPDATE outreach_drafts SET sent_at = $2, sent_detected_at = $2, gmail_message_id = $3 WHERE id = $1`,
        [draft.id, message.at, message.id],
      );
      await markApplicationSent(draft.application_id, "sent from Gmail (the draft the desk made was sent)");
      result.sent += 1;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}
