// Things that stop an automatic application, detected, never worked around:
//   - a CAPTCHA a person has to solve (the desk never solves or evades one)
//   - a login / account wall (Workday, iCIMS, LinkedIn Easy Apply…)
//   - validation errors the form itself shows after filling
// An invisible score-based CAPTCHA badge (reCAPTCHA v3, which many Greenhouse
// boards carry) is noted but not a stop by itself; a challenge that appears
// after Submit is.

import type { Page } from "playwright";
import { ensureEvalShim } from "./shim";

export type CaptchaState = { present: boolean; challenge: boolean; kind: string | null };

export async function detectCaptcha(page: Page): Promise<CaptchaState> {
  await ensureEvalShim(page);
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el as HTMLElement);
      return r.width > 30 && r.height > 30 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
    };
    const frames = Array.from(document.querySelectorAll("iframe"));
    const find = (re: RegExp) => frames.filter((f) => re.test(f.src || f.getAttribute("title") || ""));
    const recaptchaAnchor = find(/recaptcha\/(api2|enterprise)\/anchor/);
    const recaptchaChallenge = find(/recaptcha\/(api2|enterprise)\/bframe/);
    const hcaptcha = find(/hcaptcha\.com/);
    const turnstile = find(/challenges\.cloudflare\.com/);
    const widgets = Array.from(document.querySelectorAll(".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]"));

    const visibleChallenge =
      recaptchaChallenge.some(shown) ||
      // A visible checkbox anchor (v2) needs a click by a person; the invisible badge does not.
      recaptchaAnchor.some((f) => shown(f) && !/size=invisible/.test(f.src)) ||
      hcaptcha.some(shown) ||
      turnstile.some(shown);
    const present = recaptchaAnchor.length + recaptchaChallenge.length + hcaptcha.length + turnstile.length + widgets.length > 0;
    const kind = hcaptcha.length ? "hCaptcha" : turnstile.length ? "Cloudflare Turnstile" : present ? "reCAPTCHA" : null;
    return { present, challenge: visibleChallenge, kind };
  });
}

export async function detectLoginWall(page: Page): Promise<string | null> {
  const url = page.url();
  if (/linkedin\.com\/(login|checkpoint|authwall)|linkedin\.com\/jobs\/.*easy.?apply/i.test(url)) return "LinkedIn requires signing in.";
  if (/indeed\.com\/(account|auth)|secure\.indeed\.com/i.test(url)) return "Indeed requires signing in.";
  if (/myworkdayjobs\.com|workday\.com/i.test(url)) {
    const hasSignIn = await page.getByRole("button", { name: /sign in|create account|se connecter|cr[ée]er un compte/i }).count();
    if (hasSignIn) return "Workday requires creating an account on the company's portal.";
  }
  const passwords = await page.locator("input[type='password']:visible").count();
  const fields = await page.locator("input:visible, textarea:visible, select:visible").count();
  if (passwords > 0 && fields <= 4) return "The portal asks you to sign in or create an account.";
  return null;
}

/** Error messages the form shows next to fields after an attempt to validate or submit. */
export async function visibleFormErrors(page: Page): Promise<string[]> {
  await ensureEvalShim(page);
  return page.evaluate(() => {
    const out = new Set<string>();
    const shown = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== "hidden";
    };
    for (const el of Array.from(
      document.querySelectorAll("[role='alert'], .error, .errors, .field-error, .error-message, [class*='error-message'], [class*='errorMessage'], [class*='invalid-feedback'], [aria-live='assertive']"),
    )) {
      const t = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
      if (t && t.length < 240 && shown(el)) out.add(t);
    }
    for (const el of Array.from(document.querySelectorAll("[aria-invalid='true']"))) {
      if (!shown(el)) continue;
      const id = el.getAttribute("aria-describedby");
      const msg = id ? document.getElementById(id)?.innerText?.trim() : "";
      out.add(msg || `invalid: ${el.getAttribute("name") ?? el.getAttribute("id") ?? el.tagName.toLowerCase()}`);
    }
    return [...out].slice(0, 20);
  });
}

const CLOSED =
  /job (you requested )?(was )?not found|job not found|(this |the )?(job|position|posting|role|opportunity) (is |has been )?(no longer (available|accepting|open)|closed|filled|expired)|no longer accepting applications|page (you requested )?(could not be|was not) found|(the )?page you are looking for (doesn'?t|does not) exist|cette page n'existe pas|la page (que vous cherchez|demand[ée]e) n'existe pas|offre (n'est plus disponible|expir[ée]e|introuvable|pourvue|ferm[ée]e)|ce poste (n'est plus|a [ée]t[ée] pourvu)|n'accepte plus de candidatures/i;

/** The portal says the posting is gone (closed, filled, expired, 404). */
export async function detectClosedPosting(page: Page): Promise<string | null> {
  const path = (() => {
    try {
      return new URL(page.url()).pathname;
    } catch {
      return "";
    }
  })();
  if (/\/(closed|expired|job-closed|no-longer-available)(\/|$)/i.test(path)) return `redirected to ${path}`;
  const text = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 4000);
  return text.match(CLOSED)?.[0] ?? null;
}
