// The only code in the repository allowed to press a final Submit button
// (scripts/assist-check.ts enforces that). It refuses unless the preflight passed,
// which already includes the submit permission (your approval, or PORTAL_SUBMIT=auto), the duplicate re-check and the
// CAPTCHA check. After the click it waits for a confirmation it can read; no
// confirmation, no "submitted".

import type { Page } from "playwright";
import { detectCaptcha, visibleFormErrors } from "./browser/guards";
import { confirmationText, isNextStepButton, type PlatformAdapter } from "./platforms";
import { preflightPasses } from "./preflight";
import type { PreflightItem } from "./types";

/**
 * Who presses Submit on a filled careers form:
 *   approve (the default): you. The desk fills and validates the form, it waits on /approvals, and only your
 *                          "Approuver et envoyer" lets a run submit it (applications.submit_approved_at).
 *   auto:                  the desk, whenever every preflight gate passes (what PORTAL_ALLOW_SUBMIT=true used to mean).
 *   off:                   nobody: forms are filled and left for you to submit in a window.
 * PORTAL_SUBMIT sets it; without it, PORTAL_ALLOW_SUBMIT=true still means "auto" and anything else "approve".
 */
export type SubmitMode = "approve" | "auto" | "off";

export function submitMode(): SubmitMode {
  const set = process.env.PORTAL_SUBMIT?.trim().toLowerCase();
  if (set === "approve" || set === "auto" || set === "off") return set;
  return process.env.PORTAL_ALLOW_SUBMIT?.trim().toLowerCase() === "true" ? "auto" : "approve";
}

/** May this run press Submit? `approvedByYou`: the application carries your approval of its filled form. */
export function submitEnabled(approvedByYou = false): boolean {
  const mode = submitMode();
  return mode === "auto" || (mode === "approve" && approvedByYou);
}

/**
 * `maybeSent`: the button was clicked and the portal may have taken the application even though it did not confirm
 * (no confirmation page, a challenge after the click). Such a run is never retried automatically.
 */
export type SubmitOutcome =
  | { state: "submitted"; confirmation: string }
  | { state: "blocked"; reason: string; maybeSent: boolean }
  | { state: "unconfirmed"; reason: string; maybeSent: true };

export async function submitApplication(
  page: Page,
  adapter: PlatformAdapter,
  preflight: PreflightItem[],
  opts: { beforeClick?: () => Promise<void>; approvedByYou?: boolean } = {},
): Promise<SubmitOutcome> {
  if (!submitEnabled(opts.approvedByYou === true)) {
    return { state: "blocked", reason: submitMode() === "off" ? "PORTAL_SUBMIT=off: the form is left for you." : "Waiting for your approval (PORTAL_SUBMIT=approve).", maybeSent: false };
  }
  if (!preflightPasses(preflight)) {
    return { state: "blocked", reason: preflight.filter((i) => !i.ok && i.blocking).map((i) => i.label).join("; "), maybeSent: false };
  }

  let button = null;
  for (const sel of adapter.submitSelectors) {
    const candidate = page.locator(sel).filter({ visible: true }).first();
    // On a multi-step form "Next" is often a type=submit button too: it is never the final Submit.
    if ((await candidate.count()) > 0 && !(await isNextStepButton(candidate))) {
      button = candidate;
      break;
    }
  }
  if (!button) return { state: "blocked", reason: "Could not find the form's submit button.", maybeSent: false };
  if (!(await button.isEnabled())) return { state: "blocked", reason: "The submit button is disabled: the form is not complete.", maybeSent: false };

  const before = page.url();
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  // Recorded before the click, so even a crash right after it leaves "this may have been sent" behind.
  await opts.beforeClick?.();
  await button.click();

  // Up to 30s for the confirmation; stop early on a challenge or on validation errors.
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const confirmation = await confirmationText(page, adapter);
    if (confirmation) return { state: "submitted", confirmation };
    const captcha = await detectCaptcha(page);
    if (captcha.challenge) return { state: "blocked", reason: `${captcha.kind} challenge appeared after Submit: solve it in the browser.`, maybeSent: true };
    const errors = await visibleFormErrors(page);
    if (errors.length && page.url() === before && i >= 2) return { state: "blocked", reason: `The form rejected the submission: ${errors.join("; ")}`, maybeSent: false };
  }
  return { state: "unconfirmed", reason: "Submit was clicked but no confirmation appeared. Check the browser before retrying.", maybeSent: true };
}
