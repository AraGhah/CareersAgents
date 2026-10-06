import Link from "next/link";
import { startAutoApplyAction } from "../auto-apply-actions";
import { configuredMinScore, countEligible } from "../../lib/auto-apply/select";
import { liveRun } from "../../lib/auto-apply/store";
import { submitMode } from "../../lib/apply/submit";
import { emailFallbackEnabled } from "../../lib/apply/route";
import { gmailIsConnected } from "../../lib/gmail";
import { AutoApplyButton } from "./auto-apply-button";

/**
 * The button for a page header. Reads what the dialog needs to be honest (how many postings qualify, whether Gmail is
 * connected, whether online forms may be submitted). If any of that cannot be read (the v13 tables are missing, the
 * database is down) it falls back to a plain link to the progress page, which says what is wrong.
 */
export async function AutoApplyAction() {
  const minScore = configuredMinScore();
  let state: { eligible: number; runningId: string | null; gmailConnected: boolean } | null = null;
  try {
    const [eligible, running, gmailConnected] = await Promise.all([countEligible(minScore), liveRun(), gmailIsConnected()]);
    state = { eligible, runningId: running?.id ?? null, gmailConnected };
  } catch {
    state = null;
  }

  if (!state) {
    return (
      <Link href="/auto-apply" className="btn">
        Postuler automatiquement
      </Link>
    );
  }
  return (
    <AutoApplyButton
      action={startAutoApplyAction}
      eligible={state.eligible}
      minScore={minScore}
      gmailConnected={state.gmailConnected}
      submitMode={submitMode()}
      emailFallback={emailFallbackEnabled()}
      runningId={state.runningId}
    />
  );
}
