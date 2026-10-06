// Portal applications from the command line.
//   npm run portal -- --application <uuid>                 plan (headless): read the form, draft answers
//   npm run portal -- --application <uuid> --mode review   fill in a visible browser, you press Submit
//   npm run portal -- --application <uuid> --mode submit   fill, validate, submit if every gate passes
//   npm run portal -- --queue plan                         plan every portal application without a plan
//   npm run portal -- --queue submit                       execute every complete (approved) plan
//   npm run portal -- --queue approved                     submit, headless, every filled form you approved on /approvals
//   npm run portal -- --route                              set email / portal / manual on every waiting application (no browser)
// An employer portal that asks for an account (Workday, iCIMS...): a run for ONE application (--application) signs in to, or
// creates, the account in .env.local (PORTAL_ACCOUNT_EMAIL / PORTAL_ACCOUNT_PASSWORD, PORTAL_CREATE_ACCOUNTS=true);
// --no-accounts turns that off for the run. --queue and `automate` never open accounts.
// Flags: --headed (show the browser in plan mode), --force-portal (use the form even if a contact exists),
//        --keep-open (no terminal: keep the browser until you close its window; used by the desk's buttons).
// Submit needs your approval on /approvals (PORTAL_SUBMIT=approve, the default) or PORTAL_SUBMIT=auto; otherwise "submit"
// behaves like "review".

import type { Page } from "playwright";
import { pool } from "../lib/db";
import { usageSummary } from "../lib/claude";
import { resolveApplyTarget } from "../lib/apply/apply-url";
import { decideChannel, saveChannel } from "../lib/apply/route";
import { portalQueue, runPortalApplication, type RunResult } from "../lib/apply/runner";
import { getApplication } from "../lib/queries";
import { approvedQueue } from "../lib/apply/approval";
import { withLock } from "../lib/db-lock";
import type { RunMode } from "../lib/apply/types";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function asMode(raw: string | null): RunMode {
  if (!raw) return "plan";
  if (raw === "plan" || raw === "review" || raw === "submit") return raw;
  throw new Error(`--mode must be plan, review or submit (got ${raw})`);
}

const waitForEnter = async () => {
  console.log("\nThe browser stays open. Review, finish anything highlighted in red, submit it yourself if you want.");
  console.log("Press Enter here when you are done (a confirmation page on screen is recorded as submitted).");
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
};

/** Without a terminal (launched from the desk): wait until the person closes the window, at most 45 minutes. */
const waitForWindowClose = (page: Page) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 45 * 60 * 1000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    page.once("close", done);
    page.context().browser()?.once("disconnected", done);
  });

function report(r: RunResult) {
  console.log(`\n→ ${r.state}${r.runId ? ` (run ${r.runId.slice(0, 8)})` : ""}: ${r.reason}`);
  const waiting = r.decisions.filter((d) => d.status === "manual" || d.status === "generated");
  if (waiting.length) {
    console.log(`\n${waiting.length} field(s) for you, on the application page in the desk:`);
    for (const d of waiting) console.log(`  [${d.status === "generated" ? "draft" : "you"}] ${d.label.slice(0, 80)}: ${d.reason}`);
  }
}

async function one(applicationId: string, mode: RunMode) {
  const interactive = mode !== "plan" || flag("headed");
  return runPortalApplication(applicationId, {
    mode,
    headed: flag("headed"),
    forcePortal: flag("force-portal"),
    // One application you named: it may sign in to, or create, the portal account in .env.local. The queue never does.
    allowAccounts: !flag("no-accounts"),
    beforeClose: !interactive
      ? undefined
      : flag("keep-open")
        ? waitForWindowClose
        : process.stdin.isTTY
          ? async () => waitForEnter()
          : undefined,
    log: (line) => console.log(`  ${line}`),
  });
}

/** Routes applications that were prepared before channels existed. A channel a run already set is kept. */
async function routeAll() {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM applications WHERE status IN ('qualified', 'ready') AND channel IS NULL`,
  );
  const tally = new Map<string, number>();
  for (const { id } of rows) {
    const app = await getApplication(id);
    if (!app) continue;
    const target = await resolveApplyTarget(app);
    const decision = await decideChannel(app, { applyUrl: target.url, hint: target.hint });
    await saveChannel(id, decision.channel);
    const key = decision.channel === "portal" ? `portal (${target.via})` : decision.channel;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log(`${rows.length} application(s) routed:`);
  for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
}

/**
 * The forms you approved, one at a time with the usual pause, headless, until none is left (one approved while this runs
 * is picked up too). Only one of these runs at a time: the approve button starts it, and a second start just returns.
 */
async function approvedLoop() {
  const delay = Math.max(30, Number(process.env.PORTAL_DELAY_SECONDS ?? 90)) * 1000;
  const held = await withLock(
    "portal-queue",
    "approved",
    async () => {
      const tried = new Set<string>();
      for (;;) {
        const id = (await approvedQueue()).find((x) => !tried.has(x));
        if (!id) break;
        if (tried.size) await new Promise((r) => setTimeout(r, delay));
        tried.add(id);
        console.log(`
[approved ${tried.size}] ${id}`);
        try {
          report(await runPortalApplication(id, { mode: "submit", headless: true, log: (line) => console.log(`  ${line}`) }));
        } catch (err) {
          console.error(`  failed: ${err instanceof Error ? err.message : String(err)} (logged in portal_errors)`);
        }
      }
      return tried.size;
    },
    { wait: false },
  );
  console.log(held.ok ? `${held.value} approved form(s) handled.` : "The approved queue is already running in another process.");
}

async function main() {
  if (flag("route")) return routeAll();
  if (arg("queue") === "approved") return approvedLoop();
  const applicationId = arg("application");
  const queue = arg("queue");
  if (!applicationId && !queue) {
    console.log("Usage: npm run portal -- --application <uuid> [--mode plan|review|submit] [--headed] [--force-portal]");
    console.log("       npm run portal -- --queue plan|submit|approved");
    console.log("       npm run portal -- --route");
    process.exit(1);
  }

  if (applicationId) {
    report(await one(applicationId, asMode(arg("mode"))));
    return;
  }

  const kind = queue === "submit" ? "execute" : "plan";
  const ids = await portalQueue(kind);
  const delay = Math.max(30, Number(process.env.PORTAL_DELAY_SECONDS ?? 90)) * 1000;
  console.log(`${ids.length} application(s) to ${kind}.`);
  for (const [i, id] of ids.entries()) {
    console.log(`\n[${i + 1}/${ids.length}] ${id}`);
    try {
      report(
        await runPortalApplication(id, {
          mode: kind === "plan" ? "plan" : "submit",
          log: (line) => console.log(`  ${line}`),
        }),
      );
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : String(err)} (logged in portal_errors)`);
    }
    // One at a time, with a pause: quality over volume, and no burst of traffic at any portal.
    if (kind === "execute" && i < ids.length - 1) await new Promise((r) => setTimeout(r, delay));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // What this run asked of Claude, by model: the cheap model for easy tasks, the strong one where it was needed.
    const used = usageSummary();
    if (used) console.log(`\n${used}`);
    return pool.end().catch(() => undefined);
  });
