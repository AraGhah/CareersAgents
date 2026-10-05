import path from "node:path";

/** GodsScion/Auto_job_applier_linkedIn, cloned by `npm run linkedin:setup` (gitignored). */
export const BOT_DIR = path.join(process.cwd(), "tools", "linkedin-bot");

/** The bot's own history of submitted applications; it skips every Job ID listed here. */
export const APPLIED_CSV = path.join(BOT_DIR, "all excels", "all_applied_applications_history.csv");

export const APPLIED_HEADER = [
  "Job ID", "Title", "Company", "Work Location", "Work Style", "About Job", "Experience required", "Skills required",
  "HR Name", "HR Link", "Resume", "Re-posted", "Date Posted", "Date Applied", "Job Link", "External Job link",
  "Questions Found", "Connect Request",
];

/** "External Job link" value of the rows the desk adds, so they are never read back as Easy Apply submissions. */
export const DESK_MARK = "Applied via Internship Desk";
