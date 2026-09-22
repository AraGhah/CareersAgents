// Pull new Gmail messages, match them to applications, classify by rules, update status.
//   npx tsx scripts/sync-inbox.ts
//   npx tsx scripts/sync-inbox.ts --loop     (every 30 minutes)
// Nothing is sent. Unclassified mail is stored with classification NULL for you to read.

import cron from "node-cron";
import { classifyMessage, shouldApplyStatus, statusFromClassification } from "../lib/classify";
import { pool } from "../lib/db";
import {
  domainsMatch,
  extractDomain,
  extractEmailAddress,
  getGmail,
  headerValue,
  websiteHost,
} from "../lib/gmail";
import { markOutreachSentFromOutbound } from "../lib/outreach";
import { setApplicationStatus } from "../lib/queries";

const LOOP = process.argv.includes("--loop");
const STATE_KEY = "inbox_last_sync";

type AppMatch = {
  id: string;
  status: string;
  submitted_at: Date | null;
  company_id: string;
  website: string | null;
};

async function lastSync(): Promise<Date> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(`cache/${STATE_KEY}.json`, "utf8");
    const parsed = JSON.parse(raw) as { at: string };
    return new Date(parsed.at);
  } catch {
    // First run: look back three days so a restart is not empty.
    return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  }
}

async function saveSync(at: Date) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("cache", { recursive: true });
  await writeFile(
    `cache/${STATE_KEY}.json`,
    JSON.stringify({ at: at.toISOString() }, null, 2),
    "utf8",
  );
}

async function applications(): Promise<AppMatch[]> {
  const { rows } = await pool.query<AppMatch>(
    `SELECT a.id, a.status, a.submitted_at, c.id AS company_id, c.website
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE a.status NOT IN ('withdrawn')`,
  );
  return rows;
}

async function matchApplication(
  apps: AppMatch[],
  opts: { threadId: string | null; from: string },
): Promise<AppMatch | null> {
  if (opts.threadId) {
    const { rows } = await pool.query<{ application_id: string }>(
      `SELECT application_id FROM messages
        WHERE gmail_thread_id = $1 AND application_id IS NOT NULL
        LIMIT 1`,
      [opts.threadId],
    );
    if (rows[0]) {
      return apps.find((a) => a.id === rows[0].application_id) ?? null;
    }
  }

  const domain = extractDomain(opts.from);
  if (!domain) return null;

  const hits = apps.filter((a) => {
    const host = websiteHost(a.website);
    return host ? domainsMatch(domain, host) : false;
  });

  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];

  // Prefer live applications over rejected/withdrawn.
  const live = hits.filter((a) => !["rejected", "withdrawn"].includes(a.status));
  const poolChoice = live.length ? live : hits;
  poolChoice.sort((a, b) => {
    const ta = a.submitted_at?.getTime() ?? 0;
    const tb = b.submitted_at?.getTime() ?? 0;
    return tb - ta;
  });
  return poolChoice[0] ?? null;
}

async function run() {
  const gmail = await getGmail();
  const since = await lastSync();
  const afterEpoch = Math.floor(since.getTime() / 1000);
  const query = `after:${afterEpoch} -in:drafts -in:chats`;

  console.log(`Inbox sync since ${since.toISOString()}`);

  const apps = await applications();
  let pageToken: string | undefined;
  let seen = 0;
  let stored = 0;
  let classified = 0;
  let statusChanges = 0;

  do {
    const listed = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 50,
      pageToken,
    });
    pageToken = listed.data.nextPageToken ?? undefined;
    const ids = listed.data.messages ?? [];

    for (const ref of ids) {
      if (!ref.id) continue;
      seen += 1;

      const full = await gmail.users.messages.get({
        userId: "me",
        id: ref.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });

      const headers = full.data.payload?.headers;
      const from = headerValue(headers, "From");
      const subject = headerValue(headers, "Subject");
      const snippet = full.data.snippet ?? "";
      const threadId = full.data.threadId ?? null;
      const internalDate = full.data.internalDate
        ? new Date(Number(full.data.internalDate))
        : new Date();

      const app = await matchApplication(apps, { threadId, from });
      const label = app
        ? classifyMessage({
            subject,
            snippet,
            from,
            submittedAt: app.submitted_at,
            occurredAt: internalDate,
          })
        : null;

      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO messages (application_id, gmail_thread_id, gmail_message_id,
                               direction, subject, snippet, classification, occurred_at)
         VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7)
         ON CONFLICT (gmail_message_id) DO NOTHING
         RETURNING id`,
        [app?.id ?? null, threadId, ref.id, subject || null, snippet || null, label, internalDate],
      );

      if (!inserted.rows[0]) continue;
      stored += 1;
      if (label) classified += 1;

      if (app && label) {
        const next = statusFromClassification(label);
        if (next && shouldApplyStatus(app.status, next)) {
          await setApplicationStatus(
            app.id,
            next,
            `inbox ${label}: ${subject.slice(0, 120) || "(no subject)"}`,
          );
          app.status = next;
          statusChanges += 1;
        }
      }
    }
  } while (pageToken);

  // Also scan Sent mailbox to mark outreach drafts as sent (still never auto-sends).
  let sentMarked = 0;
  {
    const sentList = await gmail.users.messages.list({
      userId: "me",
      q: `in:sent after:${afterEpoch}`,
      maxResults: 40,
    });
    for (const ref of sentList.data.messages ?? []) {
      if (!ref.id) continue;
      const full = await gmail.users.messages.get({
        userId: "me",
        id: ref.id,
        format: "metadata",
        metadataHeaders: ["To", "Subject", "Date"],
      });
      const headers = full.data.payload?.headers;
      const to = headerValue(headers, "To");
      const subject = headerValue(headers, "Subject");
      const threadId = full.data.threadId ?? null;
      const internalDate = full.data.internalDate
        ? new Date(Number(full.data.internalDate))
        : new Date();
      const toEmail = extractEmailAddress(to);
      const app = await matchApplication(apps, { threadId, from: to });
      if (!app) continue;

      await pool.query(
        `INSERT INTO messages (application_id, gmail_thread_id, gmail_message_id,
                               direction, subject, snippet, classification, occurred_at)
         VALUES ($1, $2, $3, 'outbound', $4, $5, NULL, $6)
         ON CONFLICT (gmail_message_id) DO NOTHING`,
        [app.id, threadId, ref.id, subject || null, null, internalDate],
      );

      await markOutreachSentFromOutbound({
        applicationId: app.id,
        toOrSubjectHint: toEmail ?? subject,
        occurredAt: internalDate,
      });
      sentMarked += 1;
    }
  }

  await saveSync(new Date());
  console.log(
    `Done. ${seen} listed, ${stored} new, ${classified} classified, ${statusChanges} status change(s), ${sentMarked} sent scanned.`,
  );
}

async function main() {
  await run();
  if (!LOOP) {
    await pool.end();
    return;
  }
  console.log("Looping every 30 minutes. Ctrl+C to stop.");
  cron.schedule("*/30 * * * *", () => {
    run().catch((err) => console.error(err));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
