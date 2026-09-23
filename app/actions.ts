"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addVerifiedContact,
  createCompany,
  createManualJob,
  getApplication,
  listContactsForCompany,
  setApplicationStatus,
  startApplication,
  updateApplicationFields,
} from "../lib/queries";
import { buildApplicationPackage, loadApplicantContact, projectsForCategories } from "../lib/package";
import { detectCategories } from "../lib/category";
import { detectLetterLang, parseLinks } from "../lib/letter";
import { pool } from "../lib/db";
import { createOutreachDraft, buildPersonalizedOutreach } from "../lib/outreach";
import { researchCompanyForApplication } from "../lib/research";
import {
  reanalyzeResume,
  replaceResume,
  resolveResumeForJob,
  setActiveResume,
  storeResumeUpload,
} from "../lib/resumes";
import type { ResumeLanguage } from "../lib/profile";
import {
  APPLICATION_STATUSES,
  WORKPLACE_TYPES,
  type ApplicationStatus,
  type WorkplaceType,
} from "../lib/types";

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function required(form: FormData, key: string): string {
  const value = text(form, key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function asLanguage(raw: string | null): ResumeLanguage {
  if (raw === "fr" || raw === "en") return raw;
  throw new Error("language must be en or fr");
}

export async function trackJob(form: FormData) {
  const jobId = required(form, "jobId");
  const applicationId = await startApplication(jobId);
  revalidatePath("/");
  redirect(`/applications/${applicationId}`);
}

export async function addManualJob(form: FormData) {
  const newCompany = text(form, "newCompany");
  const companyId = newCompany
    ? await createCompany(newCompany, text(form, "newCompanyCity"))
    : required(form, "companyId");

  const workplace = text(form, "workplaceType");
  const workplaceType =
    workplace && (WORKPLACE_TYPES as readonly string[]).includes(workplace)
      ? (workplace as WorkplaceType)
      : null;

  const jobId = await createManualJob({
    companyId,
    title: required(form, "title"),
    location: text(form, "location"),
    workplaceType,
    url: required(form, "url"),
    description: text(form, "description"),
    postedAt: text(form, "postedAt"),
  });

  revalidatePath("/");

  if (form.get("track") === "on") {
    const applicationId = await startApplication(jobId);
    redirect(`/applications/${applicationId}`);
  }

  redirect("/");
}

export async function changeStatus(form: FormData) {
  const id = required(form, "applicationId");
  const status = required(form, "status");
  if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`unknown status: ${status}`);
  }

  await setApplicationStatus(id, status as ApplicationStatus);
  revalidatePath(`/applications/${id}`);
  revalidatePath("/board");
  revalidatePath("/followups");
  revalidatePath("/");
}

export async function saveApplication(form: FormData) {
  const id = required(form, "applicationId");
  await updateApplicationFields(id, {
    notes: text(form, "notes"),
    resumePath: text(form, "resumePath"),
    coverLetterPath: text(form, "coverLetterPath"),
  });
  revalidatePath(`/applications/${id}`);
}

export async function buildPackage(form: FormData) {
  const id = required(form, "applicationId");
  const companyFact = required(form, "companyFact");
  const companyFactSource = required(form, "companyFactSource");
  const langRaw = text(form, "lang");
  const lang = langRaw === "fr" || langRaw === "en" ? langRaw : undefined;

  const app = await getApplication(id);
  if (!app) throw new Error("application not found");

  const result = await buildApplicationPackage({
    app,
    companyFact,
    companyFactSource,
    lang,
  });

  await updateApplicationFields(id, {
    notes: app.notes,
    resumePath: result.resumePath ?? app.resume_path,
    coverLetterPath: result.pdfPath,
    resumeId: result.resumeId,
  });

  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${id}?built=1`);
}

export async function uploadResumeAction(form: FormData) {
  const language = asLanguage(required(form, "language"));
  const label = text(form, "label") ?? undefined;
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("file is required");
  if (file.size === 0) throw new Error("file is empty");

  const buffer = Buffer.from(await file.arrayBuffer());
  const resume = await storeResumeUpload({
    buffer,
    filename: file.name || `resume-${language}.pdf`,
    language,
    label,
    mimeType: file.type || "application/pdf",
    activate: form.get("activate") === "on",
  });

  revalidatePath("/resumes");
  revalidatePath("/");
  redirect(`/resumes?ok=uploaded&id=${resume.id}`);
}

export async function activateResumeAction(form: FormData) {
  const id = required(form, "resumeId");
  await setActiveResume(id);
  revalidatePath("/resumes");
  revalidatePath("/");
  redirect("/resumes?ok=activated");
}

export async function reanalyzeResumeAction(form: FormData) {
  const id = required(form, "resumeId");
  await reanalyzeResume(id);
  revalidatePath("/resumes");
  redirect("/resumes?ok=analyzed");
}

export async function replaceResumeAction(form: FormData) {
  const id = required(form, "resumeId");
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("file is required");
  const buffer = Buffer.from(await file.arrayBuffer());
  await replaceResume({
    id,
    buffer,
    filename: file.name || "resume.pdf",
    mimeType: file.type || "application/pdf",
  });
  revalidatePath("/resumes");
  redirect("/resumes?ok=replaced");
}

export async function researchApplicationAction(form: FormData) {
  const id = required(form, "applicationId");
  const force = form.get("force") === "1";
  const app = await getApplication(id);
  if (!app) throw new Error("application not found");

  await researchCompanyForApplication({
    app,
    companyId: app.company_id,
    force,
  });

  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${id}?researched=1`);
}

export async function draftOutreachAction(form: FormData) {
  const id = required(form, "applicationId");
  const contactId = required(form, "contactId");
  const kindRaw = text(form, "kind") ?? "outreach";
  const kind =
    kindRaw === "application" || kindRaw === "cover" || kindRaw === "followup" || kindRaw === "outreach"
      ? kindRaw
      : "outreach";

  const app = await getApplication(id);
  if (!app) throw new Error("application not found");

  const contacts = await listContactsForCompany(app.company_id);
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact?.email) throw new Error("Contact has no email");
  if (!contact.source_url?.trim()) {
    throw new Error("Contact is missing source_url — refusing outreach to unverified addresses");
  }

  let dossier = null;
  try {
    dossier = await researchCompanyForApplication({
      app,
      companyId: app.company_id,
      force: false,
    });
  } catch (err) {
    console.error("[outreach] research failed, continuing with package fact only:", err);
  }

  const lang = detectLetterLang(app.title, app.description);
  const resume = await resolveResumeForJob(lang);
  const categories = detectCategories(app.title, app.description);
  const projects = await projectsForCategories(categories);

  const applicant = await loadApplicantContact(lang);
  const { rows: linkRows } = await pool.query<{ answer_en: string | null; answer_fr: string | null }>(
    `SELECT answer_en, answer_fr FROM answers WHERE key = 'links'`,
  );
  const linksRaw =
    lang === "fr"
      ? linkRows[0]?.answer_fr ?? linkRows[0]?.answer_en
      : linkRows[0]?.answer_en ?? linkRows[0]?.answer_fr;
  const links = parseLinks(linksRaw ?? null);

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
    kind,
  });

  const dry = form.get("dry") === "1";
  const draft = await createOutreachDraft({
    applicationId: id,
    contactId: contact.id,
    resumeId: resume?.id ?? null,
    dossierId: dossier?.id ?? null,
    kind,
    lang: crafted.lang,
    toEmail: contact.email,
    subject: crafted.subject,
    body: crafted.body,
    pushToGmail: !dry,
  });

  if (resume) {
    await updateApplicationFields(id, {
      notes: app.notes,
      resumePath: resume.storage_path,
      coverLetterPath: app.cover_letter_path,
      resumeId: resume.id,
    });
  }

  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${id}?drafted=${draft.id}`);
}

export async function addContactAction(form: FormData) {
  const applicationId = required(form, "applicationId");
  const app = await getApplication(applicationId);
  if (!app) throw new Error("application not found");

  await addVerifiedContact({
    companyId: app.company_id,
    name: text(form, "name"),
    role: text(form, "role"),
    email: required(form, "email"),
    sourceUrl: required(form, "sourceUrl"),
  });

  revalidatePath(`/applications/${applicationId}`);
  redirect(`/applications/${applicationId}?contact=1`);
}

export async function findInternshipsAction() {
  const { runFindInternships } = await import("../lib/workflow");
  const summary = await runFindInternships({ fresh: false });
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/board");
  redirect(
    `/pipeline?found=1&new=${summary.inserted}&qualified=${summary.qualified}&boards=${summary.boards}&prepared=${summary.prepared}`,
  );
}

export async function prepareWorkflowAction(form: FormData) {
  const id = required(form, "applicationId");
  const { prepareOutreachWorkflow } = await import("../lib/workflow");
  const result = await prepareOutreachWorkflow(id);
  revalidatePath(`/applications/${id}`);
  revalidatePath("/pipeline");
  redirect(
    `/applications/${id}?prepared=1${result.outreachId ? `&outreach=${result.outreachId}` : ""}`,
  );
}

export async function approveOutreachAction(form: FormData) {
  const outreachId = required(form, "outreachId");
  const applicationId = required(form, "applicationId");
  const allowSend = form.get("send") === "1";
  const { approveOutreachDraft } = await import("../lib/outreach");
  const result = await approveOutreachDraft({ outreachId, allowSend });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/pipeline");
  revalidatePath("/followups");
  const errorParam = result.gmailError ? `&gmailError=${encodeURIComponent(result.gmailError)}` : "";
  redirect(`/applications/${applicationId}?approved=${result.mode}${errorParam}`);
}

export async function markAppliedAction(form: FormData) {
  const id = required(form, "applicationId");
  await setApplicationStatus(id, "applied", "marked applied after Gmail send");
  revalidatePath(`/applications/${id}`);
  revalidatePath("/pipeline");
  revalidatePath("/followups");
  redirect(`/applications/${id}?applied=1`);
}
