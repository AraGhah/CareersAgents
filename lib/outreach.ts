import { pool } from "./db";
import { createDraft } from "./gmail";
import type { GmailAttachment } from "./gmail";
import { detectLetterLang, fillOutreachEmail, type LetterLang } from "./letter";
import type { CompanyDossier } from "./research";
import type { ApplicationDetail, Project } from "./types";

export type OutreachKind = "outreach" | "application" | "cover" | "followup";

export type OutreachDraftRow = {
  id: string;
  application_id: string;
  contact_id: string | null;
  resume_id: string | null;
  dossier_id: string | null;
  kind: OutreachKind;
  lang: LetterLang;
  to_email: string;
  subject: string;
  body: string;
  gmail_draft_id: string | null;
  created_at: Date;
  sent_detected_at: Date | null;
  sent_at?: Date | null;
  approved_at?: Date | null;
};

export async function listOutreachForApplication(applicationId: string): Promise<OutreachDraftRow[]> {
  const { rows } = await pool.query<OutreachDraftRow>(
    `SELECT id, application_id, contact_id, resume_id, dossier_id, kind, lang,
            to_email, subject, body, gmail_draft_id, created_at, sent_detected_at,
            sent_at, approved_at
       FROM outreach_drafts
      WHERE application_id = $1
      ORDER BY created_at DESC`,
    [applicationId],
  );
  return rows;
}

export async function hasOpenOutreach(
  applicationId: string,
  kind: OutreachKind,
  toEmail: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM outreach_drafts
      WHERE application_id = $1
        AND kind = $2
        AND lower(to_email) = lower($3)
        AND (gmail_draft_id IS NOT NULL OR sent_detected_at IS NOT NULL OR approved_at IS NOT NULL)`,
    [applicationId, kind, toEmail],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export function buildPersonalizedOutreach(opts: {
  app: ApplicationDetail;
  dossier: CompanyDossier | null;
  projects: Project[];
  fullName: string;
  availability: string;
  email?: string;
  phone?: string;
  city?: string;
  links?: string[];
  recipientName?: string | null;
  lang?: LetterLang;
  kind?: OutreachKind;
}): { subject: string; body: string; lang: LetterLang; wordCount: number } {
  const lang = opts.lang ?? detectLetterLang(opts.app.title, opts.app.description);
  const kind = opts.kind ?? "outreach";
  const fact =
    opts.dossier?.company_fact?.trim() ||
    (lang === "fr"
      ? `Votre équipe recrute pour ${opts.app.title}.`
      : `Your team is hiring for ${opts.app.title}.`);
  const signal = opts.dossier?.signals?.[0]?.signal;
  const companyFact = [fact, signal && signal !== fact ? signal : ""].filter(Boolean).join(" ");

  if (kind === "followup") {
    const greeting =
      lang === "fr"
        ? opts.recipientName
          ? `Bonjour ${opts.recipientName},`
          : "Bonjour,"
        : opts.recipientName
          ? `Hello ${opts.recipientName},`
          : "Hello,";
    const subject =
      lang === "fr" ? `Relance - ${opts.app.title}` : `Following up - ${opts.app.title}`;
    const body =
      lang === "fr"
        ? [
            greeting,
            "",
            `Je vous relance au sujet du poste ${opts.app.title} chez ${opts.app.company_name}.`,
            fact,
            "",
            "Je reste disponible si vous avez besoin d'autres documents.",
            "",
            "Cordialement,",
            opts.fullName,
          ].join("\n")
        : [
            greeting,
            "",
            `Following up on the ${opts.app.title} role at ${opts.app.company_name}.`,
            fact,
            "",
            "Happy to send anything else you need.",
            "",
            "Best regards,",
            opts.fullName,
          ].join("\n");
    return { subject, body, lang, wordCount: body.split(/\s+/).filter(Boolean).length };
  }

  const mail = fillOutreachEmail({
    fullName: opts.fullName,
    companyName: opts.app.company_name,
    roleTitle: opts.app.title,
    companyFact,
    companyFactSource: opts.dossier?.company_fact_source ?? opts.app.company_website ?? "",
    projects: opts.projects,
    availability: opts.availability,
    locationRule: "",
    links: opts.links ?? [],
    lang,
    email: opts.email,
    phone: opts.phone,
    city: opts.city,
    recruiterName: opts.recipientName ?? null,
  });

  const subject =
    kind === "application" || kind === "cover"
      ? lang === "fr"
        ? `Candidature - ${opts.app.title}`
        : `Application - ${opts.app.title}`
      : mail.subject;

  return { subject, body: mail.body, lang, wordCount: mail.wordCount };
}

export async function createOutreachDraft(opts: {
  applicationId: string;
  contactId: string | null;
  resumeId: string | null;
  dossierId: string | null;
  kind: OutreachKind;
  lang: LetterLang;
  toEmail: string;
  subject: string;
  body: string;
  pushToGmail?: boolean;
}): Promise<OutreachDraftRow> {
  const email = opts.toEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid recipient email");
  }

  if (await hasOpenOutreach(opts.applicationId, opts.kind, email)) {
    throw new Error(
      `An open ${opts.kind} draft already exists for ${email} on this application. Avoiding duplicate outreach.`,
    );
  }

  let gmailDraftId: string | null = null;
  if (opts.pushToGmail !== false) {
    gmailDraftId = await createDraft({
      to: email,
      subject: opts.subject,
      body: opts.body,
    });
  }

  const { rows } = await pool.query<OutreachDraftRow>(
    `INSERT INTO outreach_drafts (
        application_id, contact_id, resume_id, dossier_id, kind, lang,
        to_email, subject, body, gmail_draft_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, application_id, contact_id, resume_id, dossier_id, kind, lang,
                to_email, subject, body, gmail_draft_id, created_at, sent_detected_at`,
    [
      opts.applicationId,
      opts.contactId,
      opts.resumeId,
      opts.dossierId,
      opts.kind,
      opts.lang,
      email,
      opts.subject,
      opts.body,
      gmailDraftId,
    ],
  );

  if (!rows[0]) throw new Error("failed to store outreach draft");
  return rows[0];
}

/** Mark outreach as sent when inbox sync sees a matching outbound message. */
export async function markOutreachSentFromOutbound(opts: {
  applicationId: string;
  toOrSubjectHint?: string | null;
  occurredAt: Date;
}) {
  await pool.query(
    `UPDATE outreach_drafts
        SET sent_detected_at = COALESCE(sent_detected_at, $2),
            sent_at = COALESCE(sent_at, $2)
      WHERE application_id = $1
        AND sent_detected_at IS NULL
        AND (
          $3::text IS NULL
          OR lower(to_email) = lower($3)
          OR lower(subject) = lower($3)
        )`,
    [opts.applicationId, opts.occurredAt, opts.toOrSubjectHint ?? null],
  );
}

export async function getOutreachDraft(id: string): Promise<OutreachDraftRow | null> {
  const { rows } = await pool.query<OutreachDraftRow>(
    `SELECT id, application_id, contact_id, resume_id, dossier_id, kind, lang,
            to_email, subject, body, gmail_draft_id, created_at, sent_detected_at,
            sent_at, approved_at
       FROM outreach_drafts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Resume + cover letter for the Gmail attachment, resolved lazily. The resume
 * is whichever one was active when this draft was written (falls back to the
 * application's resolved resume). The cover letter should already exist —
 * prepareOutreachWorkflow builds one for every application up front — but
 * this is a safety net for applications that reach approval some other way
 * (a manually drafted outreach, or older data from before that existed).
 */
async function resolveAttachments(row: OutreachDraftRow): Promise<GmailAttachment[]> {
  const { readFile } = await import("node:fs/promises");
  const { getApplication } = await import("./queries");
  const { getLatestDossier } = await import("./research");
  const { buildPackageFromDossier } = await import("./package");

  const attachments: GmailAttachment[] = [];
  const app = await getApplication(row.application_id);
  if (!app) return attachments;

  const safeCompany = app.company_name.replace(/[\\/:*?"<>|]+/g, "").trim() || "Application";

  let resumePath = app.resume_path;
  if (row.resume_id) {
    const { rows } = await pool.query<{ storage_path: string }>(
      `SELECT storage_path FROM resumes WHERE id = $1`,
      [row.resume_id],
    );
    if (rows[0]) resumePath = rows[0].storage_path;
  }
  if (resumePath) {
    try {
      const content = await readFile(resumePath);
      attachments.push({ filename: "CV - Ara Ghahramanyan.pdf", content, contentType: "application/pdf" });
    } catch (err) {
      console.error(`[outreach] resume attach failed for application ${row.application_id}:`, err);
    }
  }

  let coverLetterPath = app.cover_letter_path;
  if (!coverLetterPath) {
    try {
      const dossier = await getLatestDossier(app.company_id, app.id);
      const built = await buildPackageFromDossier({ app, dossier, lang: row.lang });
      coverLetterPath = built?.pdfPath ?? null;
    } catch (err) {
      console.error(`[outreach] cover letter build failed for application ${row.application_id}:`, err);
    }
  }
  if (coverLetterPath) {
    try {
      const content = await readFile(coverLetterPath);
      attachments.push({
        filename: `Cover Letter - ${safeCompany}.pdf`,
        content,
        contentType: "application/pdf",
      });
    } catch (err) {
      console.error(`[outreach] cover letter attach failed for application ${row.application_id}:`, err);
    }
  }

  return attachments;
}

/**
 * Assisted Mode approval.
 * Default: push a Gmail draft (you still press Send in Gmail).
 * If GMAIL_ALLOW_SEND=true and OAuth includes gmail.send, sends immediately after approval.
 * When Gmail OAuth isn't configured/authorized yet, approval still records locally — sending
 * a personalized email is never blocked on setting up Gmail first.
 */
export async function approveOutreachDraft(opts: {
  outreachId: string;
  allowSend?: boolean;
}): Promise<{ mode: "draft" | "sent" | "local"; gmailId: string | null; gmailError?: string }> {
  const { gmailSendAllowed } = await import("./sources");
  const { createDraft, sendMail } = await import("./gmail");
  const { setApplicationStatus } = await import("./queries");

  const row = await getOutreachDraft(opts.outreachId);
  if (!row) throw new Error("outreach draft not found");
  if (row.sent_at || row.sent_detected_at) {
    throw new Error("This outreach was already sent");
  }

  const attachments = await resolveAttachments(row);

  const shouldSend = Boolean(opts.allowSend && gmailSendAllowed());

  if (shouldSend) {
    try {
      const messageId = await sendMail({
        to: row.to_email,
        subject: row.subject,
        body: row.body,
        attachments,
      });
      await pool.query(
        `UPDATE outreach_drafts
            SET approved_at = now(),
                approved_by = 'user',
                sent_at = now(),
                gmail_message_id = $2
          WHERE id = $1`,
        [row.id, messageId],
      );
      await setApplicationStatus(row.application_id, "applied", "approved & sent via Gmail");
      return { mode: "sent", gmailId: messageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Gmail send failed (${message}). Re-auth with gmail.send or leave GMAIL_ALLOW_SEND unset to use drafts.`,
      );
    }
  }

  let draftId = row.gmail_draft_id;
  let gmailError: string | undefined;
  if (!draftId) {
    try {
      draftId = await createDraft({ to: row.to_email, subject: row.subject, body: row.body, attachments });
    } catch (err) {
      gmailError = err instanceof Error ? err.message : String(err);
    }
  }

  await pool.query(
    `UPDATE outreach_drafts
        SET approved_at = now(),
            approved_by = 'user',
            gmail_draft_id = COALESCE($2, gmail_draft_id)
      WHERE id = $1`,
    [row.id, draftId ?? null],
  );

  if (draftId) {
    await setApplicationStatus(
      row.application_id,
      "ready",
      "approved — Gmail draft ready (Assisted Mode; you send)",
    );
    return { mode: "draft", gmailId: draftId };
  }

  await setApplicationStatus(
    row.application_id,
    "ready",
    `approved locally — Gmail draft not created (${gmailError}). Set up Gmail OAuth to push drafts automatically.`,
  );
  return { mode: "local", gmailId: null, gmailError };
}
