// An employer portal that asks for an account before the form (Workday, iCIMS, Taleo, a company's own): this signs in,
// or creates the account first, with the account in .env.local (lib/apply/account-config.ts), and verifies it through the
// link or code mailed to that address when the portal asks. It stops, and says why, on anything it should not decide:
//   - a CAPTCHA (never solved or evaded)
//   - a second factor sent to a phone or an authenticator app, a security question, an identity / ID check
//   - an account form that wants more than your name, contact details and location (fields read through the shared
//     classifier, lib/apply/classify.ts, so "Given name", "Legal First Name" and "Prénom" are the same question)
//   - a password rule it cannot meet
//
// Credentials: the configured account is the default. When a portal prints password rules the default does not meet (or
// refuses it), a password that meets them is made for that portal alone and kept encrypted in the vault
// (lib/apply/auth/credentials.ts, lib/apply/auth/vault.ts), so the next run signs in with it. Without PORTAL_VAULT_KEY it
// stops instead, as it always did.
//
// What it does with the account form, and nothing else:
//   - types the email and the password (twice on a sign-up form), your name / phone / location when the form asks for them,
//     and presses the sign-in or create-account button
//   - ticks the terms box that creating the account requires, and leaves every other box (alerts, newsletters) alone
//   - never types into a field built to catch robots (a hidden "honeypot" input)
//   - when the portal offers to apply without an account (as a guest), takes that instead of creating one
// It never touches the application itself: no application consent, declaration or question is answered here.
//
// Every press waits, bounded, for the portal to react (a new page, a message, the form gone): a portal that takes 20 s to
// create an account is not "did not go through". Every click in this file goes through press(), which refuses unless the
// account is configured; scripts/assist-check.ts holds that to be true. The caller decides whether accounts are allowed at
// all.

import type { Locator, Page } from "playwright";
import { pool } from "../db";
import { detectCaptcha, visibleFormErrors } from "./browser/guards";
import { ensureEvalShim } from "./browser/shim";
import { accountHostAllowed, portalHost, redact, type AccountCredentials } from "./account-config";
import { authAdapterFor, knownIds, type AuthAdapter } from "./auth/adapters";
import { defaultOnly, type CredentialProvider, type SignInChoice } from "./auth/credentials";
import { mergePolicies, parsePasswordPolicy, type PasswordPolicy } from "./auth/password-policy";
import { classifyField } from "./classify";
import { matchOption } from "./options";
import type { FlowState } from "./flow-state";
import type { FieldIntent, FormField } from "./types";

export type AccountState = "created" | "verify_email" | "signed_in" | "failed";
export type AccountOutcome =
  | { ok: true; action: "none" | "signed_in" | "created" | "guest" }
  | { ok: false; reason: string; intervention?: boolean };

export type AccountContext = {
  /** The configured account: the default credentials, and what press() checks is set up at all. */
  creds: AccountCredentials;
  log: (line: string) => void;
  /** What an earlier run left on this portal: decides whether to sign in first or create first. */
  known?: AccountState | null;
  /** Reads the verification link from the mailbox (Gmail in production). Without it, verification is left to a person. */
  verificationLink?: (host: string, sinceMs: number) => Promise<string | null>;
  /** Reads a one-time code the portal mailed. Without it, a code page is left to a person. */
  verificationCode?: (host: string, sinceMs: number) => Promise<string | null>;
  record?: (host: string, state: AccountState, note: string | null) => Promise<void>;
  /** Where the password may be typed; accountHostAllowed (a known application system, or PORTAL_ACCOUNT_HOSTS) by default. */
  hostAllowed?: (url: string) => boolean;
  /** Your own details, for an account form that also asks for them. Nothing else is typed. */
  profile?: AccountProfile;
  /** Which password to use per portal (the default, or the vault's). The configured account only, when absent. */
  credentials?: CredentialProvider;
  /** Each state of the account step as it is entered (lib/apply/flow-state.ts). */
  onState?: (state: FlowState, detail?: string) => void | Promise<void>;
  /** Override of the per-system wait for a reaction (tests). */
  reactionMs?: number;
};

export type AccountProfile = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string | null;
  /** Province or state, as the form would show it ("Quebec" / "Québec"). */
  region?: string | null;
  city?: string | null;
  postalCode?: string | null;
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

export type AccountPageKind = "signin" | "signup" | "verify" | "verify_code" | "intervention" | "none";

export type PageFacts = {
  pw: number;
  confirm: boolean;
  buttons: string[];
  text: string;
  /** A visible box for a one-time code (autocomplete="one-time-code", or a short input named / labelled code, OTP, PIN). */
  codeInput?: boolean;
  /** Visible text inputs on the page: a challenge page has one or two, an application form many. */
  inputs?: number;
};

const SIGNIN_BUTTON = /^(sign in|log ?in|login|se connecter|connexion|ouvrir une session)$/i;
const CREATE_BUTTON = /^(create( an| my)? (account|profile)|register|sign up|cr[ée]er (un |mon )?(compte|profil)|s['’](inscrire|enregistrer)|join now)$/i;
const VERIFY_TEXT =
  /check your (e-?mail|inbox)|verify your (e-?mail|account)|verification (e-?mail|link|code)|we('ve| have) sent (you )?(an? )?(e-?mail|link|message|code)|v[ée]rifiez votre (courriel|adresse|bo[iî]te)|courriel de v[ée]rification|un courriel vous a [ée]t[ée] envoy[ée]|code (de v[ée]rification|envoy[ée])/i;
/** Challenges only a person can meet: never attempted, the run stops with the reason and resumes after. */
const INTERVENTION: Array<[RegExp, string]> = [
  [/authenticator app|application d['’]authentification|two.?(factor|step) (authentication|verification)|2fa\b|multi.?factor|authentification (à|a) (deux|plusieurs) facteurs/i, "a second factor (authenticator app / two-step verification)"],
  [/(code|passcode).{0,60}(sent|texted|envoy[ée]).{0,30}(phone|mobile|sms|t[ée]l[ée]phone|cellulaire)|(sms|text message|texto).{0,40}code|code.{0,20}\b(by|via|par) (sms|text message|texto)\b/i, "a code sent to a phone (SMS)"],
  [/security question|question de s[ée]curit[ée]|mother'?s maiden|first pet|name of your (first|elementary)/i, "a security question that was never configured"],
  [/verify your identity|identity verification|government.?issued (photo )?id|upload (a |your )?(photo )?(id|identification)|selfie|v[ée]rifi(er|cation de) (votre )?identit[ée]|pi[eè]ce d['’]identit[ée]/i, "an identity / government-ID check"],
];

export function interventionReason(text: string): string | null {
  return INTERVENTION.find(([re]) => re.test(text))?.[1] ?? null;
}

/** From what a page shows: sign-in, sign-up, a "check your email" page, a code to type, a person-only challenge, or none. */
export function classifyAccountPage(facts: PageFacts): AccountPageKind {
  if (facts.pw >= 2 || facts.confirm) return "signup";
  if (facts.pw === 1) {
    const creates = facts.buttons.some((t) => CREATE_BUTTON.test(t));
    const signsIn = facts.buttons.some((t) => SIGNIN_BUTTON.test(t));
    return creates && !signsIn ? "signup" : "signin";
  }
  // Only on a page that is a challenge and nothing else: an application form ("Postal code", "Phone") is never one.
  const small = (facts.inputs ?? 0) <= 3;
  if (small && interventionReason(facts.text)) return "intervention";
  if (small && facts.codeInput && VERIFY_TEXT.test(facts.text)) return "verify_code";
  return small && VERIFY_TEXT.test(facts.text) ? "verify" : "none";
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
    const inputs = Array.from(document.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio'])")).filter(shown) as HTMLInputElement[];
    const codeInput =
      inputs.length <= 8 &&
      inputs.some((i) => {
        const hint = [i.name, i.id, i.getAttribute("autocomplete"), i.getAttribute("aria-label"), i.placeholder, i.labels?.[0]?.innerText].join(" ");
        return i.getAttribute("autocomplete") === "one-time-code" || (/\b(code|otp|pin|passcode)\b|verification|v[ée]rification/i.test(hint) && !/zip|postal/i.test(hint));
      });
    const text = (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 3000).toLowerCase();
    return { pw: passwords.length, confirm, buttons, text, codeInput, inputs: inputs.length };
  });
}

export async function accountPageKind(page: Page): Promise<AccountPageKind> {
  // A sign-in often navigates while the page is being read ("Execution context was destroyed"): the new page is waited
  // for and read instead, a few times at most.
  for (let attempt = 0; ; attempt++) {
    try {
      return classifyAccountPage(await pageFacts(page));
    } catch (err) {
      if (attempt >= 3 || !/context was destroyed|navigat|Target closed|frame was detached/i.test(String((err as Error).message))) throw err;
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
    }
  }
}

// ---------------------------------------------------------------------------
// The account form's fields, through the shared classifier
// ---------------------------------------------------------------------------

/** What an account form may be given, by the intent the shared classifier reads from the field's label. */
const ACCOUNT_INTENTS: ReadonlySet<FieldIntent> = new Set<FieldIntent>(["first_name", "last_name", "full_name", "phone", "city", "region", "country", "postal_code", "location", "email"]);

/** The browser's own autocomplete tokens say the same thing more reliably than a label. */
const AUTOCOMPLETE: Record<string, FieldIntent> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  tel: "phone",
  "tel-national": "phone",
  "address-level2": "city",
  "address-level1": "region",
  country: "country",
  "country-name": "country",
  "postal-code": "postal_code",
  email: "email",
  username: "email",
};

export type AccountFieldInfo = {
  index: number;
  label: string;
  name: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  tag: string;
  type: string;
  required: boolean;
  empty: boolean;
  options: string[];
  honeypot: boolean;
};

/** Which candidate attribute an account-form field asks for, or null for anything else. */
export function accountFieldIntent(f: Pick<AccountFieldInfo, "label" | "name" | "placeholder" | "autocomplete" | "tag" | "type" | "options">): FieldIntent | null {
  const auto = f.autocomplete?.trim().toLowerCase().split(/\s+/).at(-1) ?? "";
  if (AUTOCOMPLETE[auto]) return AUTOCOMPLETE[auto];
  if (f.type === "email") return "email";
  if (/\b(user ?name|user ?id|login|identifiant|nom d['’]utilisateur)\b/i.test(`${f.label} ${f.name ?? ""} ${f.placeholder ?? ""}`)) return "email";
  const field: FormField = {
    index: 0,
    signature: "",
    label: f.label || f.placeholder || (f.name ?? "").replace(/[_\-\[\]]+/g, " "),
    kind: f.tag === "SELECT" ? "select" : f.type === "tel" ? "tel" : "text",
    required: false,
    options: f.options,
    name: f.name,
    placeholder: f.placeholder,
    maxLength: null,
    rows: null,
    hint: null,
    accept: null,
  };
  const intent = classifyField(field);
  if (ACCOUNT_INTENTS.has(intent)) return intent;
  // A label the classifier does not know ("Given name") may still be plain in the field's name or placeholder.
  const raw = `${f.name ?? ""} ${f.placeholder ?? ""}`.replace(/[_\-\[\]]+/g, " ").toLowerCase();
  if (/\b(first ?name|given ?name|fname|prenom)\b/.test(raw)) return "first_name";
  if (/\b(last ?name|family ?name|surname|lname)\b/.test(raw)) return "last_name";
  return null;
}

function profileValue(intent: FieldIntent, profile: AccountProfile | undefined, email: string): string | null {
  if (intent === "email") return email;
  if (!profile) return null;
  switch (intent) {
    case "first_name":
      return profile.firstName;
    case "last_name":
      return profile.lastName;
    case "full_name":
      return [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null;
    case "phone":
      return profile.phone;
    case "city":
      return profile.city ?? null;
    case "region":
      return profile.region ?? null;
    case "country":
      return profile.country;
    case "postal_code":
      return profile.postalCode ?? null;
    case "location":
      return [profile.city, profile.region, profile.country].filter(Boolean).join(", ") || null;
    default:
      return null;
  }
}

/** Every visible input of the account form except passwords and boxes, stamped data-desk-account so it can be found again. */
async function accountFields(page: Page): Promise<AccountFieldInfo[]> {
  await ensureEvalShim(page);
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const out: AccountFieldInfo[] = [];
    let index = 0;
    for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
      const input = el as HTMLInputElement;
      const type = (input.type || "").toLowerCase();
      if (["hidden", "submit", "button", "checkbox", "radio", "password", "search", "file", "image", "reset"].includes(type)) continue;
      const label = (
        input.labels?.[0]?.innerText ||
        input.getAttribute("aria-label") ||
        (input.getAttribute("aria-labelledby") ? document.getElementById(input.getAttribute("aria-labelledby")!.split(/\s+/)[0])?.innerText : "") ||
        ""
      )
        .replace(/\s+/g, " ")
        .replace(/\*/g, "")
        .trim();
      // A field made to catch robots: named so, labelled so, hidden from assistive technology, or kept off the screen.
      const r = input.getBoundingClientRect();
      const honeypot =
        /honeypot|beecatcher|bot.?trap/i.test(`${input.name} ${input.id} ${input.getAttribute("data-automation-id") ?? ""}`) ||
        /robots? only|for robots|leave (this )?(field )?(blank|empty)|do not (fill|enter|complete) this|laisser vide/i.test(`${label} ${input.placeholder}`) ||
        !!input.closest("[aria-hidden='true']") ||
        r.right < 0 ||
        r.bottom < 0;
      if (!shown(el) && !honeypot) continue;
      input.setAttribute("data-desk-account", String(index));
      out.push({
        index: index++,
        label: label.slice(0, 80),
        name: input.name || input.id || null,
        placeholder: input.placeholder || null,
        autocomplete: input.getAttribute("autocomplete"),
        tag: el.tagName,
        type,
        required: input.required || input.getAttribute("aria-required") === "true",
        empty: !input.value || (el.tagName === "SELECT" && (el as HTMLSelectElement).selectedIndex <= 0),
        options: el.tagName === "SELECT" ? Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()) : [],
        honeypot,
      });
    }
    return out;
  });
}

/**
 * Fills the account form's fields from your details (the email included), and returns the required ones it could not
 * fill: what the desk does not know, so it stops instead of inventing. Honeypot fields are never touched.
 */
async function fillAccountFields(page: Page, email: string, profile: AccountProfile | undefined): Promise<{ missing: string[]; emailFields: number }> {
  const missing: string[] = [];
  let emailFields = 0;
  for (const f of await accountFields(page)) {
    if (f.honeypot) continue;
    const intent = accountFieldIntent(f);
    const value = intent ? profileValue(intent, profile, email) : null;
    const el = page.locator(`[data-desk-account="${f.index}"]`).first();
    if (intent === "email") emailFields += 1;
    if (value && (f.empty || intent === "email")) {
      if (f.tag === "SELECT") {
        const m = matchOption(value, f.options);
        if (m) await el.selectOption({ label: m.option }).catch(() => undefined);
      } else {
        await el.fill(value).catch(() => undefined);
      }
    }
    const filled = await el
      .evaluate((n) => {
        const i = n as HTMLInputElement;
        return n.tagName === "SELECT" ? (n as HTMLSelectElement).selectedIndex > 0 : !!i.value;
      })
      .catch(() => false);
    if (f.required && !filled) missing.push(f.label || f.placeholder || f.name || "a field");
  }
  return { missing, emailFields };
}

// ---------------------------------------------------------------------------
// Acting on the page
// ---------------------------------------------------------------------------

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

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

async function firstOf(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const hit = visible(page, selector).first();
    if ((await hit.count().catch(() => 0)) > 0) return hit;
  }
  return null;
}

/** A button (or, with `links`, a link) by an automation id of the portal's system, or by its visible text. */
async function findButton(page: Page, ids: string[], text: RegExp, links = false): Promise<Locator | null> {
  for (const id of ids) {
    const hit = visible(page, `[data-automation-id="${id}"]`).first();
    if ((await hit.count().catch(() => 0)) > 0) return hit;
  }
  const all = visible(page, links ? "button, [role='button'], input[type='submit'], input[type='button'], a" : "button, [role='button'], input[type='submit'], input[type='button']");
  const n = Math.min(await all.count().catch(() => 0), 80);
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
  // Workday lays a transparent "click_filter" over its buttons and listens on that layer: a click on the button under
  // it (or a DOM click on the button) does nothing, so the layer is what gets pressed when there is one.
  const layer = target.locator("xpath=../*[@data-automation-id='click_filter']").first();
  const hit = (await layer.count().catch(() => 0)) > 0 ? layer : target;
  await hit.click({ timeout: 8000 }).catch(() => hit.evaluate((el) => (el as HTMLElement).click()));
}

/** Waits for the page to react to a press: a new page or a changed form. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
}

/** What changes when a portal answers a press: the address, the password fields, a message, a code box, a verify notice. */
async function reactionSignature(page: Page): Promise<string> {
  const facts = await pageFacts(page);
  const errors = (await visibleFormErrors(page).catch(() => [])).join(" ");
  return [page.url(), facts.pw, facts.confirm, facts.codeInput ? 1 : 0, VERIFY_TEXT.test(facts.text) ? 1 : 0, interventionReason(facts.text) ? 1 : 0, errors].join("|");
}

/**
 * After a press: polls until the page shows something new, at most `ms`. True when it reacted. A navigation in progress
 * counts as a reaction (the next look waits for the new page). Bounded: a portal that never answers gives the run back.
 */
async function awaitReaction(page: Page, before: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(700);
    const now = await reactionSignature(page).catch(() => "navigating");
    if (now !== before) {
      await settle(page);
      return true;
    }
  }
  return false;
}

async function fillPasswords(page: Page, creds: AccountCredentials, twice: boolean): Promise<string | null> {
  const passwords = visible(page, "input[type='password']");
  const n = await passwords.count();
  if (n === 0) return "no password field on the account page";
  for (let i = 0; i < Math.min(n, twice ? 2 : 1); i++) {
    const field = passwords.nth(i);
    await field.fill(creds.password);
    // Checked by length only: the value is never read back into anything that could be logged.
    if ((await field.inputValue().catch(() => "")).length !== creds.password.length) return "the password field did not take the password";
  }
  return null;
}

function hostRefused(page: Page, ctx: AccountContext): string | null {
  // Checked on the page as it is now, right before typing: a redirect may have taken the run somewhere else.
  if ((ctx.hostAllowed ?? accountHostAllowed)(page.url())) return null;
  return `${portalHost(page.url()) || "this page"} is not a known application system (Workday, iCIMS...) over https, so the account password is not typed there; if it is the employer's real portal, add its host to PORTAL_ACCOUNT_HOSTS`;
}

const TERMS = /terms|conditions|privacy|policy|agree|accept|consent|acknowledge|j['’]accepte|conditions d['’]utilisation|confidentialit/i;
const MARKETING = /newsletter|marketing|promotion|offers?|alerts?|notif|communications?|updates? (about|on)|emails? (me|about)|infolettre|bulletin|talent (community|network|pool)/i;

/** Ticks the boxes creating the account requires (its terms), and only those: job alerts and newsletters stay off. */
async function tickAccountTerms(page: Page): Promise<number> {
  // A box drawn over a hidden input (most design systems) is found by its label, not by the input's own size.
  const boxes = page.locator("input[type='checkbox'], [role='checkbox']");
  let ticked = 0;
  const n = Math.min(await boxes.count().catch(() => 0), 12);
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if (await box.isChecked().catch(() => false)) continue;
    const info = await box
      .evaluate((el) => {
        const input = el as HTMLInputElement;
        const label = (input.labels?.[0]?.innerText || el.closest("label")?.textContent || el.getAttribute("aria-label") || el.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
        const target = (input.labels?.[0] as HTMLElement | undefined) ?? (el.closest("label") as HTMLElement | null) ?? (el as HTMLElement);
        const r = target.getBoundingClientRect();
        return { label, onScreen: r.width > 0 && r.height > 0 && !el.closest("[aria-hidden='true']") };
      })
      .catch(() => ({ label: "", onScreen: false }));
    if (info.onScreen && TERMS.test(info.label) && !MARKETING.test(info.label)) {
      await box.check({ force: true }).catch(() => undefined);
      ticked += 1;
    }
  }
  return ticked;
}

// "Already have an account? Sign in" is a link on every sign-up page, so it is not here: only the portal saying the account exists.
const EXISTS =
  // Not "Already registered? Log in": a question is the link every sign-up page carries, not the portal's answer.
  // The page text runs elements together ("Create Profile" + "Already registered?"), so a subject needs a whole statement.
  /already (exists?|registered|in use|taken|associated|been registered)(?!\s*\?)|(account|user|candidate|profile|e-?mail)( address)? (already exists|(is|has) already (been )?(registered|in use|taken|associated|used))(?!\s*\?)|existe d[ée]j[àa]|d[ée]j[àa] (utilis[ée]|inscrit|associ[ée]|enregistr[ée])|account with this (e-?mail|address)/i;
const BAD_LOGIN = /invalid|incorrect|wrong|not (found|recognized)|no account|unable to (sign|log)|doesn'?t match|invalide|introuvable|erron[ée]/i;
const PASSWORD_RULE = /password (must|should|needs?|requires?|does not meet|doesn'?t meet|is too)|at least \d+ characters|mot de passe (doit|doivent|trop|ne respecte)|caract[èe]res? (minimum|au moins)|(uppercase|lowercase|special|numeric) character/i;
/** The account exists but its email was never verified: not a wrong password. */
const UNVERIFIED = /verify your (account|e-?mail)|account (is |has )?not (yet )?(been )?(verified|activated|confirmed)|verification e-?mail|unverified|v[ée]rifi(ez|er) votre (compte|courriel|adresse)|compte (n['’]est pas|non) (encore )?(v[ée]rifi[ée]|activ[ée])/i;
const RESEND_VERIFICATION = /resend.{0,30}(verification|activation|confirmation)|send.{0,20}(verification|activation) (e-?mail|link) again|renvoyer.{0,30}(v[ée]rification|activation|courriel)/i;
const LOCKED = /locked|too many (attempts|tries)|temporarily (disabled|blocked)|verrouill|trop de tentatives/i;
const BAD_CODE = /invalid|incorrect|expired|wrong|invalide|expir[ée]|erron[ée]/i;

async function problems(page: Page): Promise<string> {
  return (await visibleFormErrors(page).catch(() => [])).join(" ");
}

const MANUAL_CHOICE = /^(apply manually|postuler manuellement|saisir (mes|vos) informations manuellement)$/i;
/** "Sign in with email" where a page first offers Google / LinkedIn / email: the email form is the desk's, the others never. */
const EMAIL_CHOICE = /^((sign in|log ?in|continue|connect|se connecter|connexion|continuer) (with|using|avec|par) (an |your |une |votre |l['’])?(e-?mail|courriel|adresse (e-?mail|courriel))( address)?|use (my |your )?e-?mail)$/i;
const GUEST =
  /^(apply|continue|proceed|postuler|continuer)( now)? (as (a )?guest|without (an |creating an )?account|without (signing|logging) in|en tant qu['’]invit[ée]|sans (cr[ée]er (de |un )?)?compte|sans vous connecter)$|^(guest (apply|application|checkout)|candidature (en tant qu['’]invit[ée]|sans compte))$/i;
const TO_SIGNUP =
  /(create( an| a| my| your)?( new| candidate)? (account|profile)|sign up|register|new (user|candidate|applicant|here)|first time|don['’]?t have an account|cr[ée]er (un |mon )?(compte|profil)|s['’]inscrire|nouveau candidat|nouvel utilisateur|premi[eè]re visite)/i;
/** A "talent community" sign-up only when it is the page's one way in: it also subscribes you, so it is never preferred. */
const TO_TALENT = /join (our |the )?talent (network|community)|rejoindre (notre |la )?(communaut[ée]|r[ée]seau) de talents/i;
const TO_SIGNIN = /(sign in|log ?in|already (have|registered)|se connecter|d[ée]j[àa] un compte)/i;
const VERIFY_BUTTON = /^(verify|confirm|continue|next|validate|v[ée]rifier|confirmer|valider|continuer|suivant)( (code|my account|email|mon compte))?$/i;

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

/**
 * Gets past an account page: applies as a guest when the portal allows it, signs in when an account is known to exist,
 * else creates it first (and signs in when the portal says it exists), verifies through the mailed link or code when
 * asked, and stops with the reason on anything it should not decide. Returns when the page in front is no longer an
 * account page, or with why it could not.
 */
export async function passAccountWall(page: Page, ctx: AccountContext): Promise<AccountOutcome> {
  const host = portalHost(page.url());
  const adapter: AuthAdapter = authAdapterFor(host);
  const provider = ctx.credentials ?? defaultOnly(ctx.creds);
  const hide = (text: string) => provider.secrets(host).reduce((t, p) => redact(t, { email: ctx.creds.email, password: p }), redact(text, ctx.creds));
  const say = (line: string) => ctx.log(hide(line));
  const state = async (s: FlowState, detail?: string) => {
    await Promise.resolve(ctx.onState?.(s, detail ? hide(detail) : undefined)).catch(() => undefined);
  };
  const entryUrl = page.url();
  const startedAt = Date.now();
  const reactionMs = ctx.reactionMs ?? adapter.reactionMs;
  const record = ctx.record ?? ((h: string, s: AccountState, n: string | null) => recordAccount(h, ctx.creds.email, s, n));
  const stop = async (reason: string, accountState: AccountState = "failed", intervention = false): Promise<AccountOutcome> => {
    await record(host, accountState, hide(reason)).catch(() => undefined);
    await state(accountState === "verify_email" ? "EMAIL_VERIFICATION_REQUIRED" : "MANUAL_INTERVENTION_REQUIRED", reason);
    return { ok: false, reason: hide(reason), ...(intervention ? { intervention: true } : {}) };
  };

  const tried = { create: false, regenerated: false, toSignup: false, toSignin: false, toTalent: false, guest: false, emailChoice: 0, resend: false, code: 0, silentCreate: 0, silentSignIn: 0 };
  let signInQueue: SignInChoice[] | null = null;
  let signInsDone = 0;
  let creds: AccountCredentials = ctx.creds;
  let credSource: "default" | "vault" | "generated" = "default";
  let policy: PasswordPolicy = parsePasswordPolicy("");
  let created = false;
  let signedIn = false;
  let guest = false;
  let lastKind: AccountPageKind | null = null;

  // Some systems (Workday) draw each page seconds after it has "loaded", behind a placeholder: judged too early, any of
  // them reads as "no account step". So before every look, one of the things a drawn page shows is waited for.
  const ready = async (): Promise<void> => {
    if (!adapter.settled) return;
    const shown = await page
      .waitForSelector(adapter.settled, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!shown) say(`${adapter.label} showed neither its account form nor the application within 20 s (${page.url()})`);
    await page.waitForTimeout(800);
  };

  /** Presses and waits for the portal's answer; a press nobody answers is pressed once more, then reported. */
  const pressAndWait = async (target: Locator, what: string): Promise<boolean> => {
    const before = await reactionSignature(page).catch(() => "");
    await press(ctx, target);
    if (await awaitReaction(page, before, reactionMs)) return true;
    say(`${what}: no reaction within ${Math.round(reactionMs / 1000)} s`);
    return false;
  };

  await state("CHECKING_EXISTING_ACCOUNT", ctx.known ? `this portal: ${ctx.known}` : "no account known on this portal");

  for (let step = 0; step < 14; step++) {
    await ready();
    const captcha = await detectCaptcha(page).catch(() => ({ challenge: false, kind: null as string | null, present: false }));
    if (captcha.challenge) return stop(`${captcha.kind ?? "A CAPTCHA"} on the account page: open it in review mode and solve it yourself.`, "failed", true);

    // A page that offers Google / LinkedIn / email first: the email form is opened (twice at most), the others never.
    if (tried.emailChoice < 2) {
      const byEmail = await findButton(page, knownIds(adapter, "emailChoice"), EMAIL_CHOICE, true);
      if (byEmail && (await accountPageKind(page)) === "none") {
        say("the portal offers several ways in: choosing email");
        tried.emailChoice += 1;
        await pressAndWait(byEmail, "sign in with email");
        continue;
      }
    }

    // Workday offers "Autofill with Resume / Apply Manually / Use My Last Application" before its sign-in page.
    const manual = await findButton(page, knownIds(adapter, "manual"), MANUAL_CHOICE, true);
    if (manual && (await accountPageKind(page)) === "none") {
      say("choosing to apply manually");
      await press(ctx, manual);
      await settle(page);
      continue;
    }

    const kind = await accountPageKind(page);
    if (kind !== lastKind) say(`account page: ${kind}`);
    lastKind = kind;

    if (kind === "none") {
      const action = guest ? "guest" : created ? "created" : signedIn ? "signed_in" : "none";
      if (action === "created" || action === "signed_in") {
        provider.accepted(host, credSource);
        await record(host, action, credSource === "default" ? null : "per-portal password (vault)").catch(() => undefined);
        await state("AUTHENTICATED", action === "created" ? "account created" : "signed in");
      } else if (action === "guest") {
        await state("APPLYING_WITHOUT_ACCOUNT", "the portal let the application go on without an account");
      }
      return { ok: true, action };
    }

    if (kind === "intervention") {
      const why = interventionReason((await pageFacts(page)).text) ?? "a challenge only you can answer";
      return stop(`The portal asks for ${why}: the desk never answers that. Do it in the window, then run the application again; it resumes signed in.`, "failed", true);
    }

    if (kind === "verify_code") {
      await record(host, "verify_email", null).catch(() => undefined);
      await state("EMAIL_VERIFICATION_REQUIRED", "a code was mailed");
      if (tried.code >= 2) return stop(`The portal did not accept the mailed code (${(await problems(page)) || "no message"}). Type the newest code from ${ctx.creds.email} yourself.`, "verify_email");
      const code = ctx.verificationCode ? await ctx.verificationCode(host, startedAt + (tried.code ? 1000 : 0)).catch(() => null) : null;
      if (!code) return stop(`Type the code the portal mailed to ${ctx.creds.email}, then run this again: the desk will sign in.`, "verify_email");
      const box = await firstOf(page, ["input[autocomplete='one-time-code']", "input[name*='code' i]", "input[id*='code' i]", "input[name*='otp' i]", "input[aria-label*='code' i]", "input[placeholder*='code' i]", "input[type='text']", "input[type='number']"]);
      if (!box) return stop("The portal asks for a mailed code but shows no box to type it in.", "verify_email");
      await box.fill(code);
      const go = await findButton(page, [], VERIFY_BUTTON);
      if (!go) return stop("The code is typed but there is no Verify / Continue button to press.", "verify_email");
      say("typing the code from the mailbox");
      tried.code += 1;
      await pressAndWait(go, "verification code");
      const errors = await problems(page);
      if (errors && BAD_CODE.test(errors)) say(`the portal refused the code: ${errors.slice(0, 120)}`);
      continue;
    }

    if (kind === "verify") {
      await record(host, "verify_email", null).catch(() => undefined);
      await state("EMAIL_VERIFICATION_REQUIRED", "a link was mailed");
      const link = ctx.verificationLink ? await ctx.verificationLink(host, startedAt).catch(() => null) : null;
      if (!link) return stop(`Verify the email the portal sent to ${ctx.creds.email}, then run this again: the desk will sign in.`, "verify_email");
      say("opening the verification link from the mailbox");
      const tab = await page.context().newPage();
      await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
      await tab.waitForTimeout(2500);
      await tab.close().catch(() => undefined);
      // Back to where the account step began: the application's address, so the run continues where it was.
      await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
      await settle(page);
      signInQueue = null;
      signInsDone = 0;
      continue;
    }

    if (kind === "signin") {
      const knownAccount = ctx.known === "created" || ctx.known === "signed_in" || ctx.known === "verify_email";
      // A portal that lets you apply without an account: no account is made at all (one less account in your name).
      if (!knownAccount && !tried.guest) {
        const asGuest = await findButton(page, [], GUEST, true);
        if (asGuest) {
          tried.guest = true;
          say("the portal lets you apply without an account: continuing as a guest");
          await pressAndWait(asGuest, "apply as guest");
          if ((await accountPageKind(page)) === "none") guest = true;
          continue;
        }
      }
      // An unknown portal most likely has no account yet: go to the sign-up form first (one failed sign-in avoided).
      if (!knownAccount && !tried.toSignup && !tried.create) {
        const link = (await findButton(page, knownIds(adapter, "toSignup"), TO_SIGNUP, true)) ?? (tried.toTalent ? null : await findButton(page, [], TO_TALENT, true));
        if (link) {
          say("no account known on this portal: going to the sign-up form");
          tried.toSignup = true;
          await state("REGISTERING_ACCOUNT", "opening the sign-up form");
          await pressAndWait(link, "sign-up link");
          continue;
        }
      }
      signInQueue ??= provider.forSignIn(host);
      if (signInsDone > 0) {
        const errors = await problems(page);
        if (LOCKED.test(errors)) return stop(`The portal locked the sign-in (${errors.slice(0, 120)}): wait, or reset the password yourself.`, "failed", true);
        // "Verify your account before you sign in" (abb.wd3, 2026-10-06): the account exists but was never verified. One new
        // verification email is asked for, its link opened, then the sign-in is tried again.
        if (UNVERIFIED.test(errors)) {
          await record(host, "verify_email", null).catch(() => undefined);
          await state("EMAIL_VERIFICATION_REQUIRED", "the account exists but was never verified");
          if (tried.resend || !ctx.verificationLink) {
            return stop(`The account on this portal exists but is not verified: open the verification email sent to ${ctx.creds.email} (or "Resend Account Verification" on the sign-in page), then run this again.`, "verify_email");
          }
          tried.resend = true;
          const resend = await findButton(page, [], RESEND_VERIFICATION, true);
          const since = Date.now();
          if (resend) {
            say("the account was never verified: asking the portal for a new verification email");
            await pressAndWait(resend, "resend verification");
          }
          const link = await ctx.verificationLink(host, resend ? since : startedAt - 3 * 86_400_000).catch(() => null);
          if (!link) return stop(`The account on this portal exists but is not verified, and no verification email arrived at ${ctx.creds.email} in time: open it when it comes, then run this again.`, "verify_email");
          say("opening the verification link from the mailbox");
          const tab = await page.context().newPage();
          await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
          await tab.waitForTimeout(2500);
          await tab.close().catch(() => undefined);
          await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
          await settle(page);
          signInQueue = null;
          signInsDone = 0;
          continue;
        }
        if (signInsDone < signInQueue.length) {
          say("the first password was refused: trying the other one this portal may have");
        } else {
          if (knownAccount || tried.create) return stop(`Could not sign in with the configured account${BAD_LOGIN.test(errors) ? ": the portal refused the password (an account may already exist with another one)" : ""}.`);
          // First attempt refused on a portal we knew nothing about: an account may not exist yet.
          const link = await findButton(page, knownIds(adapter, "toSignup"), TO_SIGNUP, true);
          if (!link || tried.toSignup) return stop("Could not sign in, and there is no way to create an account from this page.");
          tried.toSignup = true;
          await pressAndWait(link, "sign-up link");
          continue;
        }
      }
      const refused = hostRefused(page, ctx);
      if (refused) return stop(`Sign-in form: ${refused}.`);
      ({ creds, source: credSource } = signInQueue[signInsDone]);
      const email = await firstOf(page, EMAIL_FIELDS);
      if (!email) return stop("Sign-in form: no email field on the account page.");
      await email.fill(creds.email);
      const problem = await fillPasswords(page, creds, false);
      if (problem) return stop(`Sign-in form: ${problem}.`);
      const button = await findButton(page, knownIds(adapter, "signIn"), SIGNIN_BUTTON);
      if (!button) return stop("Sign-in form: no sign-in button found.");
      say("signing in");
      await state("SIGNING_IN");
      signInsDone += 1;
      if (!(await pressAndWait(button, "sign in")) && tried.silentSignIn++ === 0) {
        // Nothing happened at all: the same password once more, not counted as a refused sign-in.
        signInsDone -= 1;
        continue;
      }
      if ((await accountPageKind(page)) !== "signin") signedIn = true;
      continue;
    }

    // kind === "signup"
    // Some portals open straight on Create Account (Workday's applyManually): an account known on this host signs in
    // instead of trying to create a second one.
    const knownHere = ctx.known === "created" || ctx.known === "signed_in" || ctx.known === "verify_email";
    if (knownHere && !tried.create && !tried.toSignin) {
      const link = await findButton(page, knownIds(adapter, "toSignin"), TO_SIGNIN, true);
      if (link) {
        say("an account is known on this portal: going to the sign-in form instead of creating one");
        tried.toSignin = true;
        await pressAndWait(link, "sign-in link");
        continue;
      }
    }
    if (tried.create) {
      const errors = await problems(page);
      // The portal's own message decides; the page text is consulted only when it showed no message at all.
      const exists = errors ? EXISTS.test(errors) : EXISTS.test((await pageFacts(page)).text.slice(0, 1500));
      if (exists) {
        const link = tried.toSignin ? null : await findButton(page, knownIds(adapter, "toSignin"), TO_SIGNIN, true);
        if (!link) return stop("An account already exists on this portal and there is no way to sign in from here.");
        say("an account already exists: signing in instead");
        tried.toSignin = true;
        signInQueue = null;
        signInsDone = 0;
        created = false;
        await pressAndWait(link, "sign-in link");
        continue;
      }
      if (PASSWORD_RULE.test(errors) && !tried.regenerated) {
        // The portal said which rule the password breaks: one password that meets it, kept for this portal, then once more.
        policy = mergePolicies(policy, parsePasswordPolicy(`Password must ${errors}`));
        const choice = provider.forSignUp(host, policy, true);
        if ("problem" in choice) return stop(`The portal refuses the password: ${errors.slice(0, 160)} (${choice.problem}).`);
        tried.regenerated = true;
        tried.create = false;
        creds = choice.creds;
        credSource = choice.source;
        say("the portal refused the password for its rules: making one for this portal that meets them");
      } else if (!errors && tried.silentCreate === 1) {
        say("the portal did not answer Create Account: pressing it once more");
        tried.create = false;
      } else if (!errors && tried.silentCreate >= 2) {
        // Pressed twice and the portal never answered: say what the page looked like, so it can be diagnosed.
        const facts = await pageFacts(page);
        return stop(
          `The portal did not react to Create Account within ${Math.round((reactionMs * 2) / 1000)} s and shows no message (still the sign-up form at ${page.url()}; ${facts.buttons.slice(0, 4).join(" / ") || "no buttons"}). It may still be creating the account: run the application again, the desk will then sign in.`,
        );
      } else {
        return stop(PASSWORD_RULE.test(errors) ? `The portal refuses the password: ${errors.slice(0, 160)}` : `Creating the account did not go through${errors ? `: ${errors.slice(0, 160)}` : ""}.`);
      }
    }
    if (!tried.create && !tried.regenerated) {
      // The portal's own printed rules decide which password is used here (the configured one, or one made for this portal).
      policy = mergePolicies(policy, parsePasswordPolicy((await page.locator("body").innerText().catch(() => "")) || ""));
      const choice = provider.forSignUp(host, policy, false);
      if ("problem" in choice) return stop(`Sign-up form: ${choice.problem}.`);
      creds = choice.creds;
      credSource = choice.source;
      if (choice.source !== "default") say(choice.source === "generated" ? "this portal's password rules need their own password: one was made and kept in the vault" : "using the password kept for this portal");
    }
    const refused = hostRefused(page, ctx);
    if (refused) return stop(`Sign-up form: ${refused}.`);
    const { missing, emailFields } = await fillAccountFields(page, creds.email, ctx.profile);
    if (missing.length > 0) return stop(`The account form asks for more than an email, a password and your name (${missing.join(", ")}): create the account yourself.`);
    if (emailFields === 0) {
      const email = await firstOf(page, EMAIL_FIELDS);
      if (!email) return stop("Sign-up form: no email field on the account page.");
      await email.fill(creds.email);
    }
    const problem = await fillPasswords(page, creds, true);
    if (problem) return stop(`Sign-up form: ${problem}.`);
    const ticked = await tickAccountTerms(page);
    say(`creating the account (${ticked} terms box${ticked === 1 ? "" : "es"} ticked)`);
    const button = await findButton(page, knownIds(adapter, "create"), CREATE_BUTTON);
    if (!button) return stop("Sign-up form: no create-account button found.");
    await state("REGISTERING_ACCOUNT", "creating the account");
    tried.create = true;
    created = true;
    if (!(await pressAndWait(button, "create account"))) tried.silentCreate += 1;
  }
  return stop("The account step did not finish.");
}
