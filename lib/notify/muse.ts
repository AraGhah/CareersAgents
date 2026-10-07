// Muse, Meta's assistant, through a Muse gadget (github.com/facebookincubator/muse-gadget-sdk): a Raspberry Pi or other
// Linux box running the SDK's Linux device service, plus the desk bridge from muse/ in this repo. The desk never talks
// to Muse itself and holds no Muse credentials:
//   - the desk POSTs each event (the daily run finished, an employer replied...) to the bridge on the Pi, which hands the
//     text to `musegadget send-user-msg`; it arrives in a Muse side chat.
//   - every event carries a snapshot of the desk (what waits for your approval, what needs you, the pipeline). The bridge
//     keeps the latest one, and Muse reads it on the Pi with `desk-status` when you ask "anything waiting on my desk?".
// So the desk is never served beyond this machine (proxy.ts stays as it is): it only sends, the Pi only receives.
//
// Off unless MUSE_BRIDGE_URL and MUSE_BRIDGE_TOKEN are set. A send never throws and never holds up the run that made it:
// the bridge being off or unreachable is logged and forgotten. Nothing here submits, sends an email or approves anything.

import { pool } from "../db";

const SEND_TIMEOUT_MS = 8_000;
/** The bridge refuses longer texts; a Muse chat message has no use for more. */
export const MAX_TEXT = 4_000;
const LIST_MAX = 10;

export type MuseEventKind = "daily_run" | "daily_failed" | "inbox" | "test" | "snapshot";

export type DeskSnapshot = {
  generated_at: string;
  desk_url: string;
  awaiting_approval: { count: number; items: { company: string; title: string; location: string | null; filled_at: string | null }[] };
  needs_you: { count: number; items: { company: string; title: string; reason: string | null; at: string | null }[] };
  pipeline: Record<string, number>;
  submitted_today: number;
  followups_due: number;
  latest_daily_run: {
    started_at: string;
    finished_at: string | null;
    new_companies: number;
    new_jobs: number;
    waiting_approval: number;
    ended: string | null;
  } | null;
};

export type MuseEvent = { kind: MuseEventKind; text?: string | null };

export type SendResult = { ok: boolean; detail: string };

type BridgeConfig = { url: string; token: string };

/** The bridge's /event address and token, or null when Muse is not set up (or the URL is not http/https). */
export function bridgeConfig(env: Record<string, string | undefined> = process.env): BridgeConfig | null {
  const raw = env.MUSE_BRIDGE_URL?.trim();
  const token = env.MUSE_BRIDGE_TOKEN?.trim();
  if (!raw || !token) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // "http://pi.local:8788" and "http://pi.local:8788/" both mean the bridge; its endpoint is /event.
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/event";
  return { url: url.toString(), token };
}

export function museConfigured(): boolean {
  return bridgeConfig() !== null;
}

function deskUrl(): string {
  return process.env.DESK_PUBLIC_URL?.trim() || "http://127.0.0.1:3001";
}

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

/** What Muse needs to answer "what's on my desk?": read-only, a handful of small queries. */
export async function deskSnapshot(): Promise<DeskSnapshot> {
  const [awaiting, needsYou, pipeline, today, followups, daily] = await Promise.all([
    // The same rule as /approvals (lib/apply/approval.ts listAwaitingApproval), without the columns Muse has no use for.
    pool.query<{ company: string; title: string; location: string | null; filled_at: Date | null; total: string }>(
      `WITH latest AS (
         SELECT DISTINCT ON (r.application_id) r.application_id, r.state, r.finished_at
           FROM portal_runs r
          ORDER BY r.application_id, r.started_at DESC
       )
       SELECT c.name AS company, j.title, j.location, l.finished_at AS filled_at, count(*) OVER () AS total
         FROM latest l
         JOIN applications a ON a.id = l.application_id
         JOIN jobs j ON j.id = a.job_id
         JOIN companies c ON c.id = j.company_id
        WHERE l.state = 'ready_to_submit'
          AND a.status IN ('qualified', 'ready')
          AND a.approval_dismissed_at IS NULL
          AND j.closed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM portal_runs s WHERE s.application_id = a.id AND s.state = 'submitted')
        ORDER BY l.finished_at DESC NULLS LAST
        LIMIT ${LIST_MAX}`,
    ),
    // Runs from the last week that stopped on something only you can do (CAPTCHA, SMS code, ID check...), for
    // applications that were not submitted since.
    pool.query<{ company: string; title: string; reason: string | null; at: Date | null; total: string }>(
      `WITH latest AS (
         SELECT DISTINCT ON (r.application_id) r.application_id, r.company_name, r.role_title, r.blocked_reason,
                r.flow_state, r.finished_at, r.started_at
           FROM portal_runs r
          ORDER BY r.application_id, r.started_at DESC
       )
       SELECT l.company_name AS company, l.role_title AS title, l.blocked_reason AS reason,
              COALESCE(l.finished_at, l.started_at) AS at, count(*) OVER () AS total
         FROM latest l
         JOIN applications a ON a.id = l.application_id
        WHERE l.flow_state = 'MANUAL_INTERVENTION_REQUIRED'
          AND l.started_at > now() - interval '7 days'
          AND a.status NOT IN ('applied', 'rejected', 'withdrawn', 'accepted')
        ORDER BY at DESC NULLS LAST
        LIMIT ${LIST_MAX}`,
    ).catch((err) => {
      // Before schema-v18.sql there is no flow_state: nothing is known to need you.
      if ((err as { code?: string }).code === "42703") return { rows: [] as never[] };
      throw err;
    }),
    pool.query<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM applications GROUP BY status`),
    pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM portal_runs WHERE state = 'submitted' AND COALESCE(finished_at, started_at) >= date_trunc('day', now())`,
    ),
    pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM followups WHERE due_on <= current_date AND state IN ('pending', 'drafted')`,
    ),
    pool.query<{ started_at: Date; finished_at: Date | null; new_companies: number; new_jobs: number; waiting_approval: number; notes: string | null }>(
      `SELECT started_at, finished_at, new_companies, new_jobs, waiting_approval, notes FROM daily_runs ORDER BY started_at DESC LIMIT 1`,
    ).catch((err) => {
      // Before schema-v17.sql there is no daily_runs table.
      if ((err as { code?: string }).code === "42P01") return { rows: [] as never[] };
      throw err;
    }),
  ]);

  const d = daily.rows[0];
  return {
    generated_at: new Date().toISOString(),
    desk_url: deskUrl(),
    awaiting_approval: {
      count: Number(awaiting.rows[0]?.total ?? 0),
      items: awaiting.rows.map((r) => ({ company: r.company, title: r.title, location: r.location, filled_at: iso(r.filled_at) })),
    },
    needs_you: {
      count: Number(needsYou.rows[0]?.total ?? 0),
      items: needsYou.rows.map((r) => ({ company: r.company, title: r.title, reason: r.reason, at: iso(r.at) })),
    },
    pipeline: Object.fromEntries(pipeline.rows.map((r) => [r.status, Number(r.n)])),
    submitted_today: Number(today.rows[0]?.n ?? 0),
    followups_due: Number(followups.rows[0]?.n ?? 0),
    latest_daily_run: d
      ? {
          started_at: d.started_at.toISOString(),
          finished_at: iso(d.finished_at),
          new_companies: d.new_companies,
          new_jobs: d.new_jobs,
          waiting_approval: d.waiting_approval,
          // The first note line is "ended: <why> · Claude tokens used: <n>" (lib/registry/daily.ts), or "failed: <why>".
          ended: d.notes?.split("\n")[0] ?? null,
        }
      : null,
  };
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

/** POST one event to the bridge. Never throws. */
export async function postToBridge(
  body: { kind: MuseEventKind; text: string | null; snapshot: DeskSnapshot | null },
  config: BridgeConfig | null = bridgeConfig(),
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<SendResult> {
  if (!config) return { ok: false, detail: "Muse is not set up (MUSE_BRIDGE_URL / MUSE_BRIDGE_TOKEN)" };
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ ...body, text: body.text ? clip(body.text) : null, sent_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    const reply = (await res.text().catch(() => "")).slice(0, 300);
    return res.ok ? { ok: true, detail: reply || `HTTP ${res.status}` } : { ok: false, detail: `HTTP ${res.status} ${reply}`.trim() };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return { ok: false, detail: e.cause?.code ?? (e.name === "TimeoutError" ? `no answer in ${timeoutMs / 1000} s` : e.message) };
  }
}

/**
 * Tell Muse something, with a fresh snapshot of the desk. A kind of "snapshot" with no text only refreshes what
 * `desk-status` shows on the Pi; nothing appears in the Muse chat. Never throws; returns what happened.
 */
export async function notifyMuse(event: MuseEvent): Promise<SendResult> {
  const config = bridgeConfig();
  if (!config) return { ok: false, detail: "Muse is not set up (MUSE_BRIDGE_URL / MUSE_BRIDGE_TOKEN)" };
  let snapshot: DeskSnapshot | null = null;
  try {
    snapshot = await deskSnapshot();
  } catch (err) {
    // The message still goes: the snapshot is the extra.
    console.error(`[muse] desk snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = await postToBridge({ kind: event.kind, text: event.text ?? null, snapshot }, config);
  if (!result.ok) console.error(`[muse] not delivered: ${result.detail}`);
  return result;
}

// -- Messages ----------------------------------------------------------------------------------------------------------

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The Muse message at the end of a daily careers run (scripts/daily.ts). */
export function dailyRunMessage(s: {
  newCompanies: number;
  newJobs: number;
  filled: number | null;
  waitingApproval: number;
  ended: string;
  deskUrl?: string;
}): string {
  const lines = [
    `Internship desk: today's careers run is done (${s.ended}).`,
    `${plural(s.newCompanies, "new company", "new companies")}, ${plural(s.newJobs, "new posting")}` +
      (s.filled != null ? `, ${plural(s.filled, "form")} filled.` : "."),
  ];
  lines.push(
    s.waitingApproval
      ? `${plural(s.waitingApproval, "application")} ${s.waitingApproval === 1 ? "waits" : "wait"} for my approval: ${s.deskUrl ?? deskUrl()}/approvals`
      : "Nothing waits for my approval.",
  );
  return lines.join("\n");
}

// No email subject or body: those are written by whoever sent the email, and Muse can run commands on the gadget. The
// company and posting are the desk's own records.
export type InboxChange = { company: string; title: string; label: string };

/** Inbox labels (lib/classify.ts) worth telling you about, most important first. */
const NEWS: [label: string, words: string][] = [
  ["offer", "offer"],
  ["interview", "interview"],
  ["assessment", "assessment"],
  ["rejection", "rejection"],
  ["confirmation", "application received"],
];

/** The Muse message after an inbox sync moved applications (scripts/sync-inbox.ts); null when there is no news. */
export function inboxMessage(changes: InboxChange[]): string | null {
  const rank = (label: string) => NEWS.findIndex(([l]) => l === label);
  const news = changes.filter((c) => rank(c.label) >= 0).sort((a, b) => rank(a.label) - rank(b.label));
  if (!news.length) return null;
  const lines = news.slice(0, LIST_MAX).map((c) => `- ${NEWS[rank(c.label)][1]}: ${c.company}, ${c.title.slice(0, 120)}`);
  if (news.length > LIST_MAX) lines.push(`- and ${news.length - LIST_MAX} more on the desk`);
  return [`Internship desk: ${plural(news.length, "employer email")} just came in.`, ...lines].join("\n");
}
