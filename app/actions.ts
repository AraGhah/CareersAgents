"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createCompany,
  createManualJob,
  setApplicationStatus,
  startApplication,
  updateApplicationFields,
} from "../lib/queries";
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
