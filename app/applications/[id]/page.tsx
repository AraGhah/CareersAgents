import Link from "next/link";
import { notFound } from "next/navigation";
import { buildPackage, findRecipientAction, markAppliedAction, saveGmailDraftAction } from "../../actions";
import { Flash, Select, SubmitButton } from "../../components/client-ui";
import { Disclosure } from "../../components/disclosure";
import { FlowStrip } from "../../components/flow-strip";
import { DbUnavailable, ExtLink, PageHeader, StatusPill } from "../../components/ui";
import { day, place } from "../../../lib/format";
import { existingApplicationFiles } from "../../../lib/attachments";
import { detectCategories } from "../../../lib/category";
import { contactKind, hostOf } from "../../../lib/contact-parse";
import { gmailStatus } from "../../../lib/gmail";
import { gmailDraftUrl } from "../../../lib/gmail-link";
import { detectInternshipCategories } from "../../../lib/internship-category";
import { detectLetterLang } from "../../../lib/letter";
import { loadAnswerBank, loadApplicantContact } from "../../../lib/package";
import { loadStoredPackage } from "../../../lib/package-store";
import { getApplication, listContactsForCompany } from "../../../lib/queries";
import { listOutreachForApplication } from "../../../lib/outreach";
import { rankContacts } from "../../../lib/recruiter";
import { getLatestDossier } from "../../../lib/research";
import { resolveResumeForJob } from "../../../lib/resumes";
import { LANG_LABEL_FR } from "../../../lib/status-labels";
import { loadPortalView } from "../../../lib/apply/view";
import { MoreOptions } from "./more-options";
import { PORTAL_FLASH, PortalPanel } from "./portal-panel";
import { SendPanel, type Suggestion } from "./send-panel";

type Search = {
  built?: string;
  researched?: string;
  drafted?: string;
  contact?: string;
  prepared?: string;
  outreach?: string;
  approved?: string;
  gmailError?: string;
  applied?: string;
  draft?: string;
  searched?: string;
  found?: string;
  portal?: string;
};

/** What each failed check means, in plain words. Checks not listed here fall back to their own label. */
const CHECK_FR: Record<string, string> = {
  company: "Le nom de l’entreprise n’apparaît pas dans la lettre.",
  role: "Le titre exact du poste n’apparaît pas dans la lettre.",
  nouns: "Des noms propres de la lettre ne viennent pas de tes données. Relis-les.",
  resume: "Le fichier du CV est introuvable sur le disque.",
  brackets: "Il reste du texte entre crochets à remplacer.",
  page: "La lettre dépasse une page.",
  email_length: "L’email n’a pas la longueur visée.",
  company_fact:
    "Aucun fait vérifié sur l’entreprise : la lettre parle du poste à la place. Ajoute un fait vrai à l’étape 1 pour la personnaliser.",
  project_facts: "Le projet mis en avant n’a pas encore de texte dans lib/project-facts.ts.",
  links: "Un de tes liens (portfolio, GitHub, LinkedIn) ne répond pas.",
  unique: "Cette offre a plus d’une candidature.",
};

/** Failed checks whose own detail text is English or repeats the message above. */
const QUIET_DETAIL = new Set(["company_fact", "project_facts", "brackets", "company", "role"]);

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  let app;
  try {
    app = await getApplication(id);
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Candidature" title="Dossier de candidature" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }
  if (!app) notFound();

  const lang = detectLetterLang(app.title, app.description);
  const categories = detectCategories(app.title, app.description);

  let bank = [] as Awaited<ReturnType<typeof loadAnswerBank>>;
  let stored = null as Awaited<ReturnType<typeof loadStoredPackage>>;
  let dossier = null as Awaited<ReturnType<typeof getLatestDossier>>;
  let contacts = [] as Awaited<ReturnType<typeof listContactsForCompany>>;
  let outreach = [] as Awaited<ReturnType<typeof listOutreachForApplication>>;
  let resume = null as Awaited<ReturnType<typeof resolveResumeForJob>>;
  let account: string | undefined;
  let gmail: Awaited<ReturnType<typeof gmailStatus>> = "off";
  let attachmentNames: string[] = [];
  let downloadableFiles: Awaited<ReturnType<typeof existingApplicationFiles>> = [];
  let extrasError: string | null = null;
  let portal: Awaited<ReturnType<typeof loadPortalView>> = null;

  try {
    bank = await loadAnswerBank(lang);
    stored = await loadStoredPackage(app.cover_letter_path);
    [dossier, contacts, outreach, resume] = await Promise.all([
      getLatestDossier(app.company_id, app.id),
      listContactsForCompany(app.company_id),
      listOutreachForApplication(app.id),
      resolveResumeForJob(lang, detectInternshipCategories(app.title, app.description)),
    ]);
    account = (await loadApplicantContact(lang)).email;
    gmail = await gmailStatus();
    // Only files that are actually readable right now: a recorded path can point at a file that was
    // since moved or deleted, and a download link (or an "attached automatically" promise) must not
    // be shown for one that would just 404.
    downloadableFiles = await existingApplicationFiles(app);
    attachmentNames = downloadableFiles.map((f) => f.filename);
    portal = await loadPortalView(app.id);
  } catch (err) {
    extrasError = (err as Error).message;
  }

  // A package is usable once the letter and the email both exist. Older ones without an email are rebuilt.
  const pkg = stored?.letter && stored.emailSubject && stored.emailBody ? stored : null;
  const issues = (pkg?.checklist ?? []).filter((c) => !c.ok);
  const applied = ["applied", "followup", "interview", "accepted"].includes(app.status);
  // Where to send it: the addresses found on the company's own pages, best first, each with the page it
  // came from; or the recipient of the draft already made.
  const suggestions: Suggestion[] = rankContacts(contacts).map((c) => ({
    email: c.email!,
    kind: contactKind(c.email!),
    source: c.source_url,
    sourceHost: hostOf(c.source_url) ?? c.source_url,
  }));
  const draftRow = outreach.find((o) => o.kind === "application" && o.gmail_draft_id && !o.sent_at && !o.sent_detected_at);
  const defaultTo = draftRow?.to_email || suggestions[0]?.email || "";
  const draft =
    draftRow && draftRow.gmail_message_id
      ? {
          link: gmailDraftUrl(account, draftRow.gmail_message_id),
          when: day(draftRow.approved_at ?? draftRow.created_at),
        }
      : null;

  // The online-form path shows when there is no published address to write to, or once it has been used.
  const showPortal = !portal || portal.channel === "portal" || portal.channel === "manual" || !!portal.run || suggestions.length === 0;
  const portalFlash = sp.portal ? PORTAL_FLASH[sp.portal] : undefined;

  const FILE_LABEL: Record<"cv" | "letter", string> = {
    letter: "Télécharger la lettre (PDF)",
    cv: "Télécharger le CV",
  };
  const FILE_ORDER: Record<"cv" | "letter", number> = { letter: 0, cv: 1 };
  const files = [...downloadableFiles]
    .sort((a, b) => FILE_ORDER[a.kind] - FILE_ORDER[b.kind])
    .map((f) => ({ label: FILE_LABEL[f.kind], href: `/applications/${app.id}/files/${f.kind}` }));

  return (
    <>
      <PageHeader
        eyebrow={app.company_name}
        title={app.title}
        lede={
          <>
            {place(app.location, app.workplace_type)}
            {" · "}
            <ExtLink href={app.url}>voir l&apos;offre</ExtLink>
            {app.company_website ? (
              <>
                {" · "}
                <ExtLink href={app.company_website}>site de l&apos;entreprise</ExtLink>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <StatusPill status={app.status} />
            <Link href="/board" className="btn">
              Board
            </Link>
          </>
        }
      />

      <FlowStrip current="prepare" />

      <div className="stack stack-tight flash-stack">
        {extrasError ? (
          <Flash tone="warn">
            Une partie du dossier n&apos;a pas pu être chargée ({extrasError}). La candidature reste visible.
          </Flash>
        ) : null}
        {sp.built === "1" ? (
          <Flash>Lettre et email prêts. Relis-les, puis ouvre Gmail à l’étape 3.</Flash>
        ) : null}
        {sp.applied === "1" ? <Flash>Marquée comme postulée. Relances prévues à J+7 et J+14.</Flash> : null}
        {sp.draft === "created" ? (
          <Flash>Brouillon créé dans Gmail, avec le CV et la lettre joints. Ouvre-le, relis, puis clique sur Envoyer.</Flash>
        ) : null}
        {sp.draft === "updated" ? <Flash>Brouillon Gmail mis à jour avec le texte et les fichiers actuels.</Flash> : null}
        {/* With a package the error is shown in the send panel itself: this page opens at #envoyer, below this banner. */}
        {sp.gmailError && !sp.approved && !pkg ? <Flash tone="error">{sp.gmailError}</Flash> : null}
        {sp.searched === "1" ? (
          Number(sp.found) > 0 ? (
            <Flash>Adresse trouvée sur le site de l’entreprise.</Flash>
          ) : (
            <Flash tone="info">Toujours aucune adresse publique pour cette entreprise.</Flash>
          )
        ) : null}
        {sp.researched === "1" ? <Flash>Recherche sur l’entreprise mise à jour.</Flash> : null}
        {sp.contact === "1" ? <Flash>Contact enregistré.</Flash> : null}
        {sp.prepared === "1" ? <Flash>Préparation terminée. L’email attend ton approbation dans « Plus d’options ».</Flash> : null}
        {sp.approved === "draft" ? <Flash>Brouillon créé dans Gmail.</Flash> : null}
        {sp.approved === "sent" ? <Flash>Email envoyé.</Flash> : null}
        {sp.approved === "local" ? (
          <Flash tone="info">
            Approuvé, mais Gmail n&apos;est pas connecté par l’API : aucun brouillon créé. Utilise plutôt « Ouvrir dans
            Gmail » à l’étape 3.
            {sp.gmailError ? <span className="field-hint">{sp.gmailError}</span> : null}
          </Flash>
        ) : null}
        {sp.drafted ? <Flash tone="info">Brouillon créé dans Gmail.</Flash> : null}
        {portalFlash ? <Flash tone={portalFlash.tone}>{portalFlash.text}</Flash> : null}
      </div>

      <ol className="apply-steps">
        {/* 1 — build */}
        <li className={`apply-step ${pkg ? "is-done" : "is-current"}`} id="preparer">
          <span className="apply-step-num" aria-hidden="true">
            {pkg ? "✓" : "1"}
          </span>
          <div className="apply-step-body">
            <h2 className="apply-step-title">Préparer la lettre et l’email</h2>
            <p className="apply-step-lede">
              {pkg
                ? `Prêts en ${LANG_LABEL_FR[(pkg.lang as "en" | "fr") ?? lang]}. Projet mis en avant : ${
                    pkg.projects?.[0] ?? "aucun"
                  }.`
                : "Un clic cherche l’entreprise et l’adresse où envoyer, puis écrit la lettre de motivation (PDF) et l’email à partir de ton profil, de tes projets et de l’offre."}
            </p>

            <form action={buildPackage}>
              <input type="hidden" name="applicationId" value={app.id} />
              <details className="apply-more">
                <summary>Personnaliser (facultatif)</summary>
                <div className="apply-more-body">
                  <div className="field">
                    <label htmlFor="companyFact">
                      Un fait vrai sur l’entreprise <span className="optional">(dans tes mots)</span>
                    </label>
                    <textarea
                      id="companyFact"
                      name="companyFact"
                      rows={3}
                      defaultValue={pkg?.companyFactVerified ? (pkg.companyFact ?? "") : ""}
                      placeholder="Ex. : elle construit des logiciels de sécurité utilisés par des villes et des aéroports."
                    />
                    <span className="field-hint">
                      Sert au paragraphe « pourquoi cette entreprise ». Sans fait, la lettre parle du poste.
                    </span>
                  </div>
                  <div className="field">
                    <label htmlFor="companyFactSource">
                      Source de ce fait <span className="optional">(lien)</span>
                    </label>
                    <input
                      type="url"
                      id="companyFactSource"
                      name="companyFactSource"
                      defaultValue={pkg?.companyFactVerified ? (pkg.companyFactSource ?? "") : ""}
                      placeholder="https://…"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="lang">Langue de la lettre et de l’email</label>
                    <Select
                      id="lang"
                      name="lang"
                      ariaLabel="Langue de la lettre"
                      defaultValue={pkg?.lang ?? lang}
                      options={[
                        { value: "en", label: LANG_LABEL_FR.en },
                        { value: "fr", label: LANG_LABEL_FR.fr },
                      ]}
                    />
                  </div>
                </div>
              </details>
              <div className="form-actions">
                <SubmitButton className={pkg ? "" : "primary"} pendingLabel="Recherche de l’entreprise et génération…">
                  {pkg ? "Régénérer" : "Générer la lettre et l’email"}
                </SubmitButton>
              </div>
            </form>
          </div>
        </li>

        {/* 2 — review */}
        <li className={`apply-step ${pkg ? (applied ? "is-done" : "") : "is-locked"}`} id="relire">
          <span className="apply-step-num" aria-hidden="true">
            {pkg && applied ? "✓" : "2"}
          </span>
          <div className="apply-step-body">
            <h2 className="apply-step-title">Relire</h2>
            {!pkg ? (
              <p className="apply-step-lede">Disponible après l’étape 1.</p>
            ) : (
              <>
                {issues.length === 0 ? (
                  <p className="apply-step-lede">
                    <span className="badge green">Tout est bon</span> Les vérifications sont passées.
                  </p>
                ) : (
                  <div className="apply-issues">
                    <p className="apply-step-lede">
                      <span className="badge yellow">
                        {issues.length} point{issues.length > 1 ? "s" : ""} à vérifier
                      </span>{" "}
                      Rien ne bloque l’envoi, mais relis.
                    </p>
                    <ul>
                      {issues.map((c) => (
                        <li key={c.id}>
                          {CHECK_FR[c.id] ?? c.label}
                          {c.detail && !QUIET_DETAIL.has(c.id) ? <span className="field-hint">{c.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="apply-email">
                  <p className="email-subject">
                    <strong>Objet :</strong> {pkg.emailSubject}
                  </p>
                  <pre className="code-block as-text">{pkg.emailBody}</pre>
                </div>

                <Disclosure label="Lire la lettre de motivation">
                  <div className="apply-letter">
                    <pre className="letter">{pkg.letter}</pre>
                  </div>
                </Disclosure>
              </>
            )}
          </div>
        </li>

        {/* 3 — send */}
        <li className={`apply-step ${pkg ? (applied ? "is-done" : "is-current") : "is-locked"}`} id="envoyer">
          <span className="apply-step-num" aria-hidden="true">
            {pkg && applied ? "✓" : "3"}
          </span>
          <div className="apply-step-body">
            <h2 className="apply-step-title">Envoyer</h2>
            {!pkg ? (
              <p className="apply-step-lede">Disponible après l’étape 1.</p>
            ) : (
              <>
                <SendPanel
                  applicationId={app.id}
                  subject={pkg.emailSubject!}
                  body={pkg.emailBody!}
                  defaultTo={defaultTo}
                  suggestions={suggestions}
                  account={account}
                  companyName={app.company_name}
                  postingUrl={app.url}
                  gmail={gmail}
                  gmailError={sp.approved ? null : (sp.gmailError ?? null)}
                  draft={draft}
                  attachmentNames={attachmentNames}
                  saveDraftAction={saveGmailDraftAction}
                  findRecipientAction={findRecipientAction}
                  files={files}
                />
                {applied ? (
                  <p className="apply-step-lede apply-sent">
                    <span className="badge green">Envoyée</span> {app.submitted_at ? day(app.submitted_at) : ""} Les relances
                    sont dans <Link href="/followups">Relances</Link>.
                  </p>
                ) : (
                  <form action={markAppliedAction} className="form-actions apply-sent">
                    <input type="hidden" name="applicationId" value={app.id} />
                    <SubmitButton pendingLabel="Mise à jour…">J’ai envoyé la candidature</SubmitButton>
                    <span className="small muted">Enregistre l’envoi et prévoit des relances à J+7 et J+14.</span>
                  </form>
                )}
              </>
            )}
          </div>
        </li>
      </ol>

      {showPortal ? (
        <PortalPanel
          applicationId={app.id}
          lang={lang}
          view={portal}
          postingUrl={app.url}
          submitEnabled={process.env.PORTAL_ALLOW_SUBMIT?.trim().toLowerCase() === "true"}
        />
      ) : null}

      <MoreOptions
        app={app}
        lang={lang}
        categories={categories}
        resume={resume}
        dossier={dossier}
        contacts={contacts}
        outreach={outreach}
        bank={bank}
        applied={applied}
      />

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/board">Retour au board</Link>
      </nav>
    </>
  );
}
