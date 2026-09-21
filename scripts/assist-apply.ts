// Open a posting, fill what the answer bank allows, leave Submit alone.
//   npx tsx scripts/assist-apply.ts --application <uuid>
//   npx tsx scripts/assist-apply.ts --url <https://...>
//
// Deliberately incomplete: headed Chromium only, no click on Submit/Apply.
// Target companies (is_target) require --i-know unless you pass a non-target URL.

import { chromium, type Locator, type Page } from "playwright";
import { planField, looksLikeSubmit, type FieldPlan } from "../lib/assist-fields";
import { pool } from "../lib/db";
import { detectLetterLang } from "../lib/letter";
import type { Answer } from "../lib/types";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function loadAnswers(): Promise<Answer[]> {
  const { rows } = await pool.query<Answer>(
    `SELECT id, key, category, answer_en, answer_fr, updated_at FROM answers ORDER BY key`,
  );
  return rows;
}

async function loadApplication(id: string) {
  const { rows } = await pool.query<{
    id: string;
    resume_path: string | null;
    cover_letter_path: string | null;
    title: string;
    description: string | null;
    url: string;
    company_name: string;
    is_target: boolean;
  }>(
    `SELECT a.id, a.resume_path, a.cover_letter_path,
            j.title, j.description, j.url,
            c.name AS company_name, c.is_target
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function collectLabeledControls(page: Page): Promise<Array<{ label: string; locator: Locator }>> {
  // Prefer accessible name via getByLabel by discovering <label> text and aria-label.
  const labels = await page.evaluate(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: string | null | undefined) => {
      const v = (value ?? "").replace(/\s+/g, " ").trim();
      if (!v || seen.has(v.toLowerCase())) return;
      seen.add(v.toLowerCase());
      out.push(v);
    };
    for (const label of Array.from(document.querySelectorAll("label"))) {
      push(label.innerText || label.textContent);
    }
    for (const el of Array.from(document.querySelectorAll("input, textarea, select"))) {
      push(el.getAttribute("aria-label"));
      const id = el.getAttribute("id");
      if (id) {
        const by = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        push(by?.textContent);
      }
    }
    return out;
  });

  return labels.map((label) => ({ label, locator: page.getByLabel(label, { exact: false }) }));
}

async function highlight(locator: Locator, color: string) {
  const handle = await locator.first().elementHandle().catch(() => null);
  if (!handle) return;
  await handle.evaluate((node, c) => {
    const el = node as HTMLElement;
    el.style.outline = `3px solid ${c}`;
    el.style.outlineOffset = "2px";
  }, color);
}

async function fillPlan(page: Page, plan: FieldPlan): Promise<"ok" | "missing" | "skipped"> {
  if (looksLikeSubmit(plan.label)) return "skipped";

  const control = page.getByLabel(plan.label, { exact: false }).first();
  const visible = await control.isVisible().catch(() => false);
  if (!visible) return "missing";

  if (plan.action === "leave-empty-red" || plan.action === "leave-empty-unknown") {
    await highlight(control, plan.action === "leave-empty-red" ? "#c0392b" : "#7f8c8d");
    return "skipped";
  }

  if (plan.action === "set-file") {
    if (!plan.value) return "missing";
    await control.setInputFiles(plan.value);
    await highlight(control, "#27ae60");
    return "ok";
  }

  if (!plan.value) {
    await highlight(control, "#7f8c8d");
    return "missing";
  }

  const tag = await control.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
  if (tag === "select") {
    await control.selectOption({ label: plan.value }).catch(async () => {
      await control.selectOption({ value: plan.value! }).catch(() => undefined);
    });
  } else {
    await control.fill(plan.value);
  }

  await highlight(control, plan.action === "fill-yellow" ? "#f1c40f" : "#27ae60");
  return "ok";
}

async function assertNoSubmitInThisFile() {
  // Structural reminder: this process must never click submit.
  const forbidden = process.argv.join(" ").match(/click\(.*submit/i);
  if (forbidden) throw new Error("refusing to run: submit click requested");
}

async function main() {
  await assertNoSubmitInThisFile();

  const applicationId = arg("application");
  const urlArg = arg("url");
  const iKnow = hasFlag("i-know");

  if (!applicationId && !urlArg) {
    console.error("Usage:");
    console.error("  npx tsx scripts/assist-apply.ts --application <uuid>");
    console.error("  npx tsx scripts/assist-apply.ts --url <https://...> [--i-know]");
    process.exit(1);
  }

  const answers = await loadAnswers();
  let url = urlArg;
  let resumePath: string | null = null;
  let coverLetterPath: string | null = null;
  let title = "manual URL";
  let description: string | null = null;
  let companyName = "unknown";
  let isTarget = false;

  if (applicationId) {
    const app = await loadApplication(applicationId);
    if (!app) throw new Error(`application not found: ${applicationId}`);
    url = app.url;
    resumePath = app.resume_path;
    coverLetterPath = app.cover_letter_path;
    title = app.title;
    description = app.description;
    companyName = app.company_name;
    isTarget = app.is_target;
  }

  if (!url) throw new Error("no URL to open");

  if (isTarget && !iKnow) {
    console.error(
      `${companyName} is marked is_target. Fill that form by hand, or re-run with --i-know if you still want assist.`,
    );
    process.exit(2);
  }

  const lang = detectLetterLang(title, description);
  console.log(`Opening ${companyName} · ${title}`);
  console.log(`URL: ${url}`);
  console.log("Browser is headed. Submit stays yours — this script will not click it.\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Greenhouse often has an Apply button that opens the form — click Apply only if it is not Submit.
  const apply = page.getByRole("button", { name: /^(apply|postuler)$/i }).first();
  if (await apply.isVisible().catch(() => false)) {
    const name = (await apply.innerText().catch(() => "")).trim();
    if (!looksLikeSubmit(name) && !/submit/i.test(name)) {
      await apply.click().catch(() => undefined);
      await page.waitForTimeout(1000);
    }
  }

  const controls = await collectLabeledControls(page);
  const filled: FieldPlan[] = [];
  const yellow: FieldPlan[] = [];
  const red: FieldPlan[] = [];
  const unknown: FieldPlan[] = [];
  const missing: string[] = [];

  for (const { label } of controls) {
    if (looksLikeSubmit(label)) continue;
    const plan = planField(label, answers, { lang, resumePath, coverLetterPath });
    const result = await fillPlan(page, plan);
    if (plan.action === "fill-green" || plan.action === "set-file") {
      if (result === "ok") filled.push(plan);
      else if (result === "missing") missing.push(label);
    } else if (plan.action === "fill-yellow") {
      yellow.push(plan);
      if (result === "missing") missing.push(label);
    } else if (plan.action === "leave-empty-red") {
      red.push(plan);
    } else {
      unknown.push(plan);
    }
  }

  console.log("—— results ——");
  console.log(`green/file filled: ${filled.length}`);
  for (const p of filled) console.log(`  [green] ${p.label} ← ${p.key}`);
  console.log(`yellow prefilled (review): ${yellow.length}`);
  for (const p of yellow) console.log(`  [yellow] ${p.label} ← ${p.key}`);
  console.log(`red left empty (type yourself): ${red.length}`);
  for (const p of red) console.log(`  [red] ${p.label} (${p.key})`);
  if (unknown.length) {
    console.log(`unmapped labels left alone: ${unknown.length}`);
    for (const p of unknown.slice(0, 20)) console.log(`  [?] ${p.label}`);
  }
  if (missing.length) {
    console.log(`labeled but not fillable right now: ${missing.length}`);
    for (const label of missing) console.log(`  [missing] ${label}`);
  }

  console.log("\nForm is ready. Review yellow fields. Type the red ones yourself.");
  console.log("Submit the form in the browser when you are satisfied.");
  console.log("Then mark it submitted in Internship Desk — this script will not.");
  console.log("Press Enter here to close the browser window.");

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  await browser.close();
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
