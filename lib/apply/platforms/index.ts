// One adapter per applicant-tracking system the desk discovers postings from
// (lib/discover-core.ts), plus a generic one. An adapter only knows where things
// are: the form URL for a posting, the form's root element, how to reveal it,
// what the final submit control looks like, and what a confirmation looks like.
// It never clicks submit itself; lib/apply/submit.ts is the only place that does.

import type { Page } from "playwright";
import { ensureEvalShim as ensureShim } from "../browser/shim";
import type { PlatformId } from "../types";

export type PlatformContext = { boardToken: string | null; externalId: string | null };

export type PlatformAdapter = {
  id: PlatformId;
  label: string;
  matches(url: string): boolean;
  formUrl(postingUrl: string, ctx: PlatformContext): string;
  /** Candidate selectors for the form root, first present wins; null = whole page. */
  scopes: string[];
  /** Platform-specific step before the shared revealApplicationForm. Never presses a final submit. */
  reveal(page: Page): Promise<void>;
  /** Selectors for the final submit control, in order of preference. */
  submitSelectors: string[];
  confirmationUrl: RegExp;
};

const CONFIRM_TEXT =
  /thank(s| you) for (applying|your application|your interest)|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|merci (d'avoir postul[ée]|pour votre candidature)|candidature (a (bien )?[ée]t[ée] )?(envoy[ée]e|re[çc]ue|soumise)/i;

/** Posting URL without tracking params, fragment, trailing slash or the /apply suffix (Lever, Ashby, Workable split one job across two URLs). */
export function canonicalPostingUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src|source|src|ref|lever-|trk|refId|trackingId)/i.test(key)) u.searchParams.delete(key);
    }
    u.pathname = u.pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "");
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

const OPENERS = /^(apply|apply now|apply online|apply for this (job|position|role)|apply to this job|start (your )?application|postuler|postuler maintenant|postuler en ligne|je postule|soumettre ma candidature)$/i;

// Cookie / consent banners cover the page and swallow clicks. The least-consent choice is taken first;
// "accept" only when the banner offers nothing else, because the form cannot be reached otherwise.
const CONSENT_PREFERRED = /^(reject all|reject|decline|decline all|refuse all|only necessary|necessary only|use necessary cookies only|accept (only )?(necessary|essential)( cookies)?|continue without accepting|tout refuser|refuser|refuser tout|continuer sans accepter|n[ée]cessaires uniquement)$/i;
const CONSENT_FALLBACK = /^(accept all|accept|accept cookies|accept all cookies|allow all|allow cookies|i agree|agree|got it|ok|okay|tout accepter|accepter|j'accepte|accepter et fermer)$/i;
const CONSENT_KNOWN = [
  "#onetrust-reject-all-handler",
  ".cmpboxbtnno",
  "#CybotCookiebotDialogBodyButtonDecline",
  "#truste-consent-required",
  "#onetrust-accept-btn-handler",
  ".cmpboxbtnyes",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#truste-consent-button",
];
const CONSENT_SCOPE =
  "[id*='cookie' i], [class*='cookie' i], [id*='consent' i], [class*='consent' i], [id*='cmp' i], [class*='cmp' i], [id*='privacy' i], [role='dialog'], [aria-modal='true']";

async function clickText(page: Page, re: RegExp): Promise<boolean> {
  const buttons = page.locator(`:is(${CONSENT_SCOPE}) :is(button, a, [role='button']):visible`);
  const n = Math.min(await buttons.count().catch(() => 0), 40);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const t = ((await b.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (re.test(t)) {
      await b.click({ timeout: 3000 }).catch(() => b.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined));
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

/** Closes a cookie / consent banner if one covers the page. */
export async function dismissOverlays(page: Page): Promise<void> {
  if (await clickText(page, CONSENT_PREFERRED)) return;
  for (const sel of CONSENT_KNOWN) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
  await clickText(page, CONSENT_FALLBACK);
}

/**
 * Is there an application form on this page (as opposed to a job page with a site search, a newsletter
 * box or a "match my resume" widget)? A form with a file input next to a contact field, or one with a
 * contact field and at least three questions.
 */
export async function hasApplicationForm(page: Page): Promise<boolean> {
  await ensureShim(page);
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== "hidden";
    };
    const containers = Array.from(document.querySelectorAll("form, [role='form'], main, [class*='application' i]"));
    for (const c of containers) {
      if (c.closest("header, nav, footer")) continue;
      const controls = Array.from(c.querySelectorAll("input, textarea, select")).filter((el) => {
        const t = (el.getAttribute("type") ?? "").toLowerCase();
        return !["hidden", "submit", "button", "search", "checkbox", "radio"].includes(t) && (t === "file" || shown(el));
      });
      const hasFile = controls.some((el) => el.getAttribute("type") === "file");
      const hasContact = controls.some((el) => {
        const hint = `${el.getAttribute("type") ?? ""} ${el.getAttribute("name") ?? ""} ${el.getAttribute("id") ?? ""} ${el.getAttribute("autocomplete") ?? ""}`;
        return /email|first|last|name|phone|tel|nom|courriel/i.test(hint);
      });
      if ((hasFile && hasContact) || (hasContact && controls.length >= 3)) return true;
    }
    return false;
  });
}

/** Clicks the "Apply" button of a job page and returns the page the form is on (it may open a new tab). */
async function clickOpener(page: Page): Promise<Page> {
  const candidates = page.locator("a:visible, button:visible, [role='button']:visible, input[type='button']:visible");
  const count = Math.min(await candidates.count(), 250);
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    const text = (
      (await el.innerText().catch(() => "")) ||
      (await el.getAttribute("value").catch(() => "")) ||
      (await el.getAttribute("title").catch(() => "")) ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!OPENERS.test(text)) continue;
    // A <button type=submit> inside a form is a final submit, never an opener.
    const isFormSubmit = await el.evaluate((n) => n.tagName === "BUTTON" && (n as HTMLButtonElement).type === "submit" && !!n.closest("form"));
    if (isFormSubmit) continue;
    const popup = page.context().waitForEvent("page", { timeout: 6000 }).catch(() => null);
    // A chat widget or banner over the button intercepts a real click; a DOM click still reaches it.
    await el.click({ timeout: 5000 }).catch(() => el.evaluate((n) => (n as HTMLElement).click()).catch(() => undefined));
    const before = page.url();
    const opened = await popup;
    const target = opened ?? page;
    // Career sites often hand off to their ATS a few seconds after the click: wait for a new URL or a form.
    for (let t = 0; t < 12; t++) {
      await target.waitForLoadState("domcontentloaded").catch(() => undefined);
      if (opened || target.url() !== before || (await hasApplicationForm(target).catch(() => false))) break;
      await target.waitForTimeout(1000);
    }
    await target.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await target.waitForTimeout(1200);
    return target;
  }
  return page;
}

/**
 * Brings the application form on screen: closes a consent banner, runs the adapter's own step, and when
 * the page is still a job description, clicks "Apply" (following a new tab). Returns the page holding the form.
 */
export async function revealApplicationForm(page: Page, adapter: PlatformAdapter): Promise<Page> {
  await dismissOverlays(page);
  await adapter.reveal(page);
  if (await hasApplicationForm(page)) return page;
  const next = await clickOpener(page);
  await dismissOverlays(next);
  return next;
}

const greenhouse: PlatformAdapter = {
  id: "greenhouse",
  label: "Greenhouse",
  matches: (url) => /greenhouse\.io/i.test(url) || /[?&]gh_jid=/i.test(url),
  formUrl(url, ctx) {
    const ghJid = url.match(/[?&]gh_jid=(\d+)/i)?.[1];
    // A company site embedding Greenhouse: go straight to the board's own form instead of fighting an iframe.
    if (ghJid && ctx.boardToken) return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(ctx.boardToken)}&token=${ghJid}`;
    return url;
  },
  scopes: ["#application-form", "#application_form", "form#application-form", "form[action*='application']", ".application--form", "main form", "form"],
  async reveal() {},
  submitSelectors: ["#submit_app", "button[type='submit']:has-text('Submit')", "button:has-text('Submit application')", "button[type='submit']", "input[type='submit']"],
  confirmationUrl: /confirmation|thank/i,
};

const lever: PlatformAdapter = {
  id: "lever",
  label: "Lever",
  matches: (url) => /jobs\.(eu\.)?lever\.co/i.test(url),
  formUrl(url) {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/+$/, "");
    if (!/\/apply$/.test(u.pathname)) u.pathname += "/apply";
    return u.toString();
  },
  scopes: [".application-form", "form#application-form", "form[action*='apply']", "form"],
  async reveal() {},
  submitSelectors: ["#btn-submit", "button[type='submit']", "button:has-text('Submit application')"],
  confirmationUrl: /thanks|submitted|confirmation/i,
};

const workable: PlatformAdapter = {
  id: "workable",
  label: "Workable",
  matches: (url) => /apply\.workable\.com|\.workable\.com\/j\//i.test(url),
  formUrl(url) {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/+$/, "");
    if (!/\/apply$/.test(u.pathname)) u.pathname += "/apply";
    return `${u.toString()}/`;
  },
  scopes: ["form[data-ui='application-form']", "form"],
  async reveal() {},
  submitSelectors: ["button[data-ui='apply-button']", "button[type='submit']"],
  confirmationUrl: /success|thank|submitted/i,
};

const ashby: PlatformAdapter = {
  id: "ashby",
  label: "Ashby",
  matches: (url) => /jobs\.ashbyhq\.com/i.test(url),
  formUrl(url) {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/+$/, "");
    if (!/\/application$/.test(u.pathname)) u.pathname += "/application";
    return u.toString();
  },
  scopes: ["[class*='application-form']", "form", "main"],
  async reveal() {},
  submitSelectors: ["button:has-text('Submit Application')", "button[type='submit']"],
  confirmationUrl: /submitted|thank|confirmation/i,
};

const generic: PlatformAdapter = {
  id: "generic",
  label: "Company portal",
  matches: () => true,
  formUrl: (url) => url,
  scopes: ["form[id*='apply' i]", "form[class*='apply' i]", "form[action*='apply' i]", "main form", "form"],
  async reveal(page) {
    // An ATS form embedded as an iframe is followed to its own page.
    const embedded = await page
      .locator("iframe[src*='greenhouse.io'], iframe[src*='lever.co'], iframe[src*='ashbyhq.com'], iframe[src*='workable.com']")
      .first()
      .getAttribute("src")
      .catch(() => null);
    if (embedded) await page.goto(embedded, { waitUntil: "domcontentloaded", timeout: 60000 });
  },
  submitSelectors: [
    "button[type='submit']:text-matches('submit|send|apply|soumettre|envoyer|postuler', 'i')",
    "input[type='submit']",
    "button[type='submit']",
  ],
  confirmationUrl: /thank|confirmation|success|submitted|merci/i,
};

export const ADAPTERS: PlatformAdapter[] = [greenhouse, lever, workable, ashby, generic];

export function adapterFor(url: string): PlatformAdapter {
  return ADAPTERS.find((a) => a.id !== "generic" && a.matches(url)) ?? generic;
}

export async function scopeSelector(page: Page, adapter: PlatformAdapter): Promise<string | null> {
  for (const sel of adapter.scopes) {
    if ((await page.locator(sel).count().catch(() => 0)) > 0) return sel;
  }
  return null;
}

export async function confirmationText(page: Page, adapter: PlatformAdapter): Promise<string | null> {
  const body = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const hit = body.match(CONFIRM_TEXT)?.[0];
  if (hit) return hit;
  if (adapter.confirmationUrl.test(new URL(page.url()).pathname)) return `confirmation page: ${page.url()}`;
  return null;
}

/** Sites the desk never drives: they need your account. */
export function manualOnlyReason(url: string): string | null {
  if (/linkedin\.com/i.test(url)) return "LinkedIn postings need your LinkedIn account (Easy Apply). Apply there yourself, or add the company's own posting.";
  if (/indeed\.(com|ca)/i.test(url)) return "Indeed applications need your Indeed account. Apply there yourself, or add the company's own posting.";
  if (/myworkdayjobs\.com|\.workday\.com/i.test(url)) return "Workday portals need an account per company. Create it and apply yourself.";
  if (/taleo\.net|successfactors|icims\.com|brassring|oraclecloud\.com\/hcmUI/i.test(url)) return "This portal needs an account. Apply yourself.";
  return null;
}

/**
 * Why a page reached through "Apply" holds no form the desk can fill, in words a person can act on.
 * Every one of these is a stop for a person, never something to click through automatically.
 */
export async function whyNoForm(page: Page): Promise<string> {
  const manual = manualOnlyReason(page.url());
  if (manual) return manual;
  const passwords = await page.locator("input[type='password']").count().catch(() => 0);
  const body = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 5000);
  // Only the portal's own consent page counts (Soucy: /en/consent?jobAdId=…); cookie-banner iframes live elsewhere.
  const host = (u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return "";
    }
  };
  const frames = page.frames().map((f) => f.url()).filter((u) => host(u) === host(page.url()));
  if (passwords > 0 || /already a registered user|sign in to apply|create an account|cr[ée]er un compte|connectez-vous/i.test(body)) {
    return "The portal asks you to sign in or create an account before applying. Apply there yourself.";
  }
  if (frames.some((u) => /consent|privacy/i.test(u)) || /privacy notice|data (processing|privacy) consent|consent to (the )?(processing|collection)|avis de confidentialit[ée]|consentement/i.test(body)) {
    return "The portal starts with a privacy / data-consent step before the form: that consent is yours to give. Apply there yourself.";
  }
  if (/[?&](step|stepname)=|step \d+ of \d+|[ée]tape \d+ (sur|de) \d+/i.test(`${page.url()} ${body}`)) {
    return "The portal is a multi-step wizard the desk does not drive. Apply there yourself.";
  }
  return "\"Apply\" did not lead to a form the desk can read. Apply there yourself.";
}
