import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addContactAction,
  approveOutreachAction,
  buildPackage,
  changeStatus,
  draftOutreachAction,
  markAppliedAction,
  prepareWorkflowAction,
  researchApplicationAction,
  saveApplication,
} from "../../actions";
import { Flash, Select, SubmitButton } from "../../components/client-ui";
import { Disclosure } from "../../components/disclosure";
import { FlowStrip } from "../../components/flow-strip";
import { DbUnavailable, EmptyState, ExtLink, PageHeader, Section, StatusPill } from "../../components/ui";
import { day, place } from "../../../lib/format";
import { detectCategories } from "../../../lib/category";
import { detectInternshipCategories } from "../../../lib/internship-category";
import { detectLetterLang } from "../../../lib/letter";
import { loadAnswerBank } from "../../../lib/package";
import { loadStoredPackage } from "../../../lib/package-store";
import { getApplication, listContactsForCompany } from "../../../lib/queries";
import { listOutreachForApplication } from "../../../lib/outreach";
import { getLatestDossier } from "../../../lib/research";
import { resolveResumeForJob } from "../../../lib/resumes";
import { APPLICATION_STATUSES } from "../../../lib/types";
import { APPLICATION_STATUS_FR, LANG_LABEL_FR, ROLE_CATEGORY_LABEL_FR } from "../../../lib/status-labels";

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
};

const OUTREACH_KIND_FR: Record<string, string> = {
  outreach: "Prise de contact",
  application: "Candidature",
  cover: "Lettre de motivation",
  followup: "Relance",
};

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
  let extrasError: string | null = null;

  try {
    bank = await loadAnswerBank(lang);
    stored = await loadStoredPackage(app.cover_letter_path);
    [dossier, contacts, outreach, resume] = await Promise.all([
      getLatestDossier(app.company_id, app.id),
      listContactsForCompany(app.company_id),
      listOutreachForApplication(app.id),
      resolveResumeForJob(lang, detectInternshipCategories(app.title, app.description)),
    ]);
  } catch (err) {
    extrasError = (err as Error).message;
  }

  const checklist = stored?.checklist ?? [];
  const allClear = checklist.length > 0 && checklist.every((c) => c.ok);
  const toApprove = outreach.length > 0 && !outreach[0].approved_at && !outreach[0].gmail_draft_id;
  const approvedLocalOnly =
    outreach.length > 0 && Boolean(outreach[0].approved_at) && !outreach[0].gmail_draft_id;
  const canMarkApplied = app.status === "ready" || outreach.some((o) => o.approved_at && !o.sent_at);
  const bankWritten = bank.filter((a) => a.mode !== "manual" && a.text).length;

  const applied = ["applied", "followup", "interview", "accepted"].includes(app.status);
  const hasContactEmail = contacts.some((c) => c.email);
  const progress: Array<{ label: string; done: boolean }> = [
    { label: "Entreprise recherchée", done: Boolean(dossier) },
    { label: "Contact trouvé", done: hasContactEmail },
    { label: "Email rédigé", done: outreach.length > 0 },
    { label: "Email approuvé", done: outreach.some((o) => o.approved_at) },
    { label: "Candidature envoyée", done: applied },
  ];
  const currentStep = progress.findIndex((p) => !p.done);

  const nextAction = (() => {
    if (applied) {
      return {
        title: "Candidature envoyée",
        body: "Les relances sont gérées depuis Relances. Tu peux encore mettre à jour notes et package.",
        href: "/followups",
        hrefLabel: "Voir les relances",
      };
    }
    if (toApprove) {
      return {
        title: "Approuver l’email",
        body: `Relis le message pour ${outreach[0].to_email}, puis crée le brouillon Gmail.`,
        href: "#workflow",
        hrefLabel: "Voir l’email",
      };
    }
    if (canMarkApplied) {
      return {
        title: "Marquer comme postulée",
        body: "Quand tu as soumis le formulaire toi-même, enregistre l’envoi pour planifier les relances.",
        href: "#workflow",
        hrefLabel: "Confirmer l’envoi",
      };
    }
    if (!dossier) {
      return {
        title: "Rechercher l’entreprise",
        body: "Génère un dossier (fait email, signaux, cibles de contact) avant d’écrire.",
        href: "#dossier",
        hrefLabel: "Aller au dossier",
      };
    }
    if (!hasContactEmail) {
      return {
        title: "Ajouter un contact",
        body: "Il te faut une adresse avec URL source publique pour le brouillon Gmail.",
        href: "#contacts",
        hrefLabel: "Ajouter un contact",
      };
    }
    if (outreach.length === 0) {
      return {
        title: "Préparer la candidature",
        body: "Une passe prépare l’email et le package à partir du CV et de la banque.",
        href: "#workflow",
        hrefLabel: "Préparer",
      };
    }
    if (!stored?.letter) {
      return {
        title: "Générer le package",
        body: "Lettre, email et checklist à partir d’un fait entreprise que tu formules.",
        href: "#package",
        hrefLabel: "Générer",
      };
    }
    return {
      title: "Prêt à envoyer",
      body: "Package et email sont là. Envoie le formulaire à la main, puis marque comme postulée.",
      href: "#workflow",
      hrefLabel: "Finaliser",
    };
  })();

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
            Une partie du dossier n&apos;a pas pu être chargée ({extrasError}). La candidature reste
            visible.
          </Flash>
        ) : null}
        {sp.built === "1" ? <Flash>Package généré. Relis la lettre avant de l&apos;envoyer.</Flash> : null}
        {sp.researched === "1" ? <Flash>Dossier entreprise mis à jour.</Flash> : null}
        {sp.prepared === "1" ? (
          <Flash>Candidature préparée. L&apos;email attend ton approbation.</Flash>
        ) : null}
        {sp.approved === "draft" ? <Flash>Brouillon créé dans Gmail.</Flash> : null}
        {sp.approved === "sent" ? <Flash>Email envoyé.</Flash> : null}
        {sp.approved === "local" ? (
          <Flash tone="info">
            Approuvé, mais Gmail n&apos;est pas connecté et aucun brouillon n&apos;a été créé. Copie le
            texte ci-dessous, ou connecte Gmail avec <code>npm run gmail:auth</code>.
            {sp.gmailError ? <span className="field-hint">{sp.gmailError}</span> : null}
          </Flash>
        ) : null}
        {sp.applied === "1" ? <Flash>Marquée comme postulée. Relances prévues à J+7 et J+14.</Flash> : null}
        {sp.drafted ? <Flash tone="info">Brouillon créé dans Gmail.</Flash> : null}
        {sp.contact === "1" ? <Flash>Contact enregistré.</Flash> : null}
      </div>

      <section className="next-action" aria-labelledby="next-action-title">
        <p className="next-action-kicker">Prochaine étape</p>
        <h2 id="next-action-title">{nextAction.title}</h2>
        <p className="next-action-body">{nextAction.body}</p>
        <div className="next-action-bar">
          <a href={nextAction.href} className="btn primary">
            {nextAction.hrefLabel}
          </a>
          <ol className="steps next-action-steps">
            {progress.map((p, i) => (
              <li
                key={p.label}
                className={`step${p.done ? " is-done" : ""}${i === currentStep ? " is-current" : ""}`}
              >
                {p.label}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Section title="Préparation" id="workflow">
        <div className="panel">
          {!applied ? (
            <form action={prepareWorkflowAction} className="form-actions">
              <input type="hidden" name="applicationId" value={app.id} />
              <SubmitButton className={outreach.length > 0 ? "" : "primary"} pendingLabel="Préparation…">
                {outreach.length > 0 ? "Refaire la préparation" : "Préparer la candidature"}
              </SubmitButton>
            </form>
          ) : (
            <p className="small muted flush">Préparation terminée pour cette candidature.</p>
          )}
        </div>

        {toApprove ? (
          <form action={approveOutreachAction} className="panel">
            <input type="hidden" name="applicationId" value={app.id} />
            <input type="hidden" name="outreachId" value={outreach[0].id} />
            <div className="panel-head">
              <div>
                <span className="panel-title">Email à approuver</span>
                <span className="cell-sub">Pour {outreach[0].to_email}</span>
              </div>
              <span className="badge yellow">En attente</span>
            </div>
            <pre className="code-block as-text">{`Objet : ${outreach[0].subject}\n\n${outreach[0].body}`}</pre>
            <div className="form-actions">
              <SubmitButton className="primary" pendingLabel="Approbation…">
                Approuver et créer le brouillon
              </SubmitButton>
            </div>
          </form>
        ) : null}

        {approvedLocalOnly ? (
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="panel-title">Email approuvé</span>
                <span className="cell-sub">Pour {outreach[0].to_email}, sans brouillon Gmail</span>
              </div>
            </div>
            <pre className="code-block as-text">{`Objet : ${outreach[0].subject}\n\n${outreach[0].body}`}</pre>
          </div>
        ) : null}

        {canMarkApplied ? (
          <form action={markAppliedAction} className="panel form-actions">
            <input type="hidden" name="applicationId" value={app.id} />
            <SubmitButton className="primary" pendingLabel="Mise à jour…">
              Marquer comme postulée
            </SubmitButton>
            <span className="small muted">Les relances seront prévues à J+7 et J+14.</span>
          </form>
        ) : null}
      </Section>

      <Section title="Fiche" id="fiche">
        <div className="panel">
          <dl className="facts rows">
            <dt>Statut</dt>
            <dd>
              <form action={changeStatus} className="inline">
                <input type="hidden" name="applicationId" value={app.id} />
                <Select
                  name="status"
                  ariaLabel="Changer le statut"
                  defaultValue={app.status}
                  options={APPLICATION_STATUSES.map((s) => ({ value: s, label: APPLICATION_STATUS_FR[s] }))}
                  compact
                />
                <SubmitButton className="small">Mettre à jour</SubmitButton>
              </form>
            </dd>

            <dt>Envoyée le</dt>
            <dd>{day(app.submitted_at)}</dd>

            <dt>Lieu</dt>
            <dd>{place(app.location, app.workplace_type)}</dd>

            <dt>Publiée</dt>
            <dd>{day(app.posted_at)}</dd>

            <dt>Offre</dt>
            <dd>{app.closed_at ? `fermée le ${day(app.closed_at)}` : "ouverte"}</dd>

            <dt>Détectée comme</dt>
            <dd>
              {categories.length ? (
                <span className="tag-list">
                  {categories.map((c) => (
                    <span key={c} className="tag">
                      {ROLE_CATEGORY_LABEL_FR[c] ?? c}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="empty">n/d</span>
              )}
            </dd>

            <dt>CV pour cette offre ({LANG_LABEL_FR[lang]})</dt>
            <dd>
              {resume ? (
                <>
                  <Link href="/resumes">{resume.label}</Link>
                  <span className="cell-sub">{resume.filename}</span>
                  {resume.profile_json?.skills?.length ? (
                    <span className="field-hint">
                      {(resume.profile_json.skills as string[]).slice(0, 12).join(", ")}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="empty">
                  Aucun CV actif. <Link href="/resumes">Ajouter un CV</Link>
                </span>
              )}
            </dd>
          </dl>
        </div>
      </Section>

      <Section title="Dossier entreprise" id="dossier">

        <form action={researchApplicationAction} className="panel form-actions panel-spaced">
          <input type="hidden" name="applicationId" value={app.id} />
          <label className="check">
            <input type="checkbox" name="force" value="1" />
            Forcer une nouvelle recherche
          </label>
          <SubmitButton className="primary" pendingLabel="Recherche…">
            Lancer la recherche
          </SubmitButton>
        </form>

        {dossier ? (
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Résultat de la recherche</span>
              <span className="cluster">
                <span className="badge neutral">confiance {Number(dossier.confidence).toFixed(2)}</span>
                <span className="badge neutral">{dossier.model ?? "heuristique"}</span>
                <span className="badge neutral">{day(dossier.researched_at)}</span>
              </span>
            </div>
            <p>{dossier.summary}</p>
            <div className="dossier-fact">
              <p className="flush">
                <strong>Fait email :</strong> {dossier.company_fact}
              </p>
              <p className="field-hint fact-source">Source : {dossier.company_fact_source}</p>
            </div>

            <h3 className="subhead">Signaux</h3>
            {Array.isArray(dossier.signals) && dossier.signals.length > 0 ? (
              <ul className="stack stack-tight list-pad flush">
                {dossier.signals.map((s, i) => (
                  <li key={`${s.signal}-${i}`} className="small">
                    {s.signal} <span className="muted">({s.source})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty flush">Aucun signal trouvé.</p>
            )}

            <h3 className="subhead">Cibles de contact à chercher</h3>
            {Array.isArray(dossier.contact_targets) && dossier.contact_targets.length > 0 ? (
              <ul className="stack stack-snug list-pad flush">
                {dossier.contact_targets.map((t, i) => (
                  <li key={`${t.role}-${i}`} className="small">
                    <strong>{t.role}</strong> : {t.why}
                    <span className="field-hint">{t.searchHint}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty flush">Aucune cible identifiée.</p>
            )}
          </div>
        ) : (
          <EmptyState title="Aucune recherche pour cette candidature">
            Clique « Lancer la recherche » ci-dessus pour générer un dossier.
          </EmptyState>
        )}
      </Section>

      <Section title="Contacts & outreach Gmail" id="contacts">
        <p className="section-note section-note-pull">
          Brouillons seulement (<code>gmail.compose</code>). Les adresses doivent avoir une{" "}
          <code>source_url</code> publique. Les doublons sont bloqués.
        </p>

        <form action={addContactAction} className="panel">
          <input type="hidden" name="applicationId" value={app.id} />
          <div className="row">
            <div className="field">
              <label htmlFor="name">Nom</label>
              <input id="name" name="name" placeholder="Optionnel" />
            </div>
            <div className="field">
              <label htmlFor="role">Rôle</label>
              <input id="role" name="role" placeholder="Talent Acquisition" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required />
            </div>
            <div className="field">
              <label htmlFor="sourceUrl">Source URL</label>
              <input id="sourceUrl" name="sourceUrl" type="url" required placeholder="https://…" />
            </div>
          </div>
          <div className="form-actions">
            <SubmitButton className="primary" pendingLabel="Ajout…">
              Ajouter le contact
            </SubmitButton>
          </div>
        </form>

        {contacts.length === 0 ? (
          <EmptyState title="Aucun contact pour cette entreprise">
            Ajoute un contact ci-dessus, ou lance la recherche pour trouver des cibles.
          </EmptyState>
        ) : (
          <div className="table-wrap stackable">
            <table>
              <caption className="visually-hidden">Contacts connus pour cette entreprise</caption>
              <thead>
                <tr>
                  <th scope="col">Contact</th>
                  <th scope="col">Email</th>
                  <th scope="col">Source</th>
                  <th scope="col">Brouillon Gmail</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Contact">
                      <span className="cell-main">{c.name ?? "n/d"}</span>
                      <span className="cell-sub">{c.role ?? ""}</span>
                    </td>
                    <td data-label="Email" className="mono">
                      {c.email ?? "n/d"}
                    </td>
                    <td data-label="Source">
                      <ExtLink href={c.source_url}>source</ExtLink>
                    </td>
                    <td data-label="Brouillon Gmail">
                      {c.email ? (
                        <form action={draftOutreachAction} className="inline">
                          <input type="hidden" name="applicationId" value={app.id} />
                          <input type="hidden" name="contactId" value={c.id} />
                          <Select
                            name="kind"
                            ariaLabel="Type d'email"
                            defaultValue="outreach"
                            options={[
                              { value: "outreach", label: "Prise de contact" },
                              { value: "application", label: "Candidature" },
                              { value: "cover", label: "Lettre de motivation" },
                              { value: "followup", label: "Relance" },
                            ]}
                            compact
                          />
                          <SubmitButton className="primary small" pendingLabel="Création…">
                            Créer brouillon
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="empty">pas d&apos;email</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {outreach.length > 0 ? (
          <div className="table-wrap stackable block-spaced">
            <table>
              <caption>Historique outreach</caption>
              <thead>
                <tr>
                  <th scope="col" className="tight">
                    Quand
                  </th>
                  <th scope="col">Type</th>
                  <th scope="col">À</th>
                  <th scope="col">Gmail</th>
                  <th scope="col">Envoyé ?</th>
                </tr>
              </thead>
              <tbody>
                {outreach.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Quand" className="tight num muted">
                      {day(o.created_at)}
                    </td>
                    <td data-label="Type">{OUTREACH_KIND_FR[o.kind] ?? o.kind}</td>
                    <td data-label="À" className="mono">
                      {o.to_email}
                    </td>
                    <td data-label="Gmail">{o.gmail_draft_id ?? "local seulement"}</td>
                    <td data-label="Envoyé ?">
                      {o.sent_detected_at ? (
                        <span className="badge green">détecté {day(o.sent_detected_at)}</span>
                      ) : (
                        <span className="badge yellow">brouillon</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section title="Candidature" id="candidature">
        <div className="panel panel-quiet">
          <p className="small muted block-title-lg">
            L&apos;assist navigateur remplit les champs verts, pré-remplit les jaunes, laisse les
            rouges vides et ne clique jamais sur Envoyer. Marque « postulé » ici une fois le
            formulaire envoyé toi-même.
          </p>
          <pre className="code-block">{`npx tsx scripts/assist-apply.ts --application ${app.id}`}</pre>
        </div>

        <form action={saveApplication} className="panel">
          <input type="hidden" name="applicationId" value={app.id} />
          <div className="row">
            <div className="field">
              <label htmlFor="resumePath">Fichier CV</label>
              <input
                type="text"
                id="resumePath"
                name="resumePath"
                defaultValue={app.resume_path ?? resume?.storage_path ?? ""}
                placeholder="géré via /resumes"
              />
            </div>
            <div className="field">
              <label htmlFor="coverLetterPath">Fichier lettre de motivation</label>
              <input
                type="text"
                id="coverLetterPath"
                name="coverLetterPath"
                defaultValue={app.cover_letter_path ?? ""}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={6} defaultValue={app.notes ?? ""} />
          </div>
          <div className="form-actions">
            <SubmitButton className="primary" pendingLabel="Enregistrement…">
              Enregistrer
            </SubmitButton>
          </div>
        </form>
      </Section>

      <Section title="Package de candidature" id="package">
        <p className="section-note section-note-pull">
          La lettre est remplie uniquement à partir de la banque de réponses, des projets
          sélectionnés et d&apos;un fait entreprise que tu écris avec sa source. Le CV actif ({LANG_LABEL_FR[lang]})
          est joint automatiquement.
        </p>

        <form action={buildPackage} className="panel">
          <input type="hidden" name="applicationId" value={app.id} />
          <div className="field">
            <label htmlFor="companyFact">Fait entreprise (tes mots)</label>
            <textarea
              id="companyFact"
              name="companyFact"
              rows={3}
              required
              defaultValue={stored?.companyFact ?? dossier?.company_fact ?? ""}
              placeholder="Un fait concret et vrai sur cette entreprise, dans tes mots."
            />
          </div>
          <div className="field">
            <label htmlFor="companyFactSource">Source de ce fait</label>
            <input
              type="url"
              id="companyFactSource"
              name="companyFactSource"
              required
              defaultValue={
                stored?.companyFactSource ?? dossier?.company_fact_source ?? app.company_website ?? ""
              }
            />
          </div>
          <div className="field">
            <label htmlFor="lang">Langue de la lettre</label>
            <Select
              id="lang"
              name="lang"
              ariaLabel="Langue de la lettre"
              defaultValue={stored?.lang ?? lang}
              options={[
                { value: "en", label: LANG_LABEL_FR.en },
                { value: "fr", label: LANG_LABEL_FR.fr },
              ]}
            />
          </div>
          <div className="form-actions">
            <SubmitButton className="primary" pendingLabel="Génération…">
              Générer lettre, email et checklist
            </SubmitButton>
          </div>
        </form>

        {stored?.letter ? (
          <>
            {stored.emailBody ? (
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title">
                    Email d&apos;outreach ({LANG_LABEL_FR[stored.lang as "en" | "fr"] ?? stored.lang})
                  </span>
                  <span className="badge neutral">{stored.emailWordCount ?? "?"} mots</span>
                </div>
                <p className="small muted">Brouillon court (Agent 5). Tu envoies toi-même.</p>
                <p className="email-subject">
                  <strong>Objet :</strong> {stored.emailSubject}
                </p>
                <pre className="code-block">{stored.emailBody}</pre>
              </div>
            ) : null}

            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">
                  Brouillon de lettre ({LANG_LABEL_FR[stored.lang as "en" | "fr"] ?? stored.lang})
                </span>
              </div>
              <p className="small muted">
                Projets utilisés : {(stored.projects ?? []).join(", ") || "aucun"}. Fichiers sous{" "}
                <code>{stored.dir}</code>.
              </p>
              <pre className="letter">{stored.letter}</pre>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Vérification des noms propres</span>
              </div>
              {(stored.flags ?? []).length === 0 ? (
                <p className="empty flush">
                  Aucun nom propre hors du texte d&apos;entrée de la lettre.
                </p>
              ) : (
                <ul className="stack stack-tight flush list-plain">
                  {(stored.flags ?? []).map((f) => (
                    <li key={f.word}>
                      <span className="badge red">{f.word}</span> {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="panel panel-last">
              <div className="panel-head">
                <span className="panel-title">Checklist avant envoi</span>
                <span className={`badge ${allClear ? "green" : "red"}`}>
                  {allClear ? "tout est bon" : "à corriger"}
                </span>
              </div>
              <p className="small muted">
                {allClear
                  ? "Tous les contrôles sont passés. C'est toujours toi qui soumets à la main."
                  : "Corrige les contrôles en échec avant de considérer ce package comme prêt."}
              </p>
              <div className="table-wrap stackable">
                <table>
                  <caption className="visually-hidden">Résultat de chaque contrôle avant envoi</caption>
                  <thead>
                    <tr>
                      <th scope="col">Contrôle</th>
                      <th scope="col">Résultat</th>
                      <th scope="col">Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklist.map((c) => (
                      <tr key={c.id}>
                        <td data-label="Contrôle">{c.label}</td>
                        <td data-label="Résultat">
                          <span className={`badge ${c.ok ? "green" : "red"}`}>
                            {c.ok ? "ok" : "échec"}
                          </span>
                        </td>
                        <td data-label="Détail" className="muted">
                          {c.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <EmptyState title="Aucun package pour cette candidature">
            Remplis le fait entreprise ci-dessus et génère la lettre, l&apos;email et la checklist.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Banque de réponses"
        note={`${bankWritten}/${bank.length} prêtes pour ce formulaire`}
        id="banque"
      >
        <Disclosure label={`Afficher les ${bank.length} réponses (${LANG_LABEL_FR[lang]})`}>
          <div className="table-wrap disclosure-table">
            <table>
              <caption className="visually-hidden">Réponses types disponibles pour ce formulaire</caption>
              <thead>
                <tr>
                  <th scope="col">Clé</th>
                  <th scope="col">Comment</th>
                  <th scope="col">Texte ({LANG_LABEL_FR[lang]})</th>
                </tr>
              </thead>
              <tbody>
                {bank.map((a) => (
                  <tr key={a.key}>
                    <td className="mono">{a.key}</td>
                    <td>
                      <span className={`badge ${a.category}`}>
                        {a.mode === "verbatim"
                          ? "coller tel quel"
                          : a.mode === "reword"
                            ? "reformuler"
                            : "à écrire"}
                      </span>
                    </td>
                    <td>
                      {a.mode === "manual" ? (
                        <span className="empty">{a.text ?? "pas de texte, à taper sur le formulaire"}</span>
                      ) : (
                        (a.text ?? <span className="empty">à écrire</span>)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </Section>

      <Section title="Texte de l'offre" id="texte">
        <Disclosure label="Afficher la description de l’offre">
          <div className="panel panel-last">
            {app.description ? (
              <pre className="description">{app.description}</pre>
            ) : (
              <p className="empty flush">Aucune description enregistrée pour cette offre.</p>
            )}
          </div>
        </Disclosure>
      </Section>

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/board">Retour au board</Link>
      </nav>
    </>
  );
}
