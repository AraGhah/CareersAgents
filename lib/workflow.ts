import { pool } from "./db";
import {
  fetchBoard,
  isInternshipTitle,
  isSoftwareRelevant,
  type BoardCompany,
  type NormalizedJob,
} from "./discover-core";
import { fetchIndeedJobs, fetchLinkedInJobs, type ExternalJob } from "./sources-external";
import filtersConfig from "../filters.json";
import { COMPONENT_NAMES, scoreJob, setHaveSkills, type ComponentName } from "./score";
import { getActiveSkills, resolveResumeForJob } from "./resumes";
import { listSourceCapabilities, type SourceCapability } from "./sources";
import {
  startApplication,
  setApplicationStatus,
  getApplication,
  upsertDiscoveredCompany,
} from "./queries";
import { researchCompanyForApplication } from "./research";
import { researchHiringContacts, pickBestContact, logWorkflow } from "./recruiter";
import { buildPersonalizedOutreach, createOutreachDraft, hasOpenOutreach } from "./outreach";
import { buildPackageFromDossier, loadApplicantContact, projectsForCategories } from "./package";
import { detectCategories } from "./category";
import { detectInternshipCategories } from "./internship-category";
import { detectLetterLang, parseLinks } from "./letter";
import type { ApplicationStatus } from "./types";

export type DiscoverySummary = {
  runId: string;
  inserted: number;
  updated: number;
  skipped: number;
  scored: number;
  qualified: number;
  prepared: number;
  sources: ReturnType<typeof listSourceCapabilities>;
  linkedin: string;
  indeed: string;
  boards: number;
  errors: string[];
};

async function upsertJob(
  companyId: string,
  job: NormalizedJob,
): Promise<"inserted" | "updated" | "skipped"> {
  if (!isInternshipTitle(job.title)) return "skipped";
  if (!isSoftwareRelevant(job.title, job.description)) return "skipped";

  const result = await pool.query<{ inserted: boolean }>(
    `INSERT INTO jobs (company_id, external_id, title, location, workplace_type, url, description, posted_at, source)
     SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::timestamptz, $9::text
      WHERE (
              $4 IS NULL
           OR $5 = 'remote'
           OR $4 ~* 'montr|laval|vaudreuil|saint-?laurent|st[ .\\-]?laurent|qu[eé]bec|quebec'
           OR (
                $4 ~* 'canada|remote|anywhere'
            AND $4 !~* 'toronto|vancouver|calgary|ottawa|mississauga|waterloo|edmonton|winnipeg'
              )
            )
     ON CONFLICT (company_id, external_id)
     DO UPDATE SET
          last_seen_at    = now(),
          title           = EXCLUDED.title,
          location        = EXCLUDED.location,
          workplace_type  = EXCLUDED.workplace_type,
          url             = EXCLUDED.url,
          description     = EXCLUDED.description,
          posted_at       = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
          source          = EXCLUDED.source,
          closed_at       = NULL
     RETURNING (xmax = 0) AS inserted`,
    [
      companyId,
      job.externalId,
      job.title,
      job.location,
      job.workplaceType,
      job.url,
      job.description,
      job.postedAt,
      job.source,
    ],
  );

  if (result.rowCount === 0) return "skipped";
  return result.rows[0].inserted ? "inserted" : "updated";
}

async function scoreAllOpenJobs(): Promise<number> {
  const skills = await getActiveSkills();
  setHaveSkills(skills);
  const scoredAt = new Date();
  const { rows } = await pool.query<{
    id: string;
    title: string;
    location: string | null;
    workplace_type: "onsite" | "hybrid" | "remote" | null;
    description: string | null;
    company_city: string | null;
  }>(
    `SELECT j.id, j.title, j.location, j.workplace_type, j.description, c.city AS company_city
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      WHERE j.closed_at IS NULL`,
  );

  for (const job of rows) {
    const result = scoreJob({
      title: job.title,
      location: job.location,
      workplaceType: job.workplace_type,
      description: job.description,
      companyCity: job.company_city,
    });
    for (const name of COMPONENT_NAMES) {
      await pool.query(
        `INSERT INTO job_scores (job_id, scored_at, component, raw_value, weight)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          job.id,
          scoredAt,
          name,
          result.components[name as ComponentName],
          result.weights[name as ComponentName],
        ],
      );
    }
  }
  return rows.length;
}

async function autoTrackAndQualify(minPercent = 70): Promise<{ qualified: number; newlyQualifiedIds: string[] }> {
  const { rows } = await pool.query<{
    job_id: string;
    application_id: string | null;
    score: string | null;
    gated: boolean | null;
  }>(
    `WITH latest AS (
       SELECT job_id, MAX(scored_at) AS scored_at FROM job_scores GROUP BY job_id
     ),
     totals AS (
       SELECT s.job_id,
              SUM(s.raw_value * s.weight) AS score,
              BOOL_OR(s.component = 'location' AND s.raw_value = 0)
                OR BOOL_OR(s.component = 'timing' AND s.raw_value = 0) AS gated
         FROM job_scores s
         JOIN latest l ON l.job_id = s.job_id AND l.scored_at = s.scored_at
        GROUP BY s.job_id
     )
     SELECT j.id AS job_id, a.id AS application_id, t.score, t.gated
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id
       LEFT JOIN totals t ON t.job_id = j.id
      WHERE j.closed_at IS NULL
        AND t.gated IS NOT TRUE
        AND t.score >= $1`,
    [minPercent / 100],
  );

  let qualified = 0;
  const newlyQualifiedIds: string[] = [];
  for (const row of rows) {
    let appId = row.application_id;
    if (!appId) {
      appId = await startApplication(row.job_id);
      await setApplicationStatus(appId, "discovered", "auto-track from Find Internships");
    }
    const app = await getApplication(appId);
    if (!app) continue;
    if (["discovered", "qualified"].includes(app.status) || app.status === ("draft" as ApplicationStatus)) {
      await setApplicationStatus(appId, "qualified", `match score ${(Number(row.score) * 100).toFixed(0)}`);
      qualified += 1;
      newlyQualifiedIds.push(appId);
    }
  }
  return { qualified, newlyQualifiedIds };
}

/**
 * Find Internships — real ATS/Ashby boards only.
 * LinkedIn/Indeed run only when authorized credentials exist (otherwise reported, not faked).
 */
export async function runFindInternships(opts: { fresh?: boolean } = {}): Promise<DiscoverySummary> {
  const sources = listSourceCapabilities();
  const { rows: runRows } = await pool.query<{ id: string }>(
    `INSERT INTO discovery_runs (sources_json) VALUES ($1::jsonb) RETURNING id`,
    [JSON.stringify(sources)],
  );
  const runId = runRows[0].id;
  const errors: string[] = [];

  const linkedin = sources.find((s) => s.id === "linkedin")!;
  const indeed = sources.find((s) => s.id === "indeed")!;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const { rows: companies } = await pool.query<BoardCompany>(
      `SELECT id, name, ats, board_token
         FROM companies
        WHERE board_token IS NOT NULL
          AND ats IN ('greenhouse', 'lever', 'workable', 'ashby')
        ORDER BY is_target DESC, name`,
    );

    for (const company of companies) {
      try {
        const jobs = await fetchBoard(company, { fresh: opts.fresh });
        for (const job of jobs) {
          const outcome = await upsertJob(company.id, job);
          if (outcome === "inserted") inserted += 1;
          else if (outcome === "updated") updated += 1;
          else skipped += 1;
        }
      } catch (err) {
        errors.push(`${company.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // LinkedIn + Indeed: only run with a user-configured Apify token + actor
    // each (see lib/sources-external.ts). No invented results either way.
    const externalSources: Array<{
      label: string;
      capability: SourceCapability;
      fetch: (opts: { fresh?: boolean }) => Promise<ExternalJob[]>;
    }> = [
      { label: "LinkedIn", capability: linkedin, fetch: fetchLinkedInJobs },
      { label: "Indeed", capability: indeed, fetch: fetchIndeedJobs },
    ];

    for (const ext of externalSources) {
      if (!ext.capability.available) {
        errors.push(`${ext.label} skipped — ${ext.capability.reason}`);
        continue;
      }
      try {
        const extJobs = await ext.fetch({ fresh: opts.fresh });
        for (const job of extJobs) {
          const companyId = await upsertDiscoveredCompany(job.companyName, null);
          const outcome = await upsertJob(companyId, job);
          if (outcome === "inserted") inserted += 1;
          else if (outcome === "updated") updated += 1;
          else skipped += 1;
        }
        errors.push(`${ext.label}: ${extJobs.length} matching posting(s) via configured Apify actor.`);
      } catch (err) {
        errors.push(`${ext.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const scored = await scoreAllOpenJobs();
    const { qualified, newlyQualifiedIds } = await autoTrackAndQualify(
      filtersConfig.autoTrackMinPercent,
    );

    // Auto-prepare: research the company, find a real published contact,
    // and draft (never send) a personalized email for every application
    // that just qualified — so by the time a person opens the app, only the
    // approve-and-send click is left.
    let prepared = 0;
    for (const applicationId of newlyQualifiedIds) {
      try {
        await prepareOutreachWorkflow(applicationId);
        prepared += 1;
      } catch (err) {
        errors.push(
          `Auto-prepare ${applicationId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await pool.query(
      `UPDATE discovery_runs
          SET finished_at = now(), inserted = $2, updated = $3, skipped = $4,
              scored = $5, qualified = $6, error = $7
        WHERE id = $1`,
      [
        runId,
        inserted,
        updated,
        skipped,
        scored,
        qualified,
        errors.length ? errors.join("\n") : null,
      ],
    );

    return {
      runId,
      inserted,
      updated,
      skipped,
      scored,
      qualified,
      prepared,
      sources,
      linkedin: linkedin.reason,
      indeed: indeed.reason,
      boards: companies.length,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE discovery_runs SET finished_at = now(), error = $2 WHERE id = $1`,
      [runId, message],
    );
    throw err;
  }
}

export type PrepareResult = {
  applicationId: string;
  status: ApplicationStatus;
  dossierId: string | null;
  contactId: string | null;
  contactEmail: string | null;
  outreachId: string | null;
  resumePath: string | null;
  subject: string | null;
  body: string | null;
  needsApproval: true;
  steps: string[];
};

/** Assisted Mode: research + recruiter + personalized email draft stored locally (not sent). */
export async function prepareOutreachWorkflow(applicationId: string): Promise<PrepareResult> {
  const steps: string[] = [];
  const app = await getApplication(applicationId);
  if (!app) throw new Error("application not found");

  await logWorkflow(applicationId, "match", true, `status=${app.status}`);
  steps.push("Matched against active CV profile");

  const lang = detectLetterLang(app.title, app.description);

  const dossier = await researchCompanyForApplication({
    app,
    companyId: app.company_id,
    force: false,
  });
  await logWorkflow(applicationId, "research_company", true, dossier.id);
  steps.push("Company dossier researched");

  // Every prepared application gets its own personalized cover letter built
  // right here — not only the ones a recruiter contact happens to be found
  // for below. Skips the live link-reachability check: this runs for every
  // newly qualified job in a single "Find Internships" batch, and a 10s HEAD
  // request per link, per application, would make that batch crawl.
  try {
    const built = await buildPackageFromDossier({ app, dossier, lang, checkLinks: false });
    if (built) {
      const passed = built.checklist.filter((c) => c.ok).length;
      steps.push(`Personalized cover letter built (${passed}/${built.checklist.length} checks passed)`);
      await logWorkflow(applicationId, "build_cover_letter", true, built.pdfPath);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push(`Cover letter build failed: ${message}`);
    await logWorkflow(applicationId, "build_cover_letter", false, message);
  }

  const hiring = await researchHiringContacts({
    companyId: app.company_id,
    companyName: app.company_name,
    website: app.company_website,
  });
  await logWorkflow(
    applicationId,
    "research_recruiter",
    true,
    `added=${hiring.added} contacts=${hiring.contacts.length}`,
  );
  steps.push(
    hiring.contacts.length
      ? `Hiring contacts found (${hiring.contacts.length})`
      : "No public email found — add a contact with source_url",
  );

  const contact = pickBestContact(hiring.contacts);
  const resume = await resolveResumeForJob(lang, detectInternshipCategories(app.title, app.description));
  const projects = await projectsForCategories(detectCategories(app.title, app.description));

  const applicant = await loadApplicantContact(lang);
  const { rows: linkRows } = await pool.query<{ answer_en: string | null; answer_fr: string | null }>(
    `SELECT answer_en, answer_fr FROM answers WHERE key = 'links'`,
  );
  const linksRaw =
    lang === "fr"
      ? linkRows[0]?.answer_fr ?? linkRows[0]?.answer_en
      : linkRows[0]?.answer_en ?? linkRows[0]?.answer_fr;
  const links = parseLinks(linksRaw ?? null);

  let outreachId: string | null = null;
  let subject: string | null = null;
  let body: string | null = null;

  if (contact?.email) {
    const crafted = buildPersonalizedOutreach({
      app,
      dossier,
      projects,
      fullName: applicant.fullName,
      availability: applicant.availability,
      email: applicant.email,
      phone: applicant.phone,
      city: applicant.city,
      links,
      recipientName: contact.name,
      lang,
      kind: "outreach",
    });
    subject = crafted.subject;
    body = crafted.body;

    const open = await hasOpenOutreach(applicationId, "outreach", contact.email);
    if (!open) {
      const draft = await createOutreachDraft({
        applicationId,
        contactId: contact.id,
        resumeId: resume?.id ?? null,
        dossierId: dossier.id,
        kind: "outreach",
        lang: crafted.lang,
        toEmail: contact.email,
        subject: crafted.subject,
        body: crafted.body,
        pushToGmail: false,
      });
      outreachId = draft.id;
      steps.push(`Personalized email prepared for ${contact.email} (awaiting your approval)`);
    } else {
      steps.push(`Open outreach already exists for ${contact.email} — skipped duplicate`);
    }
  } else {
    steps.push("Cannot generate email yet — no verified public contact email");
  }

  if (resume) {
    await pool.query(
      `UPDATE applications SET resume_path = $2, resume_id = $3 WHERE id = $1`,
      [applicationId, resume.storage_path, resume.id],
    );
    steps.push(`Attached CV (${resume.language.toUpperCase()}): ${resume.label}`);
  }

  if (["discovered", "qualified"].includes(app.status)) {
    await setApplicationStatus(applicationId, "ready", "assisted prepare complete");
  }

  await logWorkflow(applicationId, "prepare_email", Boolean(outreachId || subject), outreachId ?? undefined);

  return {
    applicationId,
    status: "ready",
    dossierId: dossier.id,
    contactId: contact?.id ?? null,
    contactEmail: contact?.email ?? null,
    outreachId,
    resumePath: resume?.storage_path ?? null,
    subject,
    body,
    needsApproval: true,
    steps,
  };
}
