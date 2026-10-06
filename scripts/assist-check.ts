// Guards for the browser assist: no Submit clicks in the repo outside the one gated
// portal submit (lib/apply/submit.ts), and field planning works.
//   npx tsx scripts/assist-check.ts

import { readFileSync as readRaw, readdirSync, statSync } from "node:fs";

/** Source text with "\n" line endings, whatever the checkout uses (git on Windows writes CRLF). */
const readFileSync = (file: string, encoding: "utf8") => readRaw(file, encoding).replace(/\r\n/g, "\n");
import path from "node:path";
import { looksLikeSubmit, planFields } from "../lib/assist-fields";
import type { Answer } from "../lib/types";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "cache" || name === "applications") {
      continue;
    }
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function main() {
  const root = process.cwd();
  const files = walk(root);
  const offenders: string[] = [];
  const patterns = [
    /\.click\(\s*['"`][^'"`]*submit[^'"`]*['"`]\s*\)/i,
    /getByRole\(\s*['"`]button['"`]\s*,\s*\{\s*name:\s*\/submit/i,
    /page\.click\([^)]*submit/i,
    /locator\([^)]*submit[^)]*\)\.click/i,
  ];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Allow comments that mention the rule.
    const code = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    for (const re of patterns) {
      if (re.test(code)) offenders.push(`${path.relative(root, file)} ~ ${re}`);
    }
  }

  // The portal system has exactly one place allowed to press a final Submit: lib/apply/submit.ts. Only that
  // file (and the adapters that describe where the button is) may touch the adapters' submit selectors, and
  // submit.ts must check the opt-in flag and the preflight before any click.
  const SUBMIT_MODULE = path.join("lib", "apply", "submit.ts");
  const SELECTOR_OWNERS = new Set([SUBMIT_MODULE, path.join("lib", "apply", "platforms", "index.ts"), path.join("scripts", "assist-check.ts")]);
  for (const file of files) {
    const rel = path.relative(root, file);
    if (/submitSelectors/.test(readFileSync(file, "utf8")) && !SELECTOR_OWNERS.has(rel)) {
      offenders.push(`${rel} ~ uses submitSelectors outside ${SUBMIT_MODULE}`);
    }
  }
  const submitCode = readFileSync(path.join(root, SUBMIT_MODULE), "utf8");
  const firstClick = submitCode.indexOf(".click(");
  for (const gate of ["if (!submitEnabled(", "if (!preflightPasses(preflight))"]) {
    const at = submitCode.indexOf(gate);
    if (at === -1 || (firstClick !== -1 && at > firstClick)) offenders.push(`${SUBMIT_MODULE} ~ "${gate}" must come before any click`);
  }

  // The second audited path: pressing an employer portal's sign-in / create-account button (lib/apply/account.ts). It never
  // touches the application (no submitSelectors, no Submit), every click is inside press(), and press() refuses unless the
  // account is configured, before its first click.
  const ACCOUNT_MODULE = path.join("lib", "apply", "account.ts");
  const accountCode = readFileSync(path.join(root, ACCOUNT_MODULE), "utf8");
  const gateAt = accountCode.indexOf("account actions need PORTAL_CREATE_ACCOUNTS");
  const accountClick = accountCode.indexOf(".click(");
  if (gateAt === -1 || (accountClick !== -1 && gateAt > accountClick)) offenders.push(`${ACCOUNT_MODULE} ~ the account gate must come before any click`);
  const pressBody = accountCode.match(/async function press\([\s\S]*?\n}\n/)?.[0] ?? "";
  if ((accountCode.match(/\.click\(/g) ?? []).length !== (pressBody.match(/\.click\(/g) ?? []).length) offenders.push(`${ACCOUNT_MODULE} ~ every click must be inside press()`);
  if (/submitSelectors/.test(accountCode)) offenders.push(`${ACCOUNT_MODULE} ~ must not use the application's submitSelectors`);

  if (offenders.length) {
    console.error("Forbidden submit-click patterns found:");
    for (const o of offenders) console.error(`  ${o}`);
    process.exit(1);
  }
  console.log(`no submit-click patterns in ${files.length} source files`);
  console.log(`the only submit path (${SUBMIT_MODULE}) is gated by the submit permission (approval or PORTAL_SUBMIT=auto) and the preflight`);
  console.log(`the only account path (${ACCOUNT_MODULE}) clicks inside press(), gated by the configured account`);

  if (!looksLikeSubmit("Submit") || !looksLikeSubmit("Submit application")) {
    throw new Error("Submit labels should be blocked");
  }
  if (looksLikeSubmit("Apply")) {
    throw new Error("bare Apply opens the form and must remain allowed");
  }
  if (looksLikeSubmit("First name")) throw new Error("First name must not look like submit");
  console.log("submit label heuristics ok");

  const answers: Answer[] = [
    {
      id: "1",
      key: "full_name",
      category: "green",
      answer_en: "Ara Ghahramanyan",
      answer_fr: "Ara Ghahramanyan",
      updated_at: new Date(),
    },
    {
      id: "2",
      key: "email",
      category: "green",
      answer_en: "ara@example.com",
      answer_fr: "ara@example.com",
      updated_at: new Date(),
    },
    {
      id: "3",
      key: "why_this_company",
      category: "yellow",
      answer_en: "Rewrite me.",
      answer_fr: null,
      updated_at: new Date(),
    },
    {
      id: "4",
      key: "work_authorization",
      category: "red",
      answer_en: null,
      answer_fr: null,
      updated_at: new Date(),
    },
  ];

  const plans = planFields(
    ["First Name", "Email", "Why do you want to work at this company?", "Work authorization"],
    answers,
    { lang: "en", resumePath: null, coverLetterPath: null },
  );

  const byLabel = Object.fromEntries(plans.map((p) => [p.label, p]));
  if (byLabel["First Name"].action !== "fill-green" || byLabel["First Name"].value !== "Ara") {
    throw new Error("First Name should fill green first name");
  }
  if (byLabel["Email"].action !== "fill-green") throw new Error("Email should be green");
  if (byLabel["Why do you want to work at this company?"].action !== "fill-yellow") {
    throw new Error("why company should be yellow");
  }
  if (byLabel["Work authorization"].action !== "leave-empty-red") {
    throw new Error("work authorization must stay empty");
  }
  console.log("field planning ok (green / yellow / red)");
}

main();
