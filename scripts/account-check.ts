// Offline: no database, no network, no real employer. The account step of a portal application, on local fixture pages that
// behave like the account pages of an employer portal, with fake credentials (never the real ones).
//   npm run account:check

import { readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { credentialProvider } from "../lib/apply/auth/credentials";
import { fileVault } from "../lib/apply/auth/vault";
import { chromium, type Page } from "playwright";
import { accountCredentials, accountHostAllowed, portalHost, redact } from "../lib/apply/account-config";
import { accountPageKind, classifyAccountPage, passAccountWall, type AccountState } from "../lib/apply/account";
import { pickVerificationLink, registrable, type MailMessage } from "../lib/apply/account-mail";
import { wizardReason } from "../lib/apply/platforms";

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const CREDS = { email: "test@example.com", password: "Test-Pass-123!" };
const allLogs: string[] = [];

function serve(dir: string): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      try {
        const body = await readFile(path.join(dir, path.basename(url.pathname)));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` });
    });
  });
}

function unitChecks() {
  console.log("configuration");
  check(accountCredentials({}) === null, "nothing configured: no account");
  check(accountCredentials({ PORTAL_ACCOUNT_EMAIL: "a@b.c", PORTAL_ACCOUNT_PASSWORD: "x" }) === null, "an email and a password without PORTAL_CREATE_ACCOUNTS=true: still off");
  check(accountCredentials({ PORTAL_CREATE_ACCOUNTS: "true", PORTAL_ACCOUNT_EMAIL: "a@b.c" }) === null, "on, but no password: no account");
  const on = accountCredentials({ PORTAL_CREATE_ACCOUNTS: "TRUE", PORTAL_ACCOUNT_EMAIL: " a@b.c ", PORTAL_ACCOUNT_PASSWORD: "p!w" });
  check(on?.email === "a@b.c" && on.password === "p!w", "on with both: the account (email trimmed, password exact, '!' kept)");
  check(redact(`typed ${CREDS.password} into the form`, CREDS) === "typed •••••• into the form", "redact() masks the password");
  check(redact("nothing to hide", CREDS) === "nothing to hide" && redact("x", null) === "x", "…and leaves other text and a missing account alone");
  check(portalHost("https://www.Autodesk.wd1.myworkdayjobs.com/en-US/Ext/job/x") === "autodesk.wd1.myworkdayjobs.com", "a portal is identified by its host");

  console.log("\nwhich page is this (from what it shows)");
  const facts = (over: Partial<Parameters<typeof classifyAccountPage>[0]>) => ({ pw: 0, confirm: false, buttons: [] as string[], text: "", ...over });
  check(classifyAccountPage(facts({ pw: 1, buttons: ["Sign In"] })) === "signin", "one password and a Sign In button: sign-in");
  check(classifyAccountPage(facts({ pw: 2 })) === "signup" && classifyAccountPage(facts({ pw: 1, confirm: true })) === "signup", "two passwords, or a confirm field: sign-up");
  check(classifyAccountPage(facts({ pw: 1, buttons: ["Create Account"] })) === "signup", "one password and only a Create Account button: sign-up");
  check(classifyAccountPage(facts({ pw: 1, buttons: ["Sign In", "Create Account"] })) === "signin", "a sign-in page that also offers Create Account is still sign-in");
  check(classifyAccountPage(facts({ text: "check your email. we've sent you a link to verify your account." })) === "verify", "'check your email': verify");
  check(classifyAccountPage(facts({ text: "vérifiez votre courriel pour activer votre compte" })) === "verify", "…in French");
  check(classifyAccountPage(facts({ text: "first name last name resume" })) === "none", "a form: not an account page");

  console.log("\nthe verification link in a mailbox");
  const now = Date.now();
  const mail = (over: Partial<MailMessage>): MailMessage => ({ from: "no-reply@acme.com", subject: "Verify your account", receivedMs: now, text: "", html: "", ...over });
  const pick = (m: MailMessage[], host = "careers.acme.com") => pickVerificationLink(m, host, now - 5000);
  check(pick([mail({ html: '<a href="https://careers.acme.com/verify?token=abc">Verify my email</a>' })]) === "https://careers.acme.com/verify?token=abc", "a verify link on the portal's own site");
  check(pick([mail({ subject: "Activate your account", text: "Open https://acme.wd3.myworkdayjobs.com/activate/xyz to activate." })], "careers.acme.com") === "https://acme.wd3.myworkdayjobs.com/activate/xyz", "a known application system (Workday), even off the employer's own domain");
  check(pick([mail({ html: '<a href="https://evil.example.net/verify?t=1">Verify</a>' })]) === null, "a verify link to any other site is never taken");
  check(pick([mail({ html: '<a href="https://careers.acme.com/unsubscribe?verify=1">unsubscribe</a><a href="https://careers.acme.com/confirm/9">Confirm</a>' })]) === "https://careers.acme.com/confirm/9", "unsubscribe, privacy and terms links are skipped");
  check(pick([mail({ receivedMs: now - 3_600_000, html: '<a href="https://careers.acme.com/verify/old">Verify</a>' })]) === null, "a message from before the account was created is ignored");
  check(pick([mail({ subject: "Your weekly jobs", html: '<a href="https://careers.acme.com/jobs/1">Job</a>' })]) === null, "a message that does not read like verification is ignored");
  check(pick([mail({ html: '<a href="https://evil.co.uk/verify?t=1">Verify</a>' })], "careers.acme.co.uk") === null, "another site under the same country suffix (.co.uk) is not the portal's own");
  check(
    pick(
      [mail({ from: "ABB Workday <abb@otp.workday.com>", subject: "Verify your candidate account", html: "<style>body { font-size: 12px; }</style><div>Click this link to confirm your email address and complete setup for your candidate account https://abb.wd3.myworkdayjobs.com/External_Career_Page/activate/abc123tok/?redirect=%2FExternal_Career_Page&amp;x=1</div>" })],
      "abb.wd3.myworkdayjobs.com",
    ) === "https://abb.wd3.myworkdayjobs.com/External_Career_Page/activate/abc123tok/?redirect=%2FExternal_Career_Page&x=1",
    "Workday's activation link printed as bare text in an HTML-only message (abb.wd3)",
  );
  check(registrable("careers.acme.qc.ca") === "acme.qc.ca" && registrable("a.wd1.myworkdayjobs.com") === "myworkdayjobs.com", "the registered name keeps a country's second level");

  console.log("\nwhere the account password may be typed");
  check(accountHostAllowed("https://acme.wd3.myworkdayjobs.com/en-US/careers/login"), "a Workday tenant over https");
  check(!accountHostAllowed("http://acme.wd3.myworkdayjobs.com/login"), "never over plain http");
  check(!accountHostAllowed("https://myworkdayjobs.com.evil.example/login") && !accountHostAllowed("https://evilmyworkdayjobs.com/login"), "look-alike hosts are refused");
  check(!accountHostAllowed("https://careers.acme.com/login"), "an employer's own host is refused unless listed");
  check(accountHostAllowed("https://jobs.careers.acme.com/login", { PORTAL_ACCOUNT_HOSTS: "careers.acme.com" }), "…and accepted once listed in PORTAL_ACCOUNT_HOSTS (subdomains included)");
  check(pick([mail({ subject: "Confirmez votre compte", text: "Cliquez ici: https://careers.acme.com/confirmer?code=1." })]) === "https://careers.acme.com/confirmer?code=1", "a French, text-only message");
}

async function main() {
  unitChecks();

  const { server, base } = await serve(path.join(process.cwd(), "scripts", "fixtures", "portal"));
  const browser = await chromium.launch({ headless: true });
  try {
    const session = async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      return { context, page };
    };
    const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("acct") || "null") as { email: string; password: string; verified: boolean } | null);
    type Ctx = Partial<Parameters<typeof passAccountWall>[1]>;
    const run = async (page: Page, over: Ctx = {}) => {
      const records: Array<[string, AccountState, string | null]> = [];
      const logs: string[] = [];
      const outcome = await passAccountWall(page, {
        creds: CREDS,
        log: (l) => {
          logs.push(l);
          allLogs.push(l);
        },
        record: async (h, s, n) => void records.push([h, s, n]),
        // The fixtures are served on http://127.0.0.1; the host rule itself is checked on its own below.
        hostAllowed: () => true,
        ...over,
      });
      return { outcome, records, logs };
    };

    console.log("\nthe account pages of a portal (fixtures)");
    {
      const { context, page } = await session();
      const kinds: Record<string, string> = {};
      for (const name of ["account-signin", "account-signup", "account-verify", "account-after", "account-captcha"]) {
        await page.goto(`${base}/${name}.html`);
        kinds[name] = await accountPageKind(page);
      }
      check(kinds["account-signin"] === "signin" && kinds["account-signup"] === "signup" && kinds["account-verify"] === "verify", "sign-in, sign-up and check-your-email pages are told apart", kinds);
      check(kinds["account-after"] === "none", "the application form is not an account page");
      await context.close();
    }

    console.log("\nan account that does not exist yet");
    let created: Awaited<ReturnType<typeof run>>;
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signin.html`);
      created = await run(page, { known: null });
      check(created.outcome.ok && created.outcome.action === "created", "an unknown portal: goes straight to the sign-up form and creates the account", created.outcome);
      const acct = await stored(page);
      check(acct?.email === CREDS.email && acct.password === CREDS.password, "the account holds the configured email and password");
      check((await page.evaluate(() => localStorage.getItem("alertsTicked"))) === "false", "the job-alerts / newsletter box was left alone");
      check(!created.logs.some((l) => /sign.?in/i.test(l) && /signing in/.test(l)), "no failed sign-in attempt first");
      check(created.records.at(-1)?.[1] === "created" && created.records.at(-1)?.[0] === portalHost(base), "it is remembered: state created, for this host", created.records);
      check(/account-after/.test(page.url()), "and lands on the application form");

      // The same account, another run: a known portal signs in and never visits the sign-up form.
      const again = await context.newPage();
      await again.goto(`${base}/account-signin.html`);
      const back = await run(again, { known: "created" });
      check(back.outcome.ok && back.outcome.action === "signed_in" && !back.logs.some((l) => /sign-up form|creating the account/.test(l)), "a portal it has an account on: signs in, does not create another", back);
      await context.close();
    }

    console.log("\nan account that already exists (this portal was not known)");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signin.html`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: c.password, verified: true })), CREDS);
      const r = await run(page, { known: null });
      check(r.outcome.ok && r.outcome.action === "signed_in", "'already exists' on sign-up: it signs in instead, and does not claim it created one", r.outcome);
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signin.html`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: "another-password", verified: true })), CREDS);
      const r = await run(page, { known: "created" });
      check(!r.outcome.ok && /could not sign in/i.test(r.outcome.reason) && r.records.at(-1)?.[1] === "failed", "an account with another password: stops and says so, does not create a second", r.outcome);
      await context.close();
    }

    console.log("\nverifying the account");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signin.html?verify=1`);
      let askedFor = "";
      const r = await run(page, {
        known: null,
        verificationLink: async (host) => {
          askedFor = host;
          return `${base}/account-verified.html`;
        },
      });
      check(r.outcome.ok, "the portal asks to verify: the mailed link is opened, then it signs in", r.outcome);
      check(askedFor === portalHost(base) && r.records.some((x) => x[1] === "verify_email"), "the mailbox was asked for this portal, and the wait was recorded");
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signin.html?verify=1`);
      const r = await run(page, { known: null });
      check(!r.outcome.ok && /verify the email/i.test(r.outcome.reason) && r.outcome.reason.includes(CREDS.email) && r.records.at(-1)?.[1] === "verify_email", "no mailbox link: stops, says which email to verify, and to run again", r.outcome);
      await context.close();
    }

    console.log("\nwhat it stops on");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-captcha.html`);
      const r = await run(page, { known: null });
      check(!r.outcome.ok && /captcha/i.test(r.outcome.reason), "a CAPTCHA: stops, never tries to solve it", r.outcome);
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-extra.html`);
      const r = await run(page, { known: null });
      check(!r.outcome.ok && /more than an email, a password and your name/i.test(r.outcome.reason) && /first name/i.test(r.outcome.reason), "a form wanting a name, with no profile given: stops, says what, and does not invent one", r.outcome);
      check((await page.evaluate(() => localStorage.getItem("pressed"))) === null, "…without pressing Create Account");
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-extra.html`);
      await run(page, { known: null, profile: { firstName: "Ara", lastName: "Ghahramanyan", phone: null, country: "Canada" } });
      const typed = await page.evaluate(() => [(document.getElementById("first") as HTMLInputElement).value, (document.getElementById("last") as HTMLInputElement).value]);
      check(typed[0] === "Ara" && typed[1] === "Ghahramanyan", "with your profile, the name the account form asks for is your own", typed);
      check((await page.evaluate(() => localStorage.getItem("pressed"))) === "1", "…and Create Account is pressed");
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signup.html?rule=1`);
      const r = await run(page, { known: null });
      check(!r.outcome.ok && /refuses the password/i.test(r.outcome.reason), "a password the portal refuses: stops with its message, never picks another", r.outcome);
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signin.html`);
      let threw = "";
      await passAccountWall(page, { creds: { email: "", password: "" }, log: () => undefined, record: async () => undefined, known: null }).catch((e: Error) => (threw = e.message));
      check(/PORTAL_CREATE_ACCOUNTS/.test(threw), "without the account configured, nothing is pressed at all", threw);
      await context.close();
    }

    console.log("\nthe password is typed only on a known application system");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-signin.html`);
      const r = await run(page, { known: "created", hostAllowed: undefined });
      check(!r.outcome.ok && /not a known application system/.test(r.outcome.reason), "an unknown host (here the fixture server) never receives the password", r.outcome);
      check((await stored(page)) === null, "…and nothing was typed into it");
      await context.close();
    }

    console.log("\nWorkday-shaped pages (the ids are not checked against a live tenant)");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-workday-start.html`);
      const r = await run(page, { known: null });
      check(r.outcome.ok && r.outcome.action === "created", "Apply Manually → sign-in → Create Account → created, by automation id", { outcome: r.outcome, logs: r.logs });
      const wizard = await wizardReason(page);
      check(!!wizard && /Workday/.test(wizard) && /complete it yourself/.test(wizard), "then the wizard is recognised and left to you, not planned as a form", wizard);
      await page.goto(`${base}/account-after.html`);
      check((await wizardReason(page)) === null, "a single-page application is not a wizard");
      await context.close();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // The account subsystem's cases (A to F), on an unknown portal worded its own way.
    // ------------------------------------------------------------------------------------------------------------------
    const vaultFile = path.join(os.tmpdir(), `desk-vault-check-${process.pid}.json`);
    const freshVault = () => {
      rmSync(vaultFile, { force: true });
      return fileVault(vaultFile, "check-only-key-0123456789");
    };
    const local = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
    const PROFILE = { firstName: "Ara", lastName: "Ghahramanyan", phone: "438-993-6997", country: "Canada", region: "Quebec", city: "Montréal", postalCode: null };

    console.log("\nCASE A: no account needed");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-after.html`);
      const states: string[] = [];
      const r = await run(page, { known: null, onState: (s) => void states.push(s) });
      check(r.outcome.ok && r.outcome.action === "none" && r.records.length === 0, "the application form itself: nothing to do, nothing recorded", r.outcome);
      check(!states.includes("REGISTERING_ACCOUNT") && !states.includes("SIGNING_IN"), "…and no sign-in or registration was attempted", states);
      await context.close();
    }

    console.log("\nCASE B / F: an unknown portal, no account yet: created, the slow way (the abb / cisco regression)");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?delay=6`);
      const states: string[] = [];
      const started = Date.now();
      const r = await run(page, { known: null, profile: PROFILE, onState: (s) => void states.push(s) });
      check(r.outcome.ok && r.outcome.action === "created", "'Create your profile' → 'Create Profile' → created, though the portal took 6 s to answer", { outcome: r.outcome, logs: r.logs });
      check(Date.now() - started >= 6000 && /account-after/.test(page.url()), "it waited for the portal's answer and landed on the application");
      const acct = JSON.parse((await local(page, "acct")) ?? "null") as { given: string; family: string; province: string; email: string } | null;
      check(acct?.given === "Ara" && acct.family === "Ghahramanyan" && acct.province === "Québec" && acct.email === CREDS.email, "'Given name', 'Family Name' and a Province list were filled from your profile (shared classifier)", acct);
      check((await local(page, "honeypot")) === "", "the robots-only field was left empty");
      check((await local(page, "presses")) === "1", "Create Profile was pressed once, not again while the portal worked");
      check(["CHECKING_EXISTING_ACCOUNT", "REGISTERING_ACCOUNT", "AUTHENTICATED"].every((s) => states.includes(s)), "states: checking → registering → authenticated", states);
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-slow-signup.html?delay=60`);
      const r = await run(page, { known: null, profile: PROFILE, reactionMs: 1500 });
      check(!r.outcome.ok && /did not react to Create Account/.test(r.outcome.reason) && /run the application again/.test(r.outcome.reason), "a portal that never answers: pressed once more, then stops and says what the page showed (bounded)", { outcome: r.outcome, logs: r.logs });
      check((await local(page, "presses")) === "2", "…exactly two presses, no loop");
      await context.close();
    }

    console.log("\nCASE C: the account exists: signed in, nothing created");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: c.password, verified: true })), CREDS);
      const states: string[] = [];
      const r = await run(page, { known: "created", onState: (s) => void states.push(s) });
      check(r.outcome.ok && r.outcome.action === "signed_in" && states.includes("SIGNING_IN") && !states.includes("REGISTERING_ACCOUNT"), "a known portal: 'Log in' with the username field, no new profile", { outcome: r.outcome, states });
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-slow-signup.html?delay=0`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: c.password, verified: true })), CREDS);
      const r = await run(page, { known: null, profile: PROFILE });
      check(r.outcome.ok && r.outcome.action === "signed_in", "'A candidate profile already exists for this email': switches to signing in", { outcome: r.outcome, logs: r.logs });
      await context.close();
    }

    console.log("\nCASE D: a mailed verification code");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?delay=0&code=1`);
      let askedFor = "";
      const r = await run(page, {
        known: null,
        profile: PROFILE,
        verificationCode: async (host) => {
          askedFor = host;
          return "482913";
        },
      });
      check(r.outcome.ok && r.outcome.action === "created" && askedFor === portalHost(base), "the code from the mailbox is typed and the account goes through", { outcome: r.outcome, logs: r.logs });
      check(r.records.some((x) => x[1] === "verify_email") && r.records.at(-1)?.[1] === "created", "the wait for the code was recorded, then the account");
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?delay=0&code=1`);
      const r = await run(page, { known: null, profile: PROFILE });
      check(!r.outcome.ok && /Type the code the portal mailed to test@example\.com/.test(r.outcome.reason) && r.records.at(-1)?.[1] === "verify_email", "no mailbox: stops, says where the code went, resumes signed in next run", r.outcome);
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?delay=0&code=1`);
      let asked = 0;
      const r = await run(page, { known: null, profile: PROFILE, verificationCode: async () => (asked++, "000000") });
      check(!r.outcome.ok && asked === 2 && /did not accept the mailed code/.test(r.outcome.reason), "a refused code: one newer code is fetched, then it stops (two tries, no loop)", { outcome: r.outcome, asked });
      await context.close();
    }

    console.log("\nCASE E: what only a person may answer");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?mfa=1`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: c.password, verified: true })), CREDS);
      const r = await run(page, { known: "created", verificationCode: async () => "123456" });
      check(!r.outcome.ok && r.outcome.intervention === true && /second factor|SMS/.test(r.outcome.reason), "a code sent to a phone: stops for you, flagged as an intervention", r.outcome);
      check((await local(page, "mfaTyped")) === null, "…and nothing was typed into it, even with a mailbox at hand");
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-captcha.html`);
      const states: string[] = [];
      const r = await run(page, { known: null, onState: (s) => void states.push(s) });
      check(!r.outcome.ok && r.outcome.intervention === true && states.at(-1) === "MANUAL_INTERVENTION_REQUIRED", "a CAPTCHA: MANUAL_INTERVENTION_REQUIRED, never solved", { outcome: r.outcome, states });
      await context.close();
    }
    check(classifyAccountPage({ pw: 0, confirm: false, buttons: [], text: "postal code phone number email first name we sent you a verification code", codeInput: true, inputs: 12 }) === "none", "an application form that mentions a code and a phone is not a challenge page");

    console.log("\nan account that exists but was never verified (abb.wd3)");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?unverified=1`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: c.password, verified: false })), CREDS);
      let since = 0;
      const r = await run(page, {
        known: "failed",
        profile: PROFILE,
        verificationLink: async (_host, s) => {
          since = s;
          return `${base}/account-verified.html`;
        },
      });
      check(r.outcome.ok && r.outcome.action === "signed_in", "'Verify your account before you sign in': a new email is asked for, its link opened, then signed in", { outcome: r.outcome, logs: r.logs });
      check((await local(page, "resent")) === "1" && since > 0, "…'Resend Account Verification' pressed once, the mailbox read from that moment");
      await context.close();
    }
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?unverified=1`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: c.password, verified: false })), CREDS);
      const r = await run(page, { known: "failed", profile: PROFILE });
      check(!r.outcome.ok && /exists but is not verified/.test(r.outcome.reason) && r.records.at(-1)?.[1] === "verify_email", "no mailbox: says the account exists and needs verifying (not 'wrong password')", r.outcome);
      await context.close();
    }

    console.log("\na portal that opens on Create Account, for a portal the desk has an account on");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-slow-signup.html?delay=0`);
      await page.evaluate((c) => localStorage.setItem("acct", JSON.stringify({ email: c.email, password: c.password, verified: true })), CREDS);
      const r = await run(page, { known: "created", profile: PROFILE });
      check(r.outcome.ok && r.outcome.action === "signed_in" && (await local(page, "presses")) === null, "it goes to 'Log in' and signs in, without pressing Create Profile", { outcome: r.outcome, logs: r.logs });
      await context.close();
    }

    console.log("\na sign-in page offering Google, LinkedIn or email (newer Workday tenants)");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-email-choice.html?delay=0`);
      const r = await run(page, { known: null, profile: PROFILE });
      check(r.outcome.ok && r.outcome.action === "created", "'Sign in with email' is chosen, then the account is created", { outcome: r.outcome, logs: r.logs });
      check((await local(page, "social")) === null, "Google and LinkedIn are never pressed");
      await context.close();
    }

    console.log("\napplying without an account");
    {
      const { context, page } = await session();
      await page.goto(`${base}/account-generic-signin.html?guest=1`);
      const states: string[] = [];
      const r = await run(page, { known: null, onState: (s) => void states.push(s) });
      check(r.outcome.ok && r.outcome.action === "guest" && (await local(page, "acct")) === null, "'Apply as Guest' is taken: no account is made in your name", r.outcome);
      check(states.includes("APPLYING_WITHOUT_ACCOUNT"), "…recorded as APPLYING_WITHOUT_ACCOUNT", states);
      await context.close();
    }

    console.log("\npassword rules and the vault");
    {
      // The portal prints "a minimum of 24 characters": the configured 14-character password cannot be used there.
      const { context, page } = await session();
      await page.goto(`${base}/account-slow-signup.html?delay=0&min=24`);
      const r = await run(page, { known: null, profile: PROFILE });
      check(!r.outcome.ok && /shorter than 24 characters/.test(r.outcome.reason) && /PORTAL_VAULT_KEY/.test(r.outcome.reason), "rules the configured password breaks, no vault: stops before pressing, says which rule and how to fix it", r.outcome);
      check((await local(page, "presses")) === null, "…nothing was pressed");
      await context.close();
    }
    {
      const vault = freshVault();
      const provider = credentialProvider(CREDS, vault);
      const { context, page } = await session();
      await page.goto(`${base}/account-slow-signup.html?delay=0&min=24`);
      const r = await run(page, { known: null, profile: PROFILE, credentials: provider });
      const acct = JSON.parse((await local(page, "acct")) ?? "null") as { password: string } | null;
      const kept = vault.get(portalHost(base), CREDS.email);
      check(r.outcome.ok && r.outcome.action === "created", "with the vault: a password meeting the printed rules is made for this portal and the account is created", { outcome: r.outcome, logs: r.logs });
      check(!!acct && acct.password.length >= 24 && acct.password !== CREDS.password && kept?.password === acct.password && kept.confirmed, "the portal holds the generated password, the vault holds the same, confirmed");
      check(!r.logs.some((l) => l.includes(acct?.password ?? "\u0000")), "the generated password appears in no log line");
      // The next run on this portal signs in with the vault's password.
      const again = await context.newPage();
      await again.goto(`${base}/account-generic-signin.html`);
      const back = await run(again, { known: "created", credentials: provider });
      check(back.outcome.ok && back.outcome.action === "signed_in", "the next run signs in with the password kept for this portal", back.outcome);
      await context.close();
      check(!readFileSync(vaultFile, "utf8").includes(acct?.password ?? "\u0000"), "the vault file holds no password in clear");
    }
    {
      // No printed rule, then a refusal that names one: one compliant password, once.
      const vault = freshVault();
      const { context, page } = await session();
      await page.goto(`${base}/account-signup.html?rule=1`);
      const r = await run(page, { known: null, credentials: credentialProvider(CREDS, vault) });
      const acct = JSON.parse((await local(page, "acct")) ?? "null") as { password: string } | null;
      check(r.outcome.ok && r.outcome.action === "created" && (acct?.password.length ?? 0) >= 30, "a refusal naming the rule (30 characters): one password meeting it is made and the account goes through", { outcome: r.outcome, logs: r.logs });
      await context.close();
      rmSync(vaultFile, { force: true });
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\nthe password stays where it belongs");
  check(allLogs.length > 0 && !allLogs.some((l) => l.includes(CREDS.password)), "no log line of any run contained the password", allLogs.filter((l) => l.includes(CREDS.password)));
  // "\n" line endings whatever the checkout uses, so the scans below match on Windows (CRLF) too.
  const source = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  const account = source(path.join("lib", "apply", "account.ts"));
  const uses = account.split("\n").filter((l) => /\.password/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"));
  check(uses.every((l) => /\.fill\(creds\.password\)|\.length !== creds\.password\.length|!ctx\.creds\.password/.test(l)), "account.ts uses the password only to type it, compare its length and check it is set", uses);
  check(!/console\./.test(account), "account.ts never prints");
  const press = account.match(/async function press\([\s\S]*?\n}\n/)?.[0] ?? "";
  check((account.match(/\.click\(/g) ?? []).length === (press.match(/\.click\(/g) ?? []).length && press.length > 0, "every click in account.ts is inside press(), which refuses without the account");
  // (Built from pieces: assist-check forbids that word anywhere outside the submit module, this file included.)
  check(!new RegExp(["submit", "Selectors"].join("")).test(account), "account.ts never touches the application's Submit");
  const schema = source("schema-v12.sql").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  check(!/password/i.test(schema), "the database table has no password column");
  const runner = source(path.join("lib", "apply", "runner.ts"));
  const portalApply = source(path.join("scripts", "portal-apply.ts"));
  const automate = source(path.join("scripts", "automate.ts"));
  check(/allowAccounts: !flag\("no-accounts"\)/.test(portalApply) && !/allowAccounts/.test(automate) && (portalApply.match(/allowAccounts/g) ?? []).length === 1, "only a run for one named application may use the account: the queue and automate never do");
  check(/opts\.allowAccounts \? accountCredentials\(\) : null/.test(runner), "the runner uses the account only when the run allows it");

  if (failures) {
    console.log(`\n${failures} account check(s) FAILED`);
    process.exit(1);
  }
  console.log("\naccount-check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
