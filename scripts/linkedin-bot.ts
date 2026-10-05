// LinkedIn Easy Apply through GodsScion/Auto_job_applier_linkedIn (tools/linkedin-bot, not part of this repo).
//   npm run linkedin:setup            clone the bot (or pull it) and install its Python packages in tools/linkedin-bot/.venv
//   npm run linkedin -- --dry         fill every form up to Review, then discard it. Submits nothing.
//   npm run linkedin                  apply; the bot pauses before each Submit so you can check it
//   npm run linkedin -- --no-pause    apply without the pause before Submit
//   npm run linkedin -- --config-only write tools/linkedin-bot/user_config.json and stop
//   npm run linkedin -- --login       only sign in to LinkedIn in the bot's Chrome profile
//
// The bot's settings come from the desk: name, phone, links, work authorization and sponsorship from the answer
// bank, the CV from the active English resume, the summary from its analysis. It runs in a visible Chrome window
// with its own profile (C:\temp\auto-job-apply-profile), so you sign in to LinkedIn there once and it stays signed in.
// This uses your LinkedIn account, which LinkedIn's terms forbid for bots: keep the volume low.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { APPLIED_CSV, APPLIED_HEADER, BOT_DIR, DESK_MARK } from "../lib/linkedin-bot";

const ROOT = process.cwd();
const BOT_REPO = "https://github.com/GodsScion/Auto_job_applier_linkedIn.git";
const PYTHON = path.join(BOT_DIR, ".venv", "Scripts", "python.exe");

const args = process.argv.slice(2);
const SETUP = args.includes("--setup");
const DRY = args.includes("--dry");
const NO_PAUSE = args.includes("--no-pause");
const CONFIG_ONLY = args.includes("--config-only");
const LOGIN_ONLY = args.includes("--login");

/** Fixes to the bot's own code, re-applied on every run (setup drops them before pulling, then re-applies). */
const PATCHES = [
  {
    file: "runAiBot.py",
    why: "the filters-failed dialog passed its buttons as the title, so it crashed instead of letting you fix the filters",
    from: `ERROR: {e}", ["Doesn't look good, but Continue XD", "Look's good, Continue"])`,
    to: `ERROR: {e}", "Filters", ["Doesn't look good, but Continue XD", "Look's good, Continue"])`,
  },
];

const DEFAULT_SEARCH_TERMS = [
  "Software Developer Intern",
  "Software Engineering Intern",
  "Full Stack Developer Intern",
  "Backend Developer Intern",
  "Stagiaire développeur logiciel",
  "Stage développement logiciel",
];

function run(cmd: string, cmdArgs: string[], cwd = ROOT) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
}

function applyPatches() {
  for (const patch of PATCHES) {
    const file = path.join(BOT_DIR, patch.file);
    const source = fs.readFileSync(file, "utf8");
    if (source.includes(patch.to)) continue;
    if (!source.includes(patch.from)) {
      console.warn(`Patch not applied to ${patch.file} (the bot's code changed): ${patch.why}`);
      continue;
    }
    fs.writeFileSync(file, source.replace(patch.from, patch.to), "utf8");
  }
}

function setup() {
  if (fs.existsSync(path.join(BOT_DIR, ".git"))) {
    run("git", ["checkout", "--", ...new Set(PATCHES.map((p) => p.file))], BOT_DIR);
    run("git", ["pull", "--ff-only"], BOT_DIR);
  } else {
    run("git", ["clone", BOT_REPO, BOT_DIR]);
  }
  applyPatches();
  if (!fs.existsSync(PYTHON)) run("py", ["-3", "-m", "venv", ".venv"], BOT_DIR);
  run(PYTHON, ["-m", "pip", "install", "--upgrade", "pip"], BOT_DIR);
  run(PYTHON, ["-m", "pip", "install", "-r", "requirements.txt"], BOT_DIR);
}

const RUN_LOCK = path.join(BOT_DIR, ".desk-run.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** One run at a time: two runs on the same Chrome profile close each other's window or fail to start. */
function takeRunLock() {
  if (fs.existsSync(RUN_LOCK)) {
    const pid = Number.parseInt(fs.readFileSync(RUN_LOCK, "utf8"), 10);
    if (pid && pid !== process.pid && alive(pid)) {
      throw new Error(`Another LinkedIn run is already going (process ${pid}). Let it finish, or close it, first.`);
    }
  }
  fs.writeFileSync(RUN_LOCK, String(process.pid), "utf8");
  const release = () => {
    try {
      if (fs.readFileSync(RUN_LOCK, "utf8") === String(process.pid)) fs.rmSync(RUN_LOCK);
    } catch {
      // already gone
    }
  };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(130));
}

/** Waits until no Chrome still has the bot's profile open; the next session cannot start on it until then. */
function waitForProfileFree(timeoutMs = 30_000) {
  const query =
    "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'auto-job-apply-profile' } | Measure-Object).Count";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = execFileSync("powershell", ["-NoProfile", "-Command", query], { encoding: "utf8" }).trim();
    if (count === "0") return;
    execFileSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Seconds 1"]);
  }
  throw new Error("Chrome still has the bot's profile open (C:\\temp\\auto-job-apply-profile). Close that window and run again.");
}

/** Opens the bot's Chrome profile and returns once LinkedIn is signed in there (at once if it already is). */
function signIn() {
  execFileSync(PYTHON, [path.join(ROOT, "scripts", "linkedin-login.py")], {
    cwd: BOT_DIR,
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: BOT_DIR, PYTHONIOENCODING: "utf-8" },
  });
}

function list(env: string | undefined, fallback: string[]): string[] {
  const items = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function linkFrom(links: string, host: RegExp): string {
  return links.split(/\s+/).find((token) => /^https?:\/\//i.test(token) && host.test(token)) ?? "";
}

async function buildConfig() {
  const { pool } = await import("../lib/db");
  const { rows: answerRows } = await pool.query<{ key: string; answer_en: string | null }>(
    `SELECT key, answer_en FROM answers`,
  );
  const bank = new Map(answerRows.map((r) => [r.key, (r.answer_en ?? "").trim()]));
  // The English CV for software roles, else the general English one.
  const { rows: resumeRows } = await pool.query<{
    storage_path: string;
    profile_json: import("../lib/profile").ResumeProfile | null;
  }>(
    `SELECT storage_path, profile_json FROM resumes
      WHERE is_active AND language = 'en' AND (category = 'software-developer' OR category IS NULL)
      ORDER BY (category IS NULL), uploaded_at DESC
      LIMIT 1`,
  );

  const resume = resumeRows[0];
  if (!resume) throw new Error("No active English CV. Import one first (npm run resumes:import).");
  const resumePath = path.resolve(ROOT, resume.storage_path.replace(/\\/g, "/"));
  if (!fs.existsSync(resumePath)) throw new Error(`The active English CV is missing on disk: ${resumePath}`);
  const profile = resume.profile_json;

  const missing = ["full_name", "phone", "email"].filter((k) => !bank.get(k));
  if (missing.length) throw new Error(`Answer bank entries missing: ${missing.join(", ")}`);

  const salary = Number.parseInt(process.env.LINKEDIN_DESIRED_SALARY ?? "", 10);
  if (!DRY && !CONFIG_ONLY && !(salary > 0)) {
    throw new Error(
      "Set LINKEDIN_DESIRED_SALARY in .env.local (a yearly number in CAD, e.g. 45000). The bot types it into every\n" +
        "salary question, and the answer bank's \"Negotiable\" does not fit a number field.",
    );
  }

  const [firstName, ...rest] = bank.get("full_name")!.split(/\s+/);
  const city = (bank.get("city") ?? "Montréal, QC").split(",")[0].trim();
  const postal = profile?.location?.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i)?.[0] ?? "";
  const links = bank.get("links") ?? "";
  const authorized = /citizen|permanent resident/i.test(bank.get("work_authorization") ?? "");
  const latestJob = profile?.experience?.[0]?.organization ?? "";
  const summary = profile?.summary ?? "";

  // Facts only, for the bot's AI (off unless you turn it on in user_config.json).
  const facts = [
    `Name: ${bank.get("full_name")}`,
    `Email: ${bank.get("email")}`,
    `Phone: ${bank.get("phone")}`,
    `City: ${bank.get("city")}`,
    `Education: ${bank.get("school_program")}`,
    `Graduation: ${bank.get("graduation_date")}`,
    `Available from: ${bank.get("available_from")}`,
    `Languages: ${bank.get("languages")}`,
    `Work authorization: ${bank.get("work_authorization")}. Sponsorship required: ${bank.get("sponsorship_required")}.`,
    `Location preference: ${bank.get("location_rule")}`,
    `Links: ${links}`,
    profile?.skills?.length ? `Skills: ${profile.skills.join(", ")}` : "",
    summary ? `Summary: ${summary}` : "",
    bank.get("biggest_project") ? `Main project: ${bank.get("biggest_project")}` : "",
  ].filter(Boolean);

  return {
    personals: {
      first_name: firstName,
      middle_name: "",
      last_name: rest.join(" "),
      phone_number: bank.get("phone")!.replace(/\D/g, ""),
      current_city: city,
      street: "",
      state: "Quebec",
      zipcode: postal.toUpperCase(),
      country: "Canada",
      // US self-identification questions: left to "Decline", as the desk leaves optional self-identification blank.
      ethnicity: "Decline",
      gender: "Decline",
      disability_status: "Decline",
      veteran_status: "Decline",
    },
    questions: {
      default_resume_path: resumePath,
      years_of_experience: "0",
      require_visa: /^no/i.test(bank.get("sponsorship_required") ?? "") ? "No" : "Yes",
      website: linkFrom(links, /vercel\.app|portfolio/i) || linkFrom(links, /github\.com/i),
      linkedIn: linkFrom(links, /linkedin\.com/i),
      legally_authorized: authorized ? "Yes" : "No",
      us_citizenship: authorized ? "Canadian Citizen/Permanent Resident" : "Other",
      desired_salary: salary > 0 ? salary : 0,
      current_ctc: 0,
      notice_period: 0,
      linkedin_headline: "Computer Science Technology student (DEC), backend and full-stack",
      linkedin_summary: summary,
      // The desk writes a letter per posting; a generic one is not sent. A form that requires one stops for you.
      cover_letter: "",
      user_information_all: facts.join("\n"),
      recent_employer: latestJob,
      confidence_level: process.env.LINKEDIN_CONFIDENCE_LEVEL ?? "6",
      pause_before_submit: !NO_PAUSE,
      // Never false: the bot then answers an unknown required question at random.
      pause_at_failed_question: true,
      overwrite_previous_answers: false,
    },
    search: {
      search_terms: list(process.env.LINKEDIN_SEARCH_TERMS, DEFAULT_SEARCH_TERMS),
      search_location: process.env.LINKEDIN_SEARCH_LOCATION ?? "Montreal, Quebec, Canada",
      switch_number: Number.parseInt(process.env.LINKEDIN_PER_SEARCH ?? "", 10) || 15,
      randomize_search_order: false,
      sort_by: "Most recent",
      date_posted: "Past month",
      salary: "",
      easy_apply_only: true,
      experience_level: ["Internship"],
      job_type: [],
      on_site: [],
      pause_after_filters: false,
      about_company_bad_words: ["Crossover"],
      // Matched against the whole description, so only phrases that rule a posting out by themselves.
      bad_words: ["PhD student", "doctoral", "doctorat", "currently enrolled in a PhD", "penetration testing", "SOC analyst"],
      security_clearance: false,
      did_masters: false,
      // -1 turns off "N years required" skipping: internship postings list years of a tool, not of employment.
      current_experience: -1,
    },
    secrets: {
      // Empty: you sign in yourself in the bot's Chrome window. Set both in .env.local to have it type them.
      ...(process.env.LINKEDIN_EMAIL && process.env.LINKEDIN_PASSWORD
        ? { username: process.env.LINKEDIN_EMAIL, password: process.env.LINKEDIN_PASSWORD }
        : {}),
      use_AI: false,
    },
    settings: {
      stop_before_submit: DRY,
      run_in_background: false,
      run_non_stop: false,
      follow_companies: false,
      close_tabs: true,
      safe_mode: true,
      click_gap: 1,
      keep_screen_awake: true,
    },
  };
}

/** Adds the LinkedIn postings the desk already applied to (any channel) to the bot's history, so it skips them. */
async function shareDeskApplied() {
  const { pool } = await import("../lib/db");
  const { rows } = await pool.query<{ external_id: string; title: string; company: string; url: string }>(
    `SELECT j.external_id, j.title, c.name AS company, j.url
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
      WHERE j.external_id LIKE 'linkedin-%'
        AND a.status IN ('applied', 'followup', 'interview', 'accepted', 'rejected', 'withdrawn')`,
  );

  const { readCsv, writeCsvRow } = await import("../lib/csv");
  const known = new Set(fs.existsSync(APPLIED_CSV) ? readCsv(fs.readFileSync(APPLIED_CSV, "utf8")).map((r) => r["Job ID"]) : []);
  fs.mkdirSync(path.dirname(APPLIED_CSV), { recursive: true });
  let out = fs.existsSync(APPLIED_CSV) && fs.statSync(APPLIED_CSV).size > 0 ? "" : writeCsvRow(APPLIED_HEADER);
  let added = 0;
  for (const row of rows) {
    const id = row.external_id.slice("linkedin-".length);
    if (known.has(id)) continue;
    const record: Record<string, string> = Object.fromEntries(APPLIED_HEADER.map((h) => [h, ""]));
    Object.assign(record, { "Job ID": id, Title: row.title, Company: row.company, "Job Link": row.url, "External Job link": DESK_MARK });
    out += writeCsvRow(APPLIED_HEADER.map((h) => record[h]));
    added++;
  }
  if (out) fs.appendFileSync(APPLIED_CSV, out, "utf8");
  if (added) console.log(`${added} posting(s) already applied to from the desk will be skipped by the bot.`);
}

async function main() {
  if (SETUP) return setup();
  if (!fs.existsSync(PYTHON)) throw new Error("The bot is not installed. Run: npm run linkedin:setup");
  // undetected_chromedriver needs real Chrome; without it the bot dies with "Binary Location Must be a String".
  const chromePaths = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((dir) => path.join(dir!, "Google", "Chrome", "Application", "chrome.exe"));
  if (!chromePaths.some((p) => fs.existsSync(p))) {
    throw new Error("Google Chrome is not installed. Install it (winget install Google.Chrome) and run again.");
  }
  applyPatches();
  takeRunLock();
  waitForProfileFree();

  const { pool } = await import("../lib/db");
  try {
    const config = await buildConfig();
    fs.writeFileSync(path.join(BOT_DIR, "user_config.json"), JSON.stringify(config, null, 2), "utf8");
    console.log(`Wrote tools/linkedin-bot/user_config.json (CV: ${path.basename(config.questions.default_resume_path)})`);
    if (CONFIG_ONLY) return;
    if (!LOGIN_ONLY) await shareDeskApplied();
  } finally {
    await pool.end();
  }

  signIn();
  if (LOGIN_ONLY) return;
  waitForProfileFree();
  console.log(
    DRY
      ? "Dry run: each form is filled up to Review and then discarded. Nothing is submitted."
      : NO_PAUSE
        ? "Applying without a pause before Submit."
        : "Applying. The bot pauses before each Submit: choose Submit, Discard or Disable Pause.",
  );
  console.log("Afterwards: npm run linkedin:import");

  const child = spawn(PYTHON, ["runAiBot.py"], { cwd: BOT_DIR, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
