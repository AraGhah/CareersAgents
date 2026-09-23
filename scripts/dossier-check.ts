// End-to-end checks for resume profile + matching + research + outreach (no Gmail send).
//   npx tsx scripts/dossier-check.ts

import { analyzeResumeText } from "../lib/resume-parse";
import { scoreJob, setHaveSkills } from "../lib/score";
import { buildPersonalizedOutreach } from "../lib/outreach";
import type { ApplicationDetail } from "../lib/types";
import type { CompanyDossier } from "../lib/research";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const sampleText = `
Ara Ghahramanyan
Montréal, Québec · ara@example.com · 514-555-0100

Summary
Full-stack developer intern building TypeScript React Next.js Node.js PostgreSQL systems.

Education
Vanier College
Computer Science Technology
2023-2026

Experience
Software Developer Intern
Acme
2025-Present
- Built REST APIs with Express and JWT
- Shipped React dashboards on Cloudflare

Projects
Dossier
Research pipeline with Apify n8n Supabase AWS
Trade Catch
Twilio Stripe MongoDB
`;

  const profile = analyzeResumeText(sampleText, "en");
  assert(profile.skills.includes("TypeScript"), "expected TypeScript in skills");
  assert(profile.skills.includes("React"), "expected React in skills");
  assert(profile.email === "ara@example.com", "email parse failed");
  console.log(`profile ok · ${profile.skills.length} skills · years≈${profile.estimatedYearsExperience}`);

  setHaveSkills(profile.skills);
  const good = scoreJob({
    title: "Full-Stack Developer Intern",
    location: "Montréal",
    workplaceType: "hybrid",
    companyCity: "Montréal",
    description: "TypeScript React Next.js PostgreSQL. Winter 2027 internship.",
  });
  const bad = scoreJob({
    title: "Senior Staff Principal Director of Machine Learning",
    location: "San Francisco",
    workplaceType: "onsite",
    companyCity: "San Francisco",
    description: "10+ years experience. PhD required. Rust kernel work. Summer 2025.",
  });
  assert(good.percent >= 70, `expected strong match, got ${good.percent}`);
  assert(bad.gated || bad.percent < good.percent, "unrelated senior US role should rank worse / skip");
  console.log(`match ok · good ${good.percent} vs bad ${bad.percent} gated=${bad.gated}`);

  const app: ApplicationDetail = {
    id: "00000000-0000-0000-0000-000000000001",
    status: "discovered",
    submitted_at: null,
    resume_path: null,
    cover_letter_path: null,
    resume_id: null,
    notes: null,
    job_id: "00000000-0000-0000-0000-000000000002",
    title: "Software Developer Intern",
    location: "Montréal",
    workplace_type: "hybrid",
    url: "https://example.com/jobs/1",
    description: "TypeScript React internship Winter 2027",
    posted_at: null,
    closed_at: null,
    company_id: "00000000-0000-0000-0000-000000000003",
    company_name: "Example Co",
    company_website: "https://example.com",
    company_city: "Montréal",
  };

  const dossier: CompanyDossier = {
    id: "00000000-0000-0000-0000-000000000004",
    company_id: app.company_id,
    application_id: app.id,
    researched_at: new Date(),
    summary: "Example Co builds developer tools in Montréal.",
    company_fact: "Example Co ships developer tooling used by Québec startups.",
    company_fact_source: "https://example.com/about",
    signals: [
      {
        signal: "Hiring a Software Developer Intern for Winter 2027",
        source: "job posting",
        date: null,
      },
    ],
    contact_targets: [],
    sources: ["https://example.com"],
    confidence: 0.7,
    model: "heuristic",
  };

  const mail = buildPersonalizedOutreach({
    app,
    dossier,
    projects: [
      {
        id: "p1",
        name: "Dossier",
        summary: "Research pipeline",
        tech: ["TypeScript", "PostgreSQL"],
        url: null,
        highlight_for: ["fullstack"],
      },
    ],
    fullName: "Ara Ghahramanyan",
    availability: "January 2027",
    lang: "en",
    kind: "outreach",
  });
  assert(mail.body.includes("Example Co"), "outreach should mention company");
  assert(mail.body.includes("Dossier") || mail.body.includes("TypeScript"), "outreach should use profile/project");
  assert(mail.wordCount <= 260, `outreach too long: ${mail.wordCount}`);
  console.log(`outreach ok · ${mail.wordCount} words · ${mail.subject}`);

  console.log("dossier-check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
