// Import Full-Stack EN/FR resumes into the desk, analyze, and activate.
//   npx tsx scripts/import-resumes.ts
//   npx tsx scripts/import-resumes.ts --en "C:\\path\\CV_EN.pdf" --fr "C:\\path\\CV_FR.pdf"

import path from "node:path";
import { pool } from "../lib/db";
import { importResumeFromDisk, listResumes } from "../lib/resumes";

const DEFAULT_EN =
  "C:\\Users\\aragh\\OneDrive\\Desktop\\Stages\\CV\\FullStack CV\\CV_Ara_Ghahramanyan_EN.pdf";
const DEFAULT_FR =
  "C:\\Users\\aragh\\OneDrive\\Desktop\\Stages\\CV\\FullStack CV\\CV_Ara_Ghahramanyan_FR.pdf";

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (hit) return hit.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

async function main() {
  const enPath = argValue("--en") ?? DEFAULT_EN;
  const frPath = argValue("--fr") ?? DEFAULT_FR;

  console.log("Importing EN:", enPath);
  const en = await importResumeFromDisk({
    sourcePath: enPath,
    language: "en",
    label: "Full-Stack EN",
    activate: true,
  });
  console.log(
    `  → ${en.id} active=${en.is_active} skills=${en.profile_json?.skills?.length ?? 0} error=${en.analysis_error ?? "none"}`,
  );

  console.log("Importing FR:", frPath);
  const fr = await importResumeFromDisk({
    sourcePath: frPath,
    language: "fr",
    label: "Full-Stack FR",
    activate: true,
  });
  console.log(
    `  → ${fr.id} active=${fr.is_active} skills=${fr.profile_json?.skills?.length ?? 0} error=${fr.analysis_error ?? "none"}`,
  );

  const all = await listResumes();
  console.log(`\n${all.length} resume(s) in DB. Storage under ${path.resolve("resumes")}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
