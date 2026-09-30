// The only code in the repository allowed to press a final Submit button
// (scripts/assist-check.ts enforces that). It refuses unless the preflight passed,
// which already includes PORTAL_ALLOW_SUBMIT=true, the duplicate re-check and the
// CAPTCHA check. After the click it waits for a confirmation it can read; no
// confirmation, no "submitted".

import type { Page } from "playwright";
import { detectCaptcha, visibleFormErrors } from "./browser/guards";
import { confirmationText, type PlatformAdapter } from "./platforms";
import { preflightPasses } from "./preflight";
import type { PreflightItem } from "./types";

export function submitEnabled(): boolean {
  return process.env.PORTAL_ALLOW_SUBMIT?.trim().toLowerCase() === "true";
}

export type SubmitOutcome =
  | { state: "submitted"; confirmation: string }
  | { state: "blocked"; reason: string }
  | { state: "unconfirmed"; reason: string };

export async function submitApplication(page: Page, adapter: PlatformAdapter, preflight: PreflightItem[]): Promise<SubmitOutcome> {
  if (!submitEnabled()) return { state: "blocked", reason: "PORTAL_ALLOW_SUBMIT is not true." };
  if (!preflightPasses(preflight)) {
    return { state: "blocked", reason: preflight.filter((i) => !i.ok && i.blocking).map((i) => i.label).join("; ") };
  }

  let button = null;
  for (const sel of adapter.submitSelectors) {
    const candidate = page.locator(sel).filter({ visible: true }).first();
    if ((await candidate.count()) > 0) {
      button = candidate;
      break;
    }
  }
  if (!button) return { state: "blocked", reason: "Could not find the form's submit button." };
  if (!(await button.isEnabled())) return { state: "blocked", reason: "The submit button is disabled: the form is not complete." };

  const before = page.url();
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click();

  // Up to 30s for the confirmation; stop early on a challenge or on validation errors.
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const confirmation = await confirmationText(page, adapter);
    if (confirmation) return { state: "submitted", confirmation };
    const captcha = await detectCaptcha(page);
    if (captcha.challenge) return { state: "blocked", reason: `${captcha.kind} challenge appeared after Submit: solve it in the browser.` };
    const errors = await visibleFormErrors(page);
    if (errors.length && page.url() === before && i >= 2) return { state: "blocked", reason: `The form rejected the submission: ${errors.join("; ")}` };
  }
  return { state: "unconfirmed", reason: "Submit was clicked but no confirmation appeared. Check the browser before retrying." };
}
