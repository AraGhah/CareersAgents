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
import { Flash, SubmitButton } from "../../components/client-ui";
import { DbUnavailable, EmptyState, PageHeader, Section, StatusPill } from "../../components/ui";
import { day, place } from "../../../lib/format";
import { detectCategories } from "../../../lib/category";
import { detectLetterLang } from "../../../lib/letter";
import { loadAnswerBank } from "../../../lib/package";
import { loadStoredPackage } from "../../../lib/package-store";
import { getApplication, listContactsForCompany } from "../../../lib/queries";
import { listOutreachForApplication } from "../../../lib/outreach";
import { getLatestDossier } from "../../../lib/research";
import { resolveResumeForJob } from "../../../lib/resumes";
import { APPLICATION_STATUSES } from "../../../lib/types";
import { APPLICATION_STATUS_FR } from "../../../lib/status-labels";

type Search = {
  built?: string;
  researched?: string;
  drafted?: string;
  contact?: string;
  prepared?: string;
  outreach?: string;
  approved?: string;
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

  let app, lang, categories, bank, stored, dossier, contacts, outreach, resume;
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

  try {
    lang = detectLetterLang(app.title, app.description);
    categories = detectCategories(app.title, app.description);
    bank = await loadAnswerBank(lang);
    stored = await loadStoredPackage(app.cover_letter_path);

    [dossier, contacts, outreach, resume] = await Promise.all([
      getLatestDossier(app.company_id, app.id),
      listContactsForCompany(app.company_id),
      listOutreachForApplication(app.id),
      resolveResumeForJob(lang),
    ]);
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Candidature" title="Dossier de candidature" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const checklist = stored?.checklist ?? [];
  const allClear = checklist.length > 0 && checklist.every((c) => c.ok);
  const toApprove = outreach.length > 0 && !outreach[0].approved_at && !outreach[0].gmail_draft_id;
  const canMarkApplied = app.status === "ready" || outreach.some((o) => o.approved_at && !o.sent_at);
  const bankWritten = bank.filter((a) => a.mode !== "manual" && a.text).length;

  return (
    <>
      <PageHeader
        eyebrow={app.company_name}
        title={app.title}
        lede={
          <>
            {place(app.location, app.workplace_type)}
            {" — "}
            <a href={app.url} target="_blank" rel="noreferrer">
              voir l&apos;offre
            </a>
            {app.company_website ? (
              <>
                {" · "}
                <a href={app.company_website} target="_blank" rel="noreferrer">
                  site de l&apos;entreprise
                </a>
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

      <div className="stack" style={{ gap: "var(--s-2)", marginBottom: "var(--s-4)" }}>
        {sp.built === "1" ? (
          <Flash>Package écrit. Relis la lettre et la checklist avant de soumettre quoi que ce soit.</Flash>
        ) : null}
        {sp.researched === "1" ? <Flash>Dossier entreprise mis à jour.</Flash> : null}
        {sp.prepared === "1" ? (
          <Flash>
            Workflow assisté prêt (recherche + contact + email). Approuve avant l&apos;envoi Gmail.
          </Flash>
        ) : null}
        {sp.approved === "draft" ? (
          <Flash>Approuvé : brouillon créé dans Gmail (ara.ghahramanyan07@gmail.com).</Flash>
        ) : null}
        {sp.approved === "sent" ? <Flash>Approuvé et envoyé via Gmail.</Flash> : null}
        {sp.applied === "1" ? <Flash>Marqué postulé — relances planifiées.</Flash> : null}
        {sp.drafted ? <Flash tone="info">Brouillon Gmail créé (tu envoies toi-même).</Flash> : null}
        {sp.contact === "1" ? <Flash>Contact enregistré.</Flash> : null}
      </div>

      <Section n="01" title="Workflow assisté" note="Dossier complet" id="workflow">
        <div className="panel">
          <ol className="steps" style={{ marginBottom: "var(--s-5)" }}>
            <li className="step is-done">Find</li>
            <li className="step is-done">Match CV</li>
            <li className="step">Research company</li>
            <li className="step">Recruiter / email public</li>
            <li className="step">Email personnalisé</li>
            <li className="step is-current">Ton approbation</li>
            <li className="step">Gmail → suivi</li>
          </ol>

          <form action={prepareWorkflowAction} className="form-actions">
            <input type="hidden" name="applicationId" value={app.id} />
            <SubmitButton className="primary" pendingLabel="Préparation…">
              Préparer (recherche + email)
            </SubmitButton>
            <span className="small muted grow">
              Recherche l&apos;entreprise, trouve un contact, rédige l&apos;email — s&apos;arrête
              avant tout envoi.
            </span>
          </form>
        </div>

        {toApprove ? (
          <form action={approveOutreachAction} className="panel" style={{ borderColor: "var(--amber-line)" }}>
            <input type="hidden" name="applicationId" value={app.id} />
            <input type="hidden" name="outreachId" value={outreach[0].id} />
            <div className="panel-head">
              <span className="panel-title">À approuver → {outreach[0].to_email}</span>
              <span className="badge yellow">en attente</span>
            </div>
            <pre className="code-block">{`Objet : ${outreach[0].subject}\n\n${outreach[0].body}`}</pre>
            <div className="form-actions">
              <SubmitButton className="primary" pendingLabel="Approbation…">
                Approuver → brouillon Gmail
              </SubmitButton>
              <p className="field-hint" style={{ margin: 0 }}>
                Mode assisté : rien n&apos;est envoyé tant que tu n&apos;as pas approuvé.
                L&apos;envoi direct nécessite <code>GMAIL_ALLOW_SEND=true</code> + scope{" "}
                <code>gmail.send</code>.
              </p>
            </div>
          </form>
        ) : null}

        {canMarkApplied ? (
          <form action={markAppliedAction} className="panel panel-quiet form-actions" style={{ marginBottom: 0 }}>
            <input type="hidden" name="applicationId" value={app.id} />
            <SubmitButton className="primary" pendingLabel="Mise à jour…">
              J&apos;ai envoyé dans Gmail → marquer postulé
            </SubmitButton>
            <span className="small muted grow">Déclenche le suivi des relances (jour 7, jour 14).</span>
          </form>
        ) : null}
      </Section>

      <Section n="02" title="Fiche" id="fiche">
        <div className="panel">
          <dl className="facts rows">
            <dt>Statut</dt>
            <dd>
              <form action={changeStatus} className="inline">
                <input type="hidden" name="applicationId" value={app.id} />
                <select name="status" defaultValue={app.status} aria-label="Changer le statut">
                  {APPLICATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {APPLICATION_STATUS_FR[s]}
                    </option>
                  ))}
                </select>
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
                      {c}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="empty">—</span>
              )}
            </dd>

            <dt>CV pour cette offre ({lang})</dt>
            <dd>
              {resume ? (
                <>
                  <span className="badge green">{resume.label}</span>{" "}
                  <Link href="/resumes">{resume.storage_path}</Link>
                  {resume.profile_json?.skills?.length ? (
                    <span className="field-hint">
                      {(resume.profile_json.skills as string[]).slice(0, 12).join(", ")}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="empty">
                  Aucun CV actif — <Link href="/resumes">uploader un CV</Link>
                </span>
              )}
            </dd>
          </dl>
        </div>
      </Section>

      <Section n="03" title="Dossier entreprise" note="Preframe" id="dossier">
        <p className="section-note" style={{ marginTop: "calc(var(--s-4) * -1)", marginBottom: "var(--s-4)" }}>
          Recherche le site et l&apos;offre, produit un fait sourcé et des cibles de contact. Aucun
          email inventé. Claude enrichit si <code>ANTHROPIC_API_KEY</code> est défini.
        </p>

        <form action={researchApplicationAction} className="panel form-actions" style={{ marginBottom: "var(--s-5)" }}>
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
            <div className="kv" style={{ display: "block", border: 0, padding: 0 }}>
              <p style={{ margin: 0 }}>
                <strong>Fait email :</strong> {dossier.company_fact}
              </p>
              <p className="field-hint" style={{ marginTop: "0.2rem" }}>
                Source : {dossier.company_fact_source}
              </p>
            </div>

            <h3 style={{ marginTop: "var(--s-5)", marginBottom: "var(--s-2)" }}>Signaux</h3>
            {Array.isArray(dossier.signals) && dossier.signals.length > 0 ? (
              <ul className="stack" style={{ gap: "var(--s-1)", margin: 0, paddingLeft: "1.1rem" }}>
                {dossier.signals.map((s, i) => (
                  <li key={`${s.signal}-${i}`} className="small">
                    {s.signal} <span className="muted">({s.source})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty" style={{ margin: 0 }}>
                Aucun signal trouvé.
              </p>
            )}

            <h3 style={{ marginTop: "var(--s-5)", marginBottom: "var(--s-2)" }}>
              Cibles de contact à chercher
            </h3>
            {Array.isArray(dossier.contact_targets) && dossier.contact_targets.length > 0 ? (
              <ul className="stack" style={{ gap: "var(--s-3)", margin: 0, paddingLeft: "1.1rem" }}>
                {dossier.contact_targets.map((t, i) => (
                  <li key={`${t.role}-${i}`} className="small">
                    <strong>{t.role}</strong> — {t.why}
                    <span className="field-hint">{t.searchHint}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty" style={{ margin: 0 }}>
                Aucune cible identifiée.
              </p>
            )}
          </div>
        ) : (
          <EmptyState mark="Pas de dossier" title="Aucune recherche pour cette candidature">
            Clique « Lancer la recherche » ci-dessus pour générer un dossier.
          </EmptyState>
        )}
      </Section>

      <Section n="04" title="Contacts & outreach Gmail" id="contacts">
        <p className="section-note" style={{ marginTop: "calc(var(--s-4) * -1)", marginBottom: "var(--s-4)" }}>
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
          <EmptyState mark="Aucun contact" title="Aucun contact pour cette entreprise">
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
                      <span className="cell-main">{c.name ?? "—"}</span>
                      <span className="cell-sub">{c.role ?? ""}</span>
                    </td>
                    <td data-label="Email" className="mono">
                      {c.email ?? "—"}
                    </td>
                    <td data-label="Source">
                      <a href={c.source_url} target="_blank" rel="noreferrer">
                        source
                      </a>
                    </td>
                    <td data-label="Brouillon Gmail">
                      {c.email ? (
                        <form action={draftOutreachAction} className="inline">
                          <input type="hidden" name="applicationId" value={app.id} />
                          <input type="hidden" name="contactId" value={c.id} />
                          <select name="kind" defaultValue="outreach" aria-label="Type d'email">
                            <option value="outreach">Prise de contact</option>
                            <option value="application">Candidature</option>
                            <option value="cover">Lettre de motivation</option>
                            <option value="followup">Relance</option>
                          </select>
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
          <div className="table-wrap stackable" style={{ marginTop: "var(--s-4)" }}>
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

      <Section n="05" title="Candidature" note="Fichiers, notes et envoi manuel" id="candidature">
        <div className="panel panel-quiet">
          <p className="small muted" style={{ marginBottom: "var(--s-3)" }}>
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

      <Section n="06" title="Package de candidature" id="package">
        <p className="section-note" style={{ marginTop: "calc(var(--s-4) * -1)", marginBottom: "var(--s-4)" }}>
          La lettre est remplie uniquement à partir de la banque de réponses, des projets
          sélectionnés et d&apos;un fait entreprise que tu écris avec sa source. Le CV actif ({lang})
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
            <select id="lang" name="lang" defaultValue={stored?.lang ?? lang}>
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
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
                  <span className="panel-title">Email d&apos;outreach ({stored.lang})</span>
                  <span className="badge neutral">{stored.emailWordCount ?? "?"} mots</span>
                </div>
                <p className="small muted">Brouillon court (Agent 5). Tu envoies toi-même.</p>
                <p style={{ marginBottom: "0.4rem" }}>
                  <strong>Objet :</strong> {stored.emailSubject}
                </p>
                <pre className="code-block">{stored.emailBody}</pre>
              </div>
            ) : null}

            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Brouillon de lettre ({stored.lang})</span>
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
                <p className="empty" style={{ margin: 0 }}>
                  Aucun nom propre hors du texte d&apos;entrée de la lettre.
                </p>
              ) : (
                <ul className="stack" style={{ gap: "var(--s-2)", margin: 0, padding: 0, listStyle: "none" }}>
                  {(stored.flags ?? []).map((f) => (
                    <li key={f.word}>
                      <span className="badge red">{f.word}</span> {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="panel" style={{ marginBottom: 0 }}>
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
          <EmptyState mark="Pas encore généré" title="Aucun package pour cette candidature">
            Remplis le fait entreprise ci-dessus et génère la lettre, l&apos;email et la checklist.
          </EmptyState>
        )}
      </Section>

      <Section
        n="07"
        title="Banque de réponses"
        note={`${bankWritten}/${bank.length} prêtes pour ce formulaire`}
        id="banque"
      >
        <details className="panel" style={{ padding: 0 }}>
          <summary
            className="small"
            style={{ cursor: "pointer", padding: "var(--s-4) var(--s-5)", fontWeight: 500 }}
          >
            Afficher les {bank.length} réponses ({lang})
          </summary>
          <div className="table-wrap" style={{ border: 0, borderTop: "1px solid var(--line)", borderRadius: 0 }}>
            <table>
              <caption className="visually-hidden">Réponses types disponibles pour ce formulaire</caption>
              <thead>
                <tr>
                  <th scope="col">Clé</th>
                  <th scope="col">Comment</th>
                  <th scope="col">Texte ({lang})</th>
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
                        <span className="empty">{a.text ?? "pas de texte — à taper sur le formulaire"}</span>
                      ) : (
                        (a.text ?? <span className="empty">à écrire</span>)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Section>

      <Section n="08" title="Texte de l'offre" id="texte">
        <div className="panel">
          {app.description ? (
            <pre className="description">{app.description}</pre>
          ) : (
            <p className="empty" style={{ margin: 0 }}>
              Aucune description enregistrée pour cette offre.
            </p>
          )}
        </div>
      </Section>

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/board">Retour au board</Link>
      </nav>
    </>
  );
}
