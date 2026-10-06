// Live try of the account step alone, on one employer portal: opens the posting's application page headless, gets past
// the Create Account / Sign In step with the account in .env.local, and stops there (nothing of the application is
// filled or submitted). Screenshots before and after go to applications/_portal/.
//   npx tsx scripts/account-try.ts <posting url>

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { pool } from "../lib/db";
import { accountCredentials, portalHost, redact } from "../lib/apply/account-config";
import { knownAccountState, passAccountWall } from "../lib/apply/account";
import { gmailVerificationLink } from "../lib/apply/account-mail";
import { gmailIsConnected } from "../lib/gmail";
import { adapterFor } from "../lib/apply/platforms";
import { assertPublicUrl } from "../lib/net-guard";

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error("usage: npx tsx scripts/account-try.ts <posting url>");
  const creds = accountCredentials();
  if (!creds) throw new Error("No account configured (PORTAL_CREATE_ACCOUNTS=true, PORTAL_ACCOUNT_EMAIL, PORTAL_ACCOUNT_PASSWORD).");
  const form = adapterFor(url).formUrl(url, { boardToken: null, externalId: null });
  const dir = path.join("applications", "_portal");
  await mkdir(dir, { recursive: true });
  const stamp = Date.now();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    console.log(`opening ${form}`);
    await page.goto((await assertPublicUrl(form)).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    await page.screenshot({ path: path.join(dir, `account-try-${stamp}-before.png`), fullPage: true });
    const gmail = await gmailIsConnected().catch(() => false);
    console.log(`Gmail for the verification link: ${gmail ? "connected" : "not connected"}`);
    const outcome = await passAccountWall(page, {
      creds,
      log: (line) => console.log(`  ${redact(line, creds)}`),
      known: await knownAccountState(portalHost(page.url())),
      verificationLink: gmail ? gmailVerificationLink : undefined,
      profile: { firstName: null, lastName: null, phone: null, country: null },
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(dir, `account-try-${stamp}-after.png`), fullPage: true });
    console.log(`→ ${JSON.stringify(outcome)} · now on ${page.url()}`);
    console.log(`screenshots: ${dir}/account-try-${stamp}-before.png, -after.png`);
  } finally {
    await browser.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
