import { chromium } from "playwright";

const theme = process.argv[2] ?? "dark";
const only = process.argv[3];
const browser = await chromium.launch();
const errors = [];
const all = ["/", "/pipeline", "/board", "/resumes", "/followups", "/jobs/new", "/answers"];
const pages = only ? [only] : all;

for (const path of pages) {
  const page = await browser.newPage({ colorScheme: theme, viewport: { width: 1440, height: 950 } });
  await page.addInitScript((t) => localStorage.setItem("desk-theme", t), theme);
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${path}] ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => errors.push(`[${path}] ${e.message}`));
  await page.goto("http://localhost:3001" + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const name = path === "/" ? "home" : path.slice(1).replace(/\//g, "-");
  await page.screenshot({ path: `scripts/_tmp-${theme}-${name}.png` });
  await page.close();
}
await browser.close();
console.log(errors.length ? errors.join("\n") : `no errors (${theme})`);
