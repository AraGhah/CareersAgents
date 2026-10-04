// An employer portal that asks for an account before the form (Workday, iCIMS, Taleo, a company's own): this signs in,
// or creates the account first, with the email and password in .env.local (lib/apply/account-config.ts), and verifies it
// through the link mailed to that address when the portal asks. It stops, and says why, on anything it should not decide:
//   - a CAPTCHA (never solved or evaded)
//   - an account form that wants more than an email and a password (a name, a phone number...)
//   - a password rule it cannot meet, or a password the portal refuses
//
// What it does with the account form, and nothing else:
//   - types the email and the password (twice on a sign-up form) and presses the sign-in or create-account button
//   - ticks the terms box that creating the account requires, and leaves every other box (alerts, newsletters) alone
// It never touches the application itself: no application consent, declaration or question is answered here.
//
// Every click in this file goes through press(), which refuses unless the account is configured; scripts/assist-check.ts
// holds that to be true. The caller decides whether accounts are allowed at all (a run you started for one application).

import type { Locator, Page } from "playwright";
import { pool } from "../db";
import { detectCaptcha, visibleFormErrors } from "./browser/guards";
import { ensureEvalShim } from "./browser/shim";
import { accountHostAllowed, portalHost, redact, type AccountCredentials } from "./account-config";

export type AccountState = "created" | "verify_email" | "signed_in" | "failed";
export type AccountOutcome = { ok: true; action: "none" | "signed_in" | "created" } | { ok: false; reason: string };

export type AccountContext = {
  creds: AccountCredentials;
  log: (line: string) => void;
  /** What an earlier run left on this portal: decides whether to sign in first or create first. */
  known?: AccountState | null;
  /** Reads the verification link from the mailbox (Gmail in production). Without it, verification is left to a person. */
  verificationLink?: (host: string, sinceMs: number) => Promise<string | null>;
  record?: (host: string, state: AccountState, note: string | null) => Promise<void>;
  /** Where the password may be typed; accountHostAllowed (a known application system, or PORTAL_ACCOUNT_HOSTS) by default. */
  hostAllowed?: (url: string) => boolean;
};

// ---------------------------------------------------------------------------
// What the desk knows about its accounts
// ---------------------------------------------------------------------------

export async function recordAccount(host: string, email: string, state: AccountState, note: string | null): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO portal_accounts (host, email, state, note) VALUES ($1, $2, $3, $4)
       ON CONFLICT (host) DO UPDATE SET email = EXCLUDED.email, state = EXCLUDED.state, note = EXCLUDED.note, updated_at = now()`,
      [host, email, state, note],
    );
  } catch (err) {
    // Before schema-v12.sql there is no table: the account still works, it is just not remembered.
    if ((err as { code?: string }).code !== "42P01") throw err;
  }
}

export type PortalAccountRow = { host: string; email: string; state: AccountState; note: string | null; created_at: Date; updated_at: Date };

/** Every employer portal the desk has an account on, in your name, newest first. */
export async function listPortalAccounts(): Promise<PortalAccountRow[]> {
  try {
    const { rows } = await pool.query<PortalAccountRow>(`SELECT host, email, state, note, created_at, updated_at FROM portal_accounts ORDER BY updated_at DESC`);
    return rows;
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
    return [];
  }
}

export async function knownAccountState(host: string): Promise<AccountState | null> {
  try {
    const { rows } = await pool.query<{ state: AccountState }>(`SELECT state FROM portal_accounts WHERE host = $1`, [host]);
    return rows[0]?.state ?? null;
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Which page is this?
// ---------------------------------------------------------------------------

export type AccountPageKind = "signin" | "signup" | "verify" | "none";

export type PageFacts = { pw: number; confirm: boolean; buttons: string[]; text: string };

const SIGNIN_BUTTON = /^(sign in|log ?in|login|se connecter|connexion|ouvrir une session)$/i;
const CREATE_BUTTON = /^(create( an)? account|register|sign up|cr[ée]er (un |mon )?compte|s['’](inscrire|enregistrer))$/i;
const VERIFY_TEXT =
  /check your (e-?mail|inbox)|verify your (e-?mail|account)|verification (e-?mail|link|code)|we('ve| have) sent (you )?(an? )?(e-?mail|link|message)|v[ée]rifiez votre (courriel|adresse|bo[iî]te)|courriel de v[ée]rification|un courriel vous a [ée]t[ée] envoy[ée]/i;

/** From what a page shows: a sign-in form, a sign-up form, a "check your email" page, or neither (the form itself). */
export function classifyAccountPage(facts: PageFacts): AccountPageKind {
  if (facts.pw >= 2 || facts.confirm) return "signup";
  if (facts.pw === 1) {
    const creates = facts.buttons.some((t) => CREATE_BUTTON.test(t));
    const signsIn = facts.buttons.some((t) => SIGNIN_BUTTON.test(t));
    return creates && !signsIn ? "signup" : "signin";
  }
  return VERIFY_TEXT.test(facts.text) ? "verify" : "none";
}

async function pageFacts(page: Page): Promise<PageFacts> {
  await ensureEvalShim(page);
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const passwords = Array.from(document.querySelectorAll("input[type='password']")).filter(shown);
    const confirm = passwords.some((el) =>
      /verif|confirm|repeat|retype|re-?enter|confirmation/i.test(
        [el.getAttribute("name"), el.id, el.getAttribute("data-automation-id"), el.getAttribute("aria-label"), el.getAttribute("placeholder")].join(" "),
      ),
    );
    // Buttons only (not links): a sign-in page carries a "Create account" link, a sign-up page a "Sign in" link.
    const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']"))
      .filter(shown)
      .slice(0, 60)
      .map((el) => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const text = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 3000).toLowerCase();
    return { pw: passwords.length, confirm, buttons, text };
  });
}

export async function accountPageKind(page: Page): Promise<AccountPageKind> {
  return classifyAccountPage(await pageFacts(page));
}

/** Required fields on the page other than the email, the passwords and check boxes: what the desk cannot fill. */
async function extraRequiredFields(page: Page): Promise<string[]> {
  await ensureEvalShim(page);
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== "hidden";
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
      const input = el as HTMLInputElement;
      const type = (input.type || "").toLowerCase();
      if (["hidden", "submit", "button", "checkbox", "radio", "password", "email", "search"].includes(type) || !shown(el)) continue;
      const hint = [input.name, input.id, input.getAttribute("autocomplete"), input.getAttribute("data-automation-id")].join(" ");
      if (/e-?mail|username|login|courriel/i.test(hint)) continue;
      const required = input.required || input.getAttribute("aria-required") === "true";
      if (!required || input.value) continue;
      const label = input.labels?.[0]?.innerText || input.getAttribute("aria-label") || input.placeholder || input.name || input.id || "a field";
      out.push(label.replace(/\s+/g, " ").replace(/\*/g, "").trim().slice(0, 40));
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Acting on the page
// ---------------------------------------------------------------------------

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

async function firstOf(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const hit = visible(page, selector).first();
    if ((await hit.count().catch(() => 0)) > 0) return hit;
  }
  return null;
}

const EMAIL_FIELDS = [
  "[data-automation-id='email'] input",
  "input[data-automation-id='email']",
  "input[type='email']",
  "input[autocomplete='username']",
  "input[name*='mail' i]",
  "input[id*='mail' i]",
  "input[name*='user' i]",
  "input[name*='login' i]",
];

/** A button (or, with `links`, a link) by its Workday automation id or by its visible text. */
async function findButton(page: Page, ids: string[], text: RegExp, links = false): Promise<Locator | null> {
  for (const id of ids) {
    const hit = visible(page, `[data-automation-id="${id}"]`).first();
    if ((await hit.count().catch(() => 0)) > 0) return hit;
  }
  const all = visible(page, links ? "button, [role='button'], input[type='submit'], input[type='button'], a" : "button, [role='button'], input[type='submit'], input[type='button']");
  const n = Math.min(await all.count().catch(() => 0), 60);
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const label = (
      (await el.innerText().catch(() => "")) ||
      (await el.getAttribute("value").catch(() => "")) ||
      (await el.getAttribute("aria-label").catch(() => "")) ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (text.test(label) && (await el.isEnabled().catch(() => true))) return el;
  }
  return null;
}

/**
 * The only place a button is pressed. It refuses unless the account is configured, so nothing in this file can act on a
 * portal without the account being set up on purpose. A DOM click is the fallback for buttons a transparent layer covers.
 */
async function press(ctx: AccountContext, target: Locator): Promise<void> {
  if (!ctx.creds?.email || !ctx.creds.password) throw new Error("account actions need PORTAL_CREATE_ACCOUNTS=true and the account email and password");
  await target.click({ timeout: 8000 }).catch(() => target.evaluate((el) => (el as HTMLElement).click()));
}

/** Waits for the page to react to a press: a new page or a changed form. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
}

async function fillEmailAndPassword(page: Page, ctx: AccountContext, twice: boolean): Promise<string | null> {
  // Checked on the page as it is now, right before typing: a redirect may have taken the run somewhere else.
  if (!(ctx.hostAllowed ?? accountHostAllowed)(page.url())) {
    return `${portalHost(page.url()) || "this page"} is not a known application system (Workday, iCIMS...) over https, so the account password is not typed there; if it is the employer's real portal, add its host to PORTAL_ACCOUNT_HOSTS`;
  }
  const email = await firstOf(page, EMAIL_FIELDS);
  if (!email) return "no email field on the account page";
  await email.fill(ctx.creds.email);
  const passwords = visible(page, "input[type='password']");
  const n = await passwords.count();
  if (n === 0) return "no password field on the account page";
  for (let i = 0; i < Math.min(n, twice ? 2 : 1); i++) {
    const field = passwords.nth(i);
    await field.fill(ctx.creds.password);
    // Checked by length only: the value is never read back into anything that could be logged.
    if ((await field.inputValue().catch(() => "")).length !== ctx.creds.password.length) return "the password field did not take the password";
  }
  return null;
}

const TERMS = /terms|conditions|privacy|policy|agree|accept|consent|acknowledge|j['’]accepte|conditions d['’]utilisation|confidentialit/i;
const MARKETING = /newsletter|marketing|promotion|offers?|alerts?|notif|communications?|updates? (about|on)|emails? (me|about)|infolettre|bulletin/i;

/** Ticks the boxes creating the account requires (its terms), and only those: job alerts and newsletters stay off. */
async function tickAccountTerms(page: Page): Promise<number> {
  const boxes = visible(page, "input[type='checkbox'], [role='checkbox']");
  let ticked = 0;
  const n = Math.min(await boxes.count().catch(() => 0), 12);
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if (await box.isChecked().catch(() => false)) continue;
    const label = await box
      .evaluate((el) => {
        const input = el as HTMLInputElement;
        return (input.labels?.[0]?.innerText || el.closest("label")?.textContent || el.getAttribute("aria-label") || el.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
      })
      .catch(() => "");
    if (TERMS.test(label) && !MARKETING.test(label)) {
      await box.check({ force: true }).catch(() => undefined);
      ticked += 1;
    }
  }
  return ticked;
}

// "Already have an account? Sign in" is a link on every sign-up page, so it is not here: only the portal saying the account exists.
const EXISTS = /already (exists?|registered|in use|taken)|existe d[ée]j[àa]|d[ée]j[àa] (utilis[ée]|inscrit)|account with this (e-?mail|address)/i;
const BAD_LOGIN = /invalid|incorrect|wrong|not (found|recognized)|no account|unable to (sign|log)|doesn'?t match|invalide|introuvable|erron[ée]/i;
const PASSWORD_RULE = /password (must|should|needs?|requires?)|at least \d+ characters|mot de passe (doit|doivent|trop)|caract[èe]res? (minimum|au moins)/i;

async function problems(page: Page): Promise<string> {
  return (await visibleFormErrors(page).catch(() => [])).join(" ");
}

const MANUAL_CHOICE = /^(apply manually|postuler manuellement|saisir (mes|vos) informations manuellement)$/i;
const TO_SIGNUP = /(create( an)? account|sign up|register|new (user|here)|first time|cr[ée]er (un |mon )?compte|s['’]inscrire)/i;
const TO_SIGNIN = /(sign in|log ?in|already (have|registered)|se connecter|d[ée]j[àa] un compte)/i;

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

/**
 * Gets past an account page: signs in when an account is known to exist, else creates it first (and signs in when the
 * portal says it exists), verifies through the mailed link when asked, and stops with the reason on anything it should
 * not decide. Returns when the page in front is no longer an account page, or with why it could not.
 */
export async function passAccountWall(page: Page, ctx: AccountContext): Promise<AccountOutcome> {
  const say = (line: string) => ctx.log(redact(line, ctx.creds));
  const host = portalHost(page.url());
  const entryUrl = page.url();
  const startedAt = Date.now();
  const record = ctx.record ?? ((h: string, s: AccountState, n: string | null) => recordAccount(h, ctx.creds.email, s, n));
  const stop = async (reason: string, state: AccountState = "failed"): Promise<AccountOutcome> => {
    await record(host, state, redact(reason, ctx.creds)).catch(() => undefined);
    return { ok: false, reason };
  };

  const tried = { signin: false, create: false, toSignup: false, toSignin: false };
  let created = false;
  let signedIn = false;

  for (let step = 0; step < 10; step++) {
    const captcha = await detectCaptcha(page).catch(() => ({ challenge: false, kind: null as string | null, present: false }));
    if (captcha.challenge) return stop(`${captcha.kind ?? "A CAPTCHA"} on the account page: open it in review mode and solve it yourself.`);

    // Workday offers "Autofill with Resume / Apply Manually / Use My Last Application" before its sign-in page.
    const manual = await findButton(page, ["applyManually"], MANUAL_CHOICE, true);
    if (manual && (await accountPageKind(page)) === "none") {
      say("choosing to apply manually");
      await press(ctx, manual);
      await settle(page);
      continue;
    }

    const kind = await accountPageKind(page);
    say(`account page: ${kind}`);

    if (kind === "none") {
      const action = created ? "created" : signedIn ? "signed_in" : "none";
      if (action !== "none") await record(host, created ? "created" : "signed_in", null).catch(() => undefined);
      return { ok: true, action };
    }

    if (kind === "verify") {
      await record(host, "verify_email", null).catch(() => undefined);
      const link = ctx.verificationLink ? await ctx.verificationLink(host, startedAt).catch(() => null) : null;
      if (!link) return stop(`Verify the email the portal sent to ${ctx.creds.email}, then run this again: the desk will sign in.`, "verify_email");
      say("opening the verification link from the mailbox");
      const tab = await page.context().newPage();
      await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
      await tab.waitForTimeout(2500);
      await tab.close().catch(() => undefined);
      await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
      await settle(page);
      tried.signin = false;
      continue;
    }

    if (kind === "signin") {
      const knownAccount = ctx.known === "created" || ctx.known === "signed_in" || ctx.known === "verify_email";
      // An unknown portal most likely has no account yet: go to the sign-up form first (one failed sign-in avoided).
      if (!knownAccount && !tried.toSignup && !tried.create) {
        const link = await findButton(page, ["createAccountLink"], TO_SIGNUP, true);
        if (link) {
          say("no account known on this portal: going to the sign-up form");
          tried.toSignup = true;
          await press(ctx, link);
          await settle(page);
          continue;
        }
      }
      if (tried.signin) {
        const errors = await problems(page);
        if (knownAccount || tried.create) return stop(`Could not sign in with the configured account${BAD_LOGIN.test(errors) ? ": the portal refused the password (an account may already exist with another one)" : ""}.`);
        // First attempt refused on a portal we knew nothing about: an account may not exist yet.
        const link = await findButton(page, ["createAccountLink"], TO_SIGNUP, true);
        if (!link || tried.toSignup) return stop("Could not sign in, and there is no way to create an account from this page.");
        tried.toSignup = true;
        await press(ctx, link);
        await settle(page);
        continue;
      }
      const problem = await fillEmailAndPassword(page, ctx, false);
      if (problem) return stop(`Sign-in form: ${problem}.`);
      const button = await findButton(page, ["signInSubmitButton"], SIGNIN_BUTTON);
      if (!button) return stop("Sign-in form: no sign-in button found.");
      say("signing in");
      tried.signin = true;
      await press(ctx, button);
      await settle(page);
      if ((await accountPageKind(page)) === "none") signedIn = true;
      continue;
    }

    // kind === "signup"
    if (tried.create) {
      const errors = await problems(page);
      // The portal's own message decides; the page text is consulted only when it showed no message at all.
      const exists = errors ? EXISTS.test(errors) : EXISTS.test((await pageFacts(page)).text.slice(0, 1500));
      if (exists) {
        const link = tried.toSignin ? null : await findButton(page, ["signInLink"], TO_SIGNIN, true);
        if (!link) return stop("An account already exists on this portal and there is no way to sign in from here.");
        say("an account already exists: signing in instead");
        tried.toSignin = true;
        tried.signin = false;
        created = false;
        await press(ctx, link);
        await settle(page);
        continue;
      }
      return stop(PASSWORD_RULE.test(errors) ? `The portal refuses the password: ${errors.slice(0, 160)}` : `Creating the account did not go through${errors ? `: ${errors.slice(0, 160)}` : ""}.`);
    }
    const extra = await extraRequiredFields(page);
    if (extra.length > 0) return stop(`The account form asks for more than an email and a password (${extra.join(", ")}): create the account yourself.`);
    const problem = await fillEmailAndPassword(page, ctx, true);
    if (problem) return stop(`Sign-up form: ${problem}.`);
    const ticked = await tickAccountTerms(page);
    say(`creating the account (${ticked} terms box${ticked === 1 ? "" : "es"} ticked)`);
    const button = await findButton(page, ["createAccountSubmitButton"], CREATE_BUTTON);
    if (!button) return stop("Sign-up form: no create-account button found.");
    tried.create = true;
    created = true;
    await press(ctx, button);
    await settle(page);
  }
  return stop("The account step did not finish.");
}
