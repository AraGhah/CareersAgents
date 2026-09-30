// Offline: no database, no network, no real employer. The account step of a portal application, on local fixture pages that
// behave like the account pages of an employer portal, with fake credentials (never the real ones).
//   npm run account:check

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { accountCredentials, portalHost, redact } from "../lib/apply/account-config";
import { accountPageKind, classifyAccountPage, passAccountWall, type AccountState } from "../lib/apply/account";
import { pickVerificationLink, type MailMessage } from "../lib/apply/account-mail";
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
      check(!r.outcome.ok && /more than an email and a password/i.test(r.outcome.reason) && /first name/i.test(r.outcome.reason), "a form wanting a name: stops, says what, and does not invent one", r.outcome);
      check((await page.evaluate(() => localStorage.getItem("pressed"))) === null, "…without pressing Create Account");
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
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\nthe password stays where it belongs");
  check(allLogs.length > 0 && !allLogs.some((l) => l.includes(CREDS.password)), "no log line of any run contained the password", allLogs.filter((l) => l.includes(CREDS.password)));
  const source = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const account = source(path.join("lib", "apply", "account.ts"));
  const uses = account.split("\n").filter((l) => /\.password/.test(l) && !l.trim().startsWith("//") && !l.trim().startsWith("*"));
  check(uses.every((l) => /\.fill\(ctx\.creds\.password\)|\.length !== ctx\.creds\.password\.length|!ctx\.creds\.password/.test(l)), "account.ts uses the password only to type it, compare its length and check it is set", uses);
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
