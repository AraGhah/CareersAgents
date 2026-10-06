// The daily run, careers page first:
//   1. new companies: freehire's recent internships around here, and the careers sites of companies with no board yet
//      (lib/registry/expand.ts)
//   2. every careers board in the registry read (lib/registry/crawl.ts, through runFindInternships), then the usual
//      scoring, tracking and preparation (company research, cover letter, routing to the careers form)
//   3. the best postings' careers forms filled and validated in a hidden browser (the auto-apply batch), college postings
//      first. With PORTAL_SUBMIT=approve they then wait on /approvals: nothing is submitted until you approve it.
// With a window (`until`, DAILY_UNTIL: 9:00 to 15:00 by default from `automate` and the scheduled task), step 3 keeps going
// batch after batch until the window closes or the Claude tokens are finished; when it runs out of postings it looks for
// new ones again (steps 1 and 2) every two hours.

import { pool } from "../db";
import { runFindInternships } from "../workflow";
import { withLock } from "../db-lock";
import { tokensExhausted, tokensUsed } from "../claude";
import { listAwaitingApproval } from "../apply/approval";
import { submitMode } from "../apply/submit";
import { configuredMinScore } from "../auto-apply/select";
import { createRun, liveRun } from "../auto-apply/store";
import { runAutoApply } from "../auto-apply/run";
import { expandRegistry, type ExpandSummary } from "./expand";
import { registryStats, type RegistryStats } from "./store";

export type DailyOptions = {
  /** Careers forms per batch (and, without a window, for the whole run); 0 = find and prepare only. */
  count: number;
  /** Companies with no board whose careers site is read this run. */
  lookups: number;
  /** Keep filling forms until this moment (or until the tokens are finished). Null: one batch, then stop. */
  until?: Date | null;
  log?: (line: string) => void;
};

export type DailySummary = {
  runId: string;
  expand: ExpandSummary;
  discovery: { boards: number; inserted: number; qualified: number; prepared: number; notes: string[] };
  filled: { counted: number; batches: number; note: string } | null;
  waitingApproval: number;
  registry: RegistryStats;
  /** Why the run ended: the window closed, the tokens are finished, nothing left to apply to, or one batch done. */
  ended: string;
};

/** DAILY_APPLY_COUNT (default 10): careers forms per batch. */
export function dailyCount(): number {
  const n = Number(process.env.DAILY_APPLY_COUNT);
  return process.env.DAILY_APPLY_COUNT?.trim() && Number.isInteger(n) && n >= 0 && n <= 50 ? n : 10;
}

/** "15:00" → today at 15:00 local time (null when the text is not a time, or that moment has passed). */
export function todayAt(hhmm: string | null | undefined, now = new Date()): Date | null {
  const m = hhmm?.trim().match(/^(\d{1,2})(?::|h)(\d{2})$/i);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const at = new Date(now);
  at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return at.getTime() > now.getTime() ? at : null;
}

/** How far back to ask freehire: a month on the first run, then since the last run with a margin. */
async function freehireWindow(): Promise<number> {
  const { rows } = await pool.query<{ days: number | null }>(
    `SELECT EXTRACT(EPOCH FROM now() - max(started_at)) / 86400 AS days FROM daily_runs WHERE finished_at IS NOT NULL`,
  );
  const since = rows[0]?.days;
  return since == null ? 30 : Math.min(30, Math.max(3, Math.ceil(Number(since)) + 2));
}

const REFIND_MS = 2 * 60 * 60 * 1000;

type Found = Awaited<ReturnType<typeof runFindInternships>>;

/** Steps 1 and 2: new companies, every careers board read, then scoring, tracking and preparation. */
async function find(opts: { withinDays: number; lookups: number; boardMaxAgeHours: number; log: (line: string) => void }): Promise<{ expand: ExpandSummary; found: Found }> {
  const { log } = opts;
  log(`1/3 New companies: freehire (last ${opts.withinDays} day(s)) and ${opts.lookups} careers site(s) to read…`);
  const expand = await expandRegistry({ withinDays: opts.withinDays, lookups: opts.lookups, log: (l) => log(`    ${l}`) });
  log(
    `    ${expand.newCompanies.length} new compan${expand.newCompanies.length === 1 ? "y" : "ies"}, ${expand.newBoards} new board(s)` +
      (expand.freehire.error ? ` · freehire: ${expand.freehire.error}` : ` · freehire: ${expand.freehire.aroundHere} internship(s) around here of ${expand.freehire.fetched}`),
  );
  if (expand.newCompanies.length) log(`    new: ${expand.newCompanies.slice(0, 40).join(", ")}${expand.newCompanies.length > 40 ? "…" : ""}`);
  log("2/3 Reading every careers board, scoring, tracking, preparing…");
  const found = await runFindInternships({ boardMaxAgeHours: opts.boardMaxAgeHours });
  log(`    ${found.boards} board(s) read · ${found.inserted} new posting(s) · ${found.qualified} qualified · ${found.prepared} prepared`);
  return { expand, found };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runDaily(opts: DailyOptions): Promise<DailySummary> {
  // One daily run at a time, whoever starts it (the scheduled task, `automate`, a terminal).
  const held = await withLock("daily", "run", () => runDailyLocked(opts), { wait: false });
  if (!held.ok) throw new Error("A daily run is already working (scheduled task, automate or another terminal): this one does not start.");
  return held.value;
}

async function runDailyLocked(opts: DailyOptions): Promise<DailySummary> {
  const log = opts.log ?? (() => undefined);
  const until = opts.until ?? null;
  const withinDays = await freehireWindow();
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO daily_runs DEFAULT VALUES RETURNING id`);
  const runId = rows[0].id;
  const notes: string[] = [];
  try {
    if (until) log(`Window: until ${until.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })}, or until the Claude tokens are finished.`);
    // Every board not read in the last 20 hours: all of them, once a day.
    const first = await find({ withinDays, lookups: opts.lookups, boardMaxAgeHours: 20, log });
    const expand = first.expand;
    let found = first.found;
    let inserted = found.inserted;
    let prepared = found.prepared;
    notes.push(...found.errors.filter((e) => !/skipped:/.test(e)).slice(0, 30));
    let lastFind = Date.now();

    let filled: DailySummary["filled"] = null;
    let ended = "one batch done";
    const mode = submitMode();
    const timeUp = () => !!until && Date.now() >= until.getTime();
    if (opts.count > 0 && mode !== "off") {
      process.env.PORTAL_HEADLESS ??= "true";
      let counted = 0;
      let batches = 0;
      let note = "";
      for (;;) {
        const out = tokensExhausted();
        if (out) {
          ended = `the Claude tokens are finished (${out})`;
          break;
        }
        if (timeUp()) {
          ended = "the window closed";
          break;
        }
        if (await liveRun()) {
          log("3/3 An auto-apply batch is already running: waiting for it.");
          if (!until) {
            ended = "another batch was running";
            break;
          }
          await sleep(5 * 60_000);
          continue;
        }
        batches += 1;
        log(`3/3 Batch ${batches}: filling the ${opts.count} best careers form(s), college postings first (${mode === "approve" ? "they wait for your approval on /approvals" : "PORTAL_SUBMIT=auto: submitted when every check passes"})…`);
        const batch = await createRun(opts.count, configuredMinScore());
        const result = await runAutoApply(batch, { log: (l) => log(`    ${l}`), deadline: until });
        counted += result.counted;
        note = result.note;
        log(`    ${result.note}`);
        if (!until) break;
        if (result.counted >= opts.count) continue;
        // The list ran out before the batch was full: nothing more to apply to right now. New postings are looked for
        // every two hours, while the window lasts.
        const next = lastFind + REFIND_MS;
        if (until && next >= until.getTime()) {
          ended = "nothing left to apply to before the window closes";
          break;
        }
        if (Date.now() < next) {
          log(`Nothing more to fill for now: looking for new postings at ${new Date(next).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })}.`);
          await sleep(next - Date.now());
        }
        if (timeUp()) {
          ended = "the window closed";
          break;
        }
        found = (await find({ withinDays: 1, lookups: Math.min(opts.lookups, 10), boardMaxAgeHours: 2, log })).found;
        inserted += found.inserted;
        prepared += found.prepared;
        lastFind = Date.now();
      }
      filled = { counted, batches, note };
    } else {
      ended = opts.count === 0 ? "no forms asked for (--count 0)" : "PORTAL_SUBMIT=off";
      log(`3/3 Skipped: ${ended}.`);
    }

    const waitingApproval = (await listAwaitingApproval()).length;
    notes.unshift(`ended: ${ended} · Claude tokens used: ${tokensUsed()}`);
    await pool.query(
      `UPDATE daily_runs
          SET finished_at = now(), new_companies = $2, new_boards = $3, boards_crawled = $4, new_jobs = $5,
              prepared = $6, waiting_approval = $7, notes = $8
        WHERE id = $1`,
      [runId, expand.newCompanies.length, expand.newBoards, found.boards, inserted, prepared, waitingApproval, notes.join("\n") || null],
    );
    return {
      runId,
      expand,
      discovery: { boards: found.boards, inserted, qualified: found.qualified, prepared, notes },
      filled,
      waitingApproval,
      registry: await registryStats(),
      ended,
    };
  } catch (err) {
    await pool.query(`UPDATE daily_runs SET finished_at = now(), notes = $2 WHERE id = $1`, [runId, `failed: ${err instanceof Error ? err.message : String(err)}`]);
    throw err;
  }
}

export type DailyRunRow = {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  new_companies: number;
  new_boards: number;
  boards_crawled: number;
  new_jobs: number;
  prepared: number;
  waiting_approval: number;
  notes: string | null;
};

export async function latestDailyRun(): Promise<DailyRunRow | null> {
  const { rows } = await pool.query<DailyRunRow>(`SELECT * FROM daily_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ?? null;
}
