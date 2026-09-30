// The full match report for a stored job, computed now against the CVs that are active now, so the page always shows
// the reasoning behind the number rather than a number alone.

import { loadActiveCv } from "../resumes";
import { scoreJob, type MatchReport } from "../score";
import type { JobDetail } from "../types";

export async function reportForJob(job: Pick<JobDetail, "title" | "location" | "workplace_type" | "description" | "company_city">): Promise<MatchReport> {
  await loadActiveCv();
  return scoreJob({
    title: job.title,
    location: job.location,
    workplaceType: job.workplace_type,
    description: job.description,
    companyCity: job.company_city,
  }).report;
}

/** "84,6" : one decimal, French decimal comma. */
export const fr1 = (n: number) => n.toFixed(1).replace(".", ",");

/** A short French summary of a report, for places with room for a few lines (the offers table). */
export function summaryFr(report: MatchReport): string[] {
  const lines = [
    `${fr1(report.percentPrecise)} % — ${report.criteria.map((c) => `${c.label.split(" ")[0].toLowerCase()} ${Math.round(c.score * 100)} %`).join(" · ")}`,
  ];
  if (report.gated) lines.push(`Écartée : ${report.gateReasons.join(" ; ")}.`);
  const have = report.skills.matched.slice(0, 6).map((s) => s.name);
  const near = report.skills.related.slice(0, 4).map((s) => `${s.name} (≈ ${s.via})`);
  const lack = report.skills.missing.slice(0, 6).map((s) => s.name);
  if (have.length) lines.push(`Dans ton CV : ${have.join(", ")}.`);
  if (near.length) lines.push(`Apparentées : ${near.join(", ")}.`);
  if (lack.length) lines.push(`Manquantes : ${lack.join(", ")}.`);
  if (!report.hasDescription) lines.push("Pas de description : score prudent, compétences neutres.");
  return lines;
}
