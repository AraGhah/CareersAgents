import fs from "node:fs";
import { chromium } from "playwright";

const ids = fs.readFileSync("C:/Users/aragh/AppData/Local/Temp/claude/C--Users-aragh-OneDrive-Desktop--B--Internships-Ai-Agents-CareersAgents/70dc34eb-9d17-43f2-aeb0-8e208717ff11/scratchpad/ids_all.txt", "utf8").split(/\s+/).filter(Boolean);
const out = "C:/Users/aragh/AppData/Local/Temp/claude/C--Users-aragh-OneDrive-Desktop--B--Internships-Ai-Agents-CareersAgents/70dc34eb-9d17-43f2-aeb0-8e208717ff11/scratchpad/scan_all.jsonl";
fs.writeFileSync(out, "");
(async () => {
  const ctx = await chromium.launchPersistentContext("C:/temp/auto-job-apply-profile", { channel: "chrome", headless: false, viewport: null, timeout: 60_000 });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(15_000);
  for (const id of ids) {
    const t0 = Date.now();
    let kind = "unknown", names: string[] = [], err = "";
    try {
      await page.goto(`https://www.linkedin.com/jobs/view/${id}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const apply = page.locator("button, a").filter({ hasText: /apply|postuler|candidature/i });
      await apply.first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      const n = Math.min(await apply.count(), 4);
      for (let i = 0; i < n; i++) {
        const el = apply.nth(i);
        names.push(((await el.innerText().catch(() => "")).trim() + " | " + ((await el.getAttribute("aria-label")) ?? "")).slice(0, 90));
      }
      kind = names.some((x) => /easy apply|candidature simplifi/i.test(x)) ? "easy" : names.length ? "external" : "unknown";
      if (/signin|login|authwall/.test(page.url())) kind = "signed-out";
    } catch (e) { err = (e as Error).message.split("\n")[0].slice(0, 120); }
    const line = JSON.stringify({ id, kind, names, err, secs: Math.round((Date.now() - t0) / 1000) });
    console.log(line);
    fs.appendFileSync(out, line + "\n");
    if (kind === "signed-out") break;
    await page.waitForTimeout(1500);
  }
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
