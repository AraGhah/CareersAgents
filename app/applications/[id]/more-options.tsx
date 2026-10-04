import Link from "next/link";
import {
  addContactAction,
  approveOutreachAction,
  changeStatus,
  draftOutreachAction,
  markAppliedAction,
  prepareWorkflowAction,
  researchApplicationAction,
  saveApplication,
} from "../../actions";
import { Select, SubmitButton } from "../../components/client-ui";
import { Disclosure } from "../../components/disclosure";
import { EmptyState, ExtLink, Section } from "../../components/ui";
import type { RoleCategory } from "../../../lib/category";
import { day, place } from "../../../lib/format";
import type { MatchedAnswer } from "../../../lib/letter";
import type { OutreachDraftRow } from "../../../lib/outreach";
import type { listContactsForCompany } from "../../../lib/queries";
import type { CompanyDossier } from "../../../lib/research";
import type { resolveResumeForJob } from "../../../lib/resumes";
import { APPLICATION_STATUSES, type ApplicationDetail } from "../../../lib/types";
import { APPLICATION_STATUS_FR, LANG_LABEL_FR, ROLE_CATEGORY_LABEL_FR } from "../../../lib/status-labels";

type Contacts = Awaited<ReturnType<typeof listContactsForCompany>>;
type Resume = Awaited<ReturnType<typeof resolveResumeForJob>>;

const OUTREACH_KIND_FR: Record<string, string> = {
  outreach: "Prise de contact",
  application: "Candidature",
  cover: "Lettre de motivation",
  followup: "Relance",
};

/**
 * Everything that is not the three main steps, folded away: notes and status, company
 * research, contacts and the Gmail-API drafts (which need `npm run gmail:auth`), the
 * employer-form helper with the answer bank, and the posting text.
 */
export function MoreOptions({
  app,
  lang,
  categories,
  resume,
  dossier,
  contacts,
  outreach,
  bank,
  applied,
}: {
  app: ApplicationDetail;
  lang: "en" | "fr";
  categories: RoleCategory[];
  resume: Resume;
  dossier: CompanyDossier | null;
  contacts: Contacts;
  outreach: OutreachDraftRow[];
  bank: MatchedAnswer[];
  applied: boolean;
}) {
  const toApprove = outreach.length > 0 && !outreach[0].approved_at && !outreach[0].gmail_draft_id;
  const approvedLocalOnly =
    outreach.length > 0 && Boolean(outreach[0].approved_at) && !outreach[0].gmail_draft_id;
  const canMarkApplied = app.status === "ready" || outreach.some((o) => o.approved_at && !o.sent_at);
  const bankWritten = bank.filter((a) => a.mode !== "manual" && a.text).length;

  return (
    <Section title="Plus d’options" id="plus" note="Rien ici n’est nécessaire pour envoyer la candidature.">
      <div className="more-options">
        <Disclosure label="Notes, statut et infos sur l’offre">
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
                  </>
                ) : (
                  <span className="empty">
                    Aucun CV actif. <Link href="/resumes">Ajouter un CV</Link>
                  </span>
                )}
              </dd>
            </dl>
          </div>

          <form action={saveApplication} className="panel">
            <input type="hidden" name="applicationId" value={app.id} />
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" rows={5} defaultValue={app.notes ?? ""} />
            </div>
            <div className="form-actions">
              <SubmitButton className="primary" pendingLabel="Enregistrement…">
                Enregistrer les notes
              </SubmitButton>
            </div>
          </form>
        </Disclosure>

        <Disclosure label={dossier ? "Recherche sur l’entreprise" : "Recherche sur l’entreprise (pas encore faite)"}>
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
                  <span className="badge neutral">{day(dossier.researched_at)}</span>
                </span>
              </div>
              <p>{dossier.summary}</p>
              <div className="dossier-fact">
                <p className="flush">
                  <strong>Fait trouvé :</strong> {dossier.company_fact}
                </p>
                <p className="field-hint fact-source">Source : {dossier.company_fact_source}</p>
              </div>

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
              Ce n’est pas obligatoire : la lettre fonctionne sans.
            </EmptyState>
          )}
        </Disclosure>

        <Disclosure label="Contacts et brouillons Gmail par l’API (avancé)">
          <p className="section-note section-note-pull">
            Optionnel : demande <code>npm run gmail:auth</code>. Le bouton « Ouvrir dans Gmail » de l’étape 3 suffit
            pour envoyer. Les adresses doivent avoir une <code>source_url</code> publique.
          </p>

          {!applied ? (
            <form action={prepareWorkflowAction} className="panel form-actions">
              <input type="hidden" name="applicationId" value={app.id} />
              <SubmitButton className={outreach.length > 0 ? "" : "primary"} pendingLabel="Préparation…">
                {outreach.length > 0 ? "Refaire la préparation" : "Préparer recherche, contact et brouillon"}
              </SubmitButton>
            </form>
          ) : null}

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
            </form>
          ) : null}

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
              Ajoute un contact ci-dessus.
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
                <caption>Historique des emails</caption>
                <thead>
                  <tr>
                    <th scope="col" className="tight">
                      Quand
                    </th>
                    <th scope="col">Type</th>
                    <th scope="col">À</th>
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
        </Disclosure>

        <Disclosure label={`Remplir le formulaire de l’employeur (${bankWritten}/${bank.length} réponses prêtes)`}>
          <div className="panel panel-quiet">
            <p className="small muted block-title-lg">
              L&apos;assistant navigateur remplit les champs verts, pré-remplit les jaunes, laisse les rouges vides et
              ne clique jamais sur Envoyer.
            </p>
            <pre className="code-block">{`npx tsx scripts/assist-apply.ts --application ${app.id}`}</pre>
          </div>
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
                        {a.mode === "verbatim" ? "coller tel quel" : a.mode === "reword" ? "reformuler" : "à écrire"}
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

        <Disclosure label="Texte de l’offre">
          <div className="panel panel-last">
            {app.description ? (
              <pre className="description">{app.description}</pre>
            ) : (
              <p className="empty flush">Aucune description enregistrée pour cette offre.</p>
            )}
          </div>
        </Disclosure>
      </div>
    </Section>
  );
}
