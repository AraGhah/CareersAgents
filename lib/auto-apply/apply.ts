// One posting, from "picked" to "as far as the desk is allowed to take it":
//   a published recruiter address  → the letter and email are built (or the ones you already made are kept), and the
//                                    email goes into Gmail as a DRAFT with the CV and cover letter attached. Never sent:
//                                    you press Send, and inbox sync then moves the status to "Envoyé".
//   no address, a form that works  → the company's own form is filled and, only with PORTAL_ALLOW_SUBMIT=true and when
//                                    every preflight gate passes, submitted (lib/apply/runner.ts). A confirmed submit
//                                    sets the status itself.
//   anything else                  → skipped, with the reason, so the batch moves on to the next-best posting.
// Nothing here presses Submit or Send: those stay in submit.ts and in Gmail.

import { decideChannel, saveChannel } from "../apply/route";
import { resolveApplyTarget } from "../apply/apply-url";
import { duplicateReason } from "../apply/dedupe";
import { runPortalApplication } from "../apply/runner";
import { existingApplicationFiles } from "../attachments";
import { findRecipientForApplication } from "../contact-discovery";
import { detectLetterLang } from "../letter";
import { buildPackageFromDossier } from "../package";
import { loadStoredPackage } from "../package-store";
import { saveApplicationDraft } from "../outreach";
import { getApplication, listContactsForCompany, setApplicationStatus } from "../queries";
import { pickBestContact } from "../recruiter";
import { researchCompanyForApplication } from "../research";
import type { ApplicationDetail } from "../types";
import type { Channel, ItemOutcome } from "./store";

export type ApplyResult = {
  outcome: Exclude<ItemOutcome, "working">;
  detail: string;
  channel: Channel | null;
  /** Counts toward the number asked for: a draft ready for you to send, or a form the portal confirmed. */
  counts: boolean;
  /** Stops the whole batch (Gmail is disconnected: every other email would fail the same way). */
  abort?: string;
};

export type ApplyContext = {
  /** PORTAL_ALLOW_SUBMIT=true: only then is an online form submitted. */
  submitAllowed: boolean;
  /** The daily limit of automatic submissions was reached: no more forms today. */
  portalExhausted: boolean;
  /** Waits, if needed, so two online applications are never sent back to back. */
  paceNextPortal: () => Promise<void>;
  log: (line: string) => void;
};

const skipped = (detail: string, channel: Channel | null = null): ApplyResult => ({ outcome: "skipped", detail, channel, counts: false });
const failed = (detail: string, channel: Channel | null = null): ApplyResult => ({ outcome: "failed", detail, channel, counts: false });

/** The Gmail connection is gone or lacks the permission: no email can be drafted until `npm run gmail:auth` is run again. */
export function isGmailAuthError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /not authorized|invalid_grant|unauthorized_client|No refresh token|invalid_client|insufficient (authentication|permission)|GMAIL_CLIENT_(ID|SECRET) is missing/i.test(raw);
}

export async function applyOne(applicationId: string, ctx: ApplyContext): Promise<ApplyResult> {
  const app = await getApplication(applicationId);
  if (!app) return failed("Application not found.");

  const dup = await duplicateReason(app);
  if (dup) return skipped(`Déjà envoyée : ${dup}`);

  // Where the company's own public pages publish an address (cheap when it is already known).
  let newWebsite: string | null = null;
  try {
    newWebsite = (await findRecipientForApplication(app)).newWebsite;
  } catch (err) {
    ctx.log(`address search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let decision = await decideChannel(app);
  if (decision.channel !== "email") {
    // No address: the form is the way in, and the posting may be on Indeed or LinkedIn while the form is elsewhere.
    const target = await resolveApplyTarget(app);
    decision = await decideChannel(app, { applyUrl: target.url, hint: target.hint });
  }
  await saveChannel(app.id, decision.channel);

  if (decision.channel === "manual") return skipped(decision.reason, "manual");
  if (decision.channel === "email") return draftEmail(app, newWebsite, ctx);
  return submitForm(app, ctx);
}

async function draftEmail(app: ApplicationDetail, newWebsite: string | null, ctx: ApplyContext): Promise<ApplyResult> {
  const contact = pickBestContact(await listContactsForCompany(app.company_id));
  if (!contact?.email) return skipped("Aucune adresse publiée trouvée.", "email");

  let dossier = null;
  try {
    dossier = await researchCompanyForApplication({
      app: { ...app, company_website: app.company_website ?? newWebsite },
      companyId: app.company_id,
      // A website found just now means the earlier notes were written without reading the company's pages.
      force: Boolean(newWebsite),
    });
  } catch (err) {
    ctx.log(`company research failed, continuing without it: ${err instanceof Error ? err.message : String(err)}`);
  }

  // A letter and email you already built (and maybe edited, or gave a company fact) are kept as they are.
  const current = (await getApplication(app.id)) ?? app;
  let pkg = await loadStoredPackage(current.cover_letter_path);
  const haveLetter = (await existingApplicationFiles(current)).some((f) => f.kind === "letter");
  if (!pkg?.emailSubject || !pkg.emailBody || !haveLetter) {
    await buildPackageFromDossier({
      app: current,
      dossier,
      lang: detectLetterLang(current.title, current.description),
      checkLinks: false,
      force: true,
    });
  }

  const ready = (await getApplication(app.id)) ?? current;
  pkg = await loadStoredPackage(ready.cover_letter_path);
  if (!pkg?.emailSubject || !pkg.emailBody) return failed("La lettre et l'email n'ont pas pu être générés.", "email");

  const files = await existingApplicationFiles(ready);
  if (!files.some((f) => f.kind === "cv")) return failed("Aucun CV sur le disque pour cette offre : ajoute-en un sur /resumes.", "email");
  if (!files.some((f) => f.kind === "letter")) return failed("La lettre de motivation (PDF) est introuvable sur le disque.", "email");

  const saved = await saveApplicationDraft({
    app: ready,
    to: contact.email,
    subject: pkg.emailSubject,
    body: pkg.emailBody,
    lang: pkg.lang === "fr" ? "fr" : "en",
  });

  // Prepared and waiting for you to press Send. (It becomes "Envoyé" when inbox sync sees the sent message.)
  if (["discovered", "qualified"].includes(ready.status)) {
    await setApplicationStatus(ready.id, "ready", "auto-apply: Gmail draft ready, you send it");
  }

  const issues = (pkg.checklist ?? []).filter((c) => !c.ok).length;
  const detail = [
    `Brouillon Gmail ${saved.mode === "updated" ? "mis à jour" : "créé"} pour ${contact.email}`,
    `(${saved.attached.length} pièce${saved.attached.length > 1 ? "s" : ""} jointe${saved.attached.length > 1 ? "s" : ""})`,
    saved.missing.length ? `Fichier manquant : ${saved.missing.join(", ")}.` : null,
    issues > 0 ? `${issues} point${issues > 1 ? "s" : ""} à relire dans la lettre.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { outcome: "draft", detail, channel: "email", counts: true };
}

async function submitForm(app: ApplicationDetail, ctx: ApplyContext): Promise<ApplyResult> {
  if (!ctx.submitAllowed) {
    return skipped(
      "Formulaire en ligne : l'envoi automatique est désactivé. Ajoute PORTAL_ALLOW_SUBMIT=true dans .env.local pour que le bureau soumette les formulaires. Rien n'a été ouvert.",
      "portal",
    );
  }
  if (ctx.portalExhausted) {
    return skipped("Limite quotidienne d'envois par formulaire atteinte (PORTAL_DAILY_LIMIT). Réessaie demain.", "portal");
  }

  await ctx.paceNextPortal();
  const run = await runPortalApplication(app.id, { mode: "submit", log: ctx.log });
  switch (run.state) {
    case "submitted":
      return { outcome: "sent", detail: `Formulaire envoyé et confirmé : ${run.reason}`, channel: "portal", counts: true };
    case "needs_review":
    case "ready_to_submit":
    case "planned":
      if (/daily limit/i.test(run.reason)) ctx.portalExhausted = true;
      return {
        outcome: "review",
        detail: `Formulaire rempli, il attend une action de ta part : ${run.reason} (voir /portal)`,
        channel: "portal",
        counts: false,
      };
    case "blocked":
      return skipped(`Formulaire non envoyé : ${run.reason}`, "portal");
    case "duplicate":
      return skipped(`Déjà envoyée : ${run.reason}`, "portal");
    default:
      return failed(`Formulaire : ${run.state} (${run.reason})`, "portal");
  }
}
