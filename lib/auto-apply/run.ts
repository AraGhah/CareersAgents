// The batch: take the best-scored postings in order and apply to each until N have gone as far as the desk can take
// them (a Gmail draft ready for you, or a form the portal confirmed). A posting the desk cannot do anything with
// (an account portal, a duplicate, a closed form) is skipped with its reason and does not use up one of the N,
// so asking for 5 means 5 applications, not "the top 5 postings, however many of those were Workday".

import { startApplication, setApplicationStatus } from "../queries";
import { submitEnabled } from "../apply/submit";
import { applyOne, isGmailAuthError, type ApplyContext, type ApplyResult } from "./apply";
import { rankedCandidates, type Candidate } from "./select";
import { finishItem, finishRun, getRun, listItems, startItem, stopRequested, touchRun, type ItemOutcome } from "./store";

export type RunDeps = {
  candidates?: (opts: { minPercent: number; limit: number }) => Promise<Candidate[]>;
  apply?: (applicationId: string, ctx: ApplyContext) => Promise<ApplyResult>;
  /** Tracks a posting that was not tracked yet and returns its application id. */
  track?: (candidate: Candidate) => Promise<string>;
  submitAllowed?: boolean;
  /** Seconds between two online applications. */
  portalDelaySeconds?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

async function trackCandidate(c: Candidate): Promise<string> {
  const id = await startApplication(c.job_id);
  await setApplicationStatus(id, "qualified", "auto-apply: picked by match score");
  return id;
}

/** How far down the list to look: the skipped ones are free, but a list of nothing but forms the desk cannot drive must still end. */
export function lookLimit(requested: number): number {
  return Math.min(80, requested * 3 + 10);
}

export function summarize(counts: Partial<Record<ItemOutcome, number>>, requested: number, stopped: boolean): string {
  const n = (k: ItemOutcome) => counts[k] ?? 0;
  const parts = [
    n("draft") ? `${n("draft")} brouillon${n("draft") > 1 ? "s" : ""} Gmail à envoyer` : null,
    n("sent") ? `${n("sent")} envoyée${n("sent") > 1 ? "s" : ""} par formulaire` : null,
    n("review") ? `${n("review")} à finir toi-même` : null,
    n("skipped") ? `${n("skipped")} ignorée${n("skipped") > 1 ? "s" : ""}` : null,
    n("failed") ? `${n("failed")} en erreur` : null,
  ].filter(Boolean);
  const done = n("draft") + n("sent");
  const head = stopped
    ? "Arrêté."
    : done >= requested
      ? `Objectif atteint : ${done} candidature${done > 1 ? "s" : ""}.`
      : `${done} candidature${done > 1 ? "s" : ""} sur ${requested} demandée${requested > 1 ? "s" : ""} : il n'y avait pas assez d'offres admissibles.`;
  return [head, parts.join(", ")].filter(Boolean).join(" ");
}

export async function runAutoApply(runId: string, deps: RunDeps = {}): Promise<{ counted: number; note: string }> {
  const log = deps.log ?? (() => undefined);
  const run = await getRun(runId);
  if (!run) throw new Error(`auto-apply run not found: ${runId}`);
  if (run.state !== "running") throw new Error(`auto-apply run ${runId} is already ${run.state}`);

  // A long form can take minutes: keep the heartbeat going so the run is not taken for dead.
  const heartbeat = setInterval(() => void touchRun(runId).catch(() => undefined), 30_000);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delayMs = Math.max(30, deps.portalDelaySeconds ?? Number(process.env.PORTAL_DELAY_SECONDS ?? 90)) * 1000;
  let lastPortalAt = 0;
  const ctx: ApplyContext = {
    submitAllowed: deps.submitAllowed ?? submitEnabled(),
    portalExhausted: false,
    // One at a time with a pause, as the portal queue does: no burst of traffic at any employer.
    paceNextPortal: async () => {
      const wait = lastPortalAt + delayMs - Date.now();
      if (lastPortalAt && wait > 0) await sleep(wait);
      lastPortalAt = Date.now();
    },
    log,
  };

  try {
    const candidates = await (deps.candidates ?? rankedCandidates)({ minPercent: run.min_score, limit: lookLimit(run.requested) });
    log(`${candidates.length} posting(s) to go through, best score first; ${run.requested} application(s) wanted.`);

    let counted = 0;
    let position = 0;
    let stopped = false;
    for (const candidate of candidates) {
      if (counted >= run.requested) break;
      if (await stopRequested(runId)) {
        stopped = true;
        break;
      }

      const label = `${candidate.company_name} | ${candidate.title}`;
      let result: ApplyResult;
      let itemId: string | null = null;
      try {
        const applicationId = candidate.application_id ?? (await (deps.track ?? trackCandidate)(candidate));
        itemId = await startItem(runId, ++position, applicationId, candidate.score);
        log(`[${position}] ${Math.round(candidate.score * 100)}  ${label}`);
        result = await (deps.apply ?? applyOne)(applicationId, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = isGmailAuthError(err)
          ? { outcome: "failed", detail: message, channel: "email", counts: false, abort: "Gmail n'est plus connecté : lance « npm run gmail:auth », puis relance." }
          : { outcome: "failed", detail: message, channel: null, counts: false };
      }

      if (itemId) await finishItem(runId, itemId, result.outcome, result.detail, result.channel);
      log(`    → ${result.outcome}: ${result.detail}`);
      if (result.counts) counted += 1;
      if (result.abort) {
        const note = `${result.abort} ${summarize(countOutcomes(await listItems(runId)), run.requested, false)}`;
        await finishRun(runId, "failed", note);
        return { counted, note };
      }
    }

    const note = summarize(countOutcomes(await listItems(runId)), run.requested, stopped);
    await finishRun(runId, stopped ? "stopped" : "done", note);
    return { counted, note };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, "failed", `Erreur : ${message}`);
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

function countOutcomes(items: Array<{ outcome: ItemOutcome }>): Partial<Record<ItemOutcome, number>> {
  const counts: Partial<Record<ItemOutcome, number>> = {};
  for (const i of items) counts[i.outcome] = (counts[i.outcome] ?? 0) + 1;
  return counts;
}
