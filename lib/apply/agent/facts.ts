// What the AI form agent may put in a form: your details as the desk holds them (answer bank, CV, projects), the
// personal answers you confirmed for automatic use, and the answers you gave on earlier forms. Nothing else. Each
// fact is named, so every value the agent types can be traced back to one.

import type { CandidateProfile } from "../candidate";
import type { RememberedAnswer } from "../memory";
import { aboutCanada } from "../personal";

export type AgentJob = { companyName: string; title: string; location: string | null; description: string | null };

const line = (key: string, value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? null : `- ${key}: ${value}`);

/** The facts, as a list the model reads. */
export function factsFor(candidate: CandidateProfile, job: AgentJob, memory: Map<string, RememberedAnswer>, opts: { autoConfirm: boolean }): string {
  const c = candidate;
  const confirmed = (topic: "work_authorization" | "sponsorship" | "salary") => opts.autoConfirm || c.autoUse.has(topic);
  const workedHere = c.resumeText ? new RegExp(job.companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(c.resumeText) : null;
  const experience = c.experience.map((e) => `  - ${JSON.stringify(e)}`);
  const projects = c.projects.map((p) => `  - ${p.name}: ${p.summary}${p.tech.length ? ` (tech: ${p.tech.join(", ")})` : ""}${p.url ? ` ${p.url}` : ""}`);
  const greens = Object.entries(c.bank)
    .filter(([, v]) => v.category === "green")
    .map(([k, v]) => line(`answer bank "${k}"`, (c.lang === "fr" ? v.fr ?? v.en : v.en ?? v.fr) ?? null))
    .filter((l): l is string => !!l);
  const remembered = [...memory.values()].map((m) => `  - Q: "${m.question}" → A: "${m.value}"`);

  return [
    "IDENTITY AND CONTACT",
    line("full name", c.fullName),
    line("first name", c.firstName),
    line("last name", c.lastName),
    line("email", c.email),
    line("phone", c.phone),
    line("city", c.city),
    line("postal code", c.resumeText?.match(/\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i)?.slice(1, 3).join(" ").toUpperCase() ?? null),
    "- street address: not in the facts (ask_person if required; the answer is then remembered)",
    line("province/region", c.regionName ?? c.region),
    line("country", c.country),
    line("LinkedIn", c.links.linkedin),
    line("GitHub", c.links.github),
    line("portfolio", c.links.portfolio),
    "",
    "EDUCATION",
    line("school", c.education.school),
    line("program", c.education.program),
    line("credential", c.education.credential),
    line("start year", c.education.startYear),
    line("graduation", c.education.graduation),
    "",
    "AVAILABILITY AND LANGUAGES",
    line("available from", c.availableFrom),
    line("location rule", c.locationRule),
    line("languages", c.languagesText),
    "",
    "SKILLS",
    `- ${c.skills.join(", ")}`,
    "",
    "EXPERIENCE (from the CV, as written)",
    ...(experience.length ? experience : ["  - (none listed)"]),
    "",
    "PROJECTS",
    ...(projects.length ? projects : ["  - (none listed)"]),
    "",
    "ANSWER BANK (paste as written)",
    ...greens,
    "",
    "PERSONAL / LEGAL ANSWERS YOU MAY USE",
    confirmed("work_authorization") && c.personal.work_authorization
      ? `- work authorization (for Canada, or the country the candidate lives in, which is Canada): ${c.personal.work_authorization}`
      : "- work authorization: NOT confirmed for automatic use → ask_person if a required question asks it",
    confirmed("sponsorship") && c.personal.sponsorship
      ? `- needs visa sponsorship to work in Canada: ${c.personal.sponsorship}`
      : "- sponsorship: NOT confirmed for automatic use → ask_person if a required question asks it",
    confirmed("salary") && c.personal.salary ? `- salary expectation (text fields only): ${c.personal.salary}` : "- salary: NOT confirmed → ask_person if required",
    workedHere === false ? `- previously worked at ${job.companyName}: No (the company is nowhere in the CV)` : `- previously worked at ${job.companyName}: unknown → ask_person if required`,
    c.personal.criminal_record && /^\s*(no|aucun)/i.test(c.personal.criminal_record) ? `- criminal record: ${c.personal.criminal_record}` : null,
    "- self-identification (gender, ethnicity, disability, veteran, orientation...): never answer for the candidate. Optional → leave blank. Required → choose the option that declines to answer (\"I don't wish to answer\", \"Decline to self-identify\", \"Prefer not to say\"); if there is none, ask_person.",
    "",
    "ANSWERS THE CANDIDATE GAVE ON EARLIER FORMS (reuse when the same question is asked)",
    ...(remembered.length ? remembered : ["  - (none yet)"]),
    "",
    "THE JOB",
    line("company", job.companyName),
    line("role", job.title),
    line("location", job.location),
    job.location && !aboutCanada("", job.location) ? "- the job is outside Canada: legal answers above are about Canada only" : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}
