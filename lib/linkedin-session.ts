// Your LinkedIn session for the desk's Easy Apply runs. The cookies live in cache/linkedin-state.json (gitignored, like
// the Gmail token) and are loaded into a fresh browser each run: no shared Chrome profile, so nothing stays locked
// between runs. `npm run linkedin:signin` opens a window where you sign in yourself; the desk never types a password.

import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";

export const LINKEDIN_STATE = path.join(process.cwd(), "cache", "linkedin-state.json");
const SIGN_IN_TIMEOUT_MS = 15 * 60_000;
const NOT_SIGNED_IN = /\/(login|checkpoint|uas|authwall|signup)\b/;

export type LinkedInBrowser = { browser: Browser; context: BrowserContext };

/** Real Chrome when installed (LinkedIn treats Playwright's test build with more suspicion), else Playwright's Chromium. */
export async function openLinkedIn(opts: { headless?: boolean; locale?: string } = {}): Promise<LinkedInBrowser> {
  const launch = { headless: opts.headless ?? false, args: ["--start-maximized"] };
  const browser = await chromium.launch({ ...launch, channel: "chrome" }).catch(() => chromium.launch(launch));
  const context = await browser.newContext({
    viewport: null,
    locale: opts.locale ?? "en-CA",
    storageState: fs.existsSync(LINKEDIN_STATE) ? LINKEDIN_STATE : undefined,
  });
  return { browser, context };
}

export async function hasSessionCookie(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://www.linkedin.com");
  const now = Date.now() / 1000;
  return cookies.some((c) => c.name === "li_at" && (c.expires === -1 || c.expires > now));
}

/** Signed in = the session cookie is set and LinkedIn does not send the feed to a login or checkpoint page. */
export async function isSignedIn(context: BrowserContext): Promise<boolean> {
  if (!(await hasSessionCookie(context))) return false;
  const page = await context.newPage();
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2000);
    return !NOT_SIGNED_IN.test(page.url()) && (await hasSessionCookie(context));
  } catch {
    return false;
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function saveSession(context: BrowserContext): Promise<void> {
  fs.mkdirSync(path.dirname(LINKEDIN_STATE), { recursive: true });
  await context.storageState({ path: LINKEDIN_STATE });
}

/** Opens a visible window on LinkedIn's login page and returns once you are signed in (at once if you already are). */
export async function signInToLinkedIn(log: (line: string) => void = console.log): Promise<void> {
  const { browser, context } = await openLinkedIn({ headless: false });
  try {
    if (await isSignedIn(context)) {
      log("Already signed in to LinkedIn.");
      await saveSession(context);
      return;
    }
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
    log(">>> Sign in to LinkedIn in the browser window (finish any verification code). Waiting...");
    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    for (;;) {
      if (page.isClosed()) throw new Error("The sign-in window was closed before sign-in finished.");
      if ((await hasSessionCookie(context)) && !NOT_SIGNED_IN.test(page.url())) break;
      if (Date.now() > deadline) throw new Error("Not signed in after 15 minutes. Run it again when you are ready.");
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(3000);
    await saveSession(context);
    log("Signed in to LinkedIn. Session saved.");
  } finally {
    await browser.close().catch(() => undefined);
  }
}
