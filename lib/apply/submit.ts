// The only code in the repository allowed to press a final Submit button
// (scripts/assist-check.ts enforces that). It refuses unless the preflight passed,
// which already includes PORTAL_ALLOW_SUBMIT=true, the duplicate re-check and the
// CAPTCHA check. After the click it waits for a confirmation it can read; no
// confirmation, no "submitted".

import type { Page } from "playwright";
import { detectCaptcha, visibleFormErrors } from "./browser/guards";
import { confirmationText, isNextStepButton, type PlatformAdapter } from "./platforms";
import { preflightPasses } from "./preflight";
import type { PreflightItem } from "./types";

export function submitEnabled(): boolean {
  return process.env.PORTAL_ALLOW_SUBMIT?.trim().toLowerCase() === "true";
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
  opts: { beforeClick?: () => Promise<void> } = {},
): Promise<SubmitOutcome> {
  if (!submitEnabled()) return { state: "blocked", reason: "PORTAL_ALLOW_SUBMIT is not true.", maybeSent: false };
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
