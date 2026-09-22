// Record a 1080p demo of real UI flows (Playwright video).
// Requires: npm run dev  (http://127.0.0.1:3000) and schema-v9 applied.
//   npx tsx scripts/record-demo.ts
//
// Output: demos/internship-desk-demo.webm (convert to mp4 with ffmpeg if needed)

import { mkdir, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Prefer the user-level Playwright browser cache (not Cursor's sandbox temp path).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    "AppData",
    "Local",
    "ms-playwright",
  );
}

const BASE = process.env.DEMO_BASE_URL?.trim() || "http://127.0.0.1:3000";
const OUT_DIR = path.join("demos");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  const pause = (ms: number) => page.waitForTimeout(ms);

  console.log(`Recording against ${BASE}`);
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 60000 });
  await pause(2000);

  // Dashboard / sources visible
  await page.locator("h1").first().scrollIntoViewIfNeeded();
  await pause(1500);

  // Change active CV
  await page.goto(`${BASE}/resumes`, { waitUntil: "networkidle" });
  await pause(2000);
  const activate = page.locator("form").filter({ hasText: "Activer" }).locator("button").first();
  if (await activate.count()) {
    // Don't toggle if already active rows only show Réanalyser
  }
  await pause(1500);

  // Find Internships
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
  await pause(1000);
  const findBtn = page.getByRole("button", { name: "Find Internships" });
  if (await findBtn.count()) {
    await Promise.all([
      page.waitForURL(/pipeline\?found=1/, { timeout: 180000 }).catch(() => null),
      findBtn.click(),
    ]);
    await pause(2500);
  }

  // Open first application in pipeline if any
  const appLink = page.locator('table a[href^="/applications/"]').first();
  if (await appLink.count()) {
    await appLink.click();
    await page.waitForLoadState("networkidle");
    await pause(2000);

    const prepare = page.getByRole("button", { name: /Préparer/ });
    if (await prepare.count()) {
      await Promise.all([
        page.waitForURL(/prepared=1/, { timeout: 180000 }).catch(() => null),
        prepare.click(),
      ]);
      await pause(2500);
    }

    const approve = page.getByRole("button", { name: /Approuver/ });
    if (await approve.count()) {
      // Only click approve if Gmail is configured; otherwise skip to avoid error overlay
      const hasGmail = Boolean(process.env.GMAIL_CLIENT_ID);
      if (hasGmail) {
        await Promise.all([
          page.waitForURL(/approved=/, { timeout: 120000 }).catch(() => null),
          approve.click(),
        ]);
        await pause(2000);
      } else {
        console.log("Skipping Gmail approve click — GMAIL_CLIENT_ID not set");
        await pause(1500);
      }
    }
  } else {
    console.log("No application links yet — recording dashboard + resumes only");
  }

  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle" });
  await pause(2000);
  await page.goto(`${BASE}/followups`, { waitUntil: "networkidle" });
  await pause(2000);

  const video = page.video();
  await context.close();
  await browser.close();

  if (video) {
    const rawPath = await video.path();
    const dest = path.join(OUT_DIR, "internship-desk-demo.webm");
    await rename(rawPath, dest);
    console.log(`Saved ${dest}`);
  } else {
    const files = await readdir(OUT_DIR);
    console.log("Video files:", files.join(", "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
