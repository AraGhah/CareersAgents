// Guards for the browser assist: no Submit clicks in the repo, field planning works.
//   npx tsx scripts/assist-check.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
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

  if (offenders.length) {
    console.error("Forbidden submit-click patterns found:");
    for (const o of offenders) console.error(`  ${o}`);
    process.exit(1);
  }
  console.log(`no submit-click patterns in ${files.length} source files`);

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
