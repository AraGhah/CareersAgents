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

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const app = await getApplication(id);
  if (!app) notFound();

  const lang = detectLetterLang(app.title, app.description);
  const categories = detectCategories(app.title, app.description);
  const bank = await loadAnswerBank(lang);
  const stored = await loadStoredPackage(app.cover_letter_path);
  const checklist = stored?.checklist ?? [];
  const allClear = checklist.length > 0 && checklist.every((c) => c.ok);

  const [dossier, contacts, outreach, resume] = await Promise.all([
    getLatestDossier(app.company_id, app.id),
    listContactsForCompany(app.company_id),
    listOutreachForApplication(app.id),
    resolveResumeForJob(lang),
  ]);

  return (
    <>
      <h1>{app.title}</h1>
      <p className="lede">
        {app.company_name}
        {app.company_city ? ` \u00b7 ${app.company_city}` : ""}
        {" \u2014 "}
        <a href={app.url} target="_blank" rel="noreferrer">
          the posting
        </a>
        {app.company_website ? (
          <>
            {" \u00b7 "}
            <a href={app.company_website} target="_blank" rel="noreferrer">
              company site
            </a>
          </>
        ) : null}
      </p>

      {sp.built === "1" ? (
        <p className="lede">Package written. Read the letter and the checklist before you submit anything.</p>
      ) : null}
      {sp.researched === "1" ? <p className="lede">Dossier entreprise mis à jour.</p> : null}
      {sp.prepared === "1" ? (
        <p className="lede">
          Workflow assisté prêt (recherche + contact + email). Approuve avant envoi Gmail.
        </p>
      ) : null}
      {sp.approved === "draft" ? (
        <p className="lede">Approuvé : brouillon créé dans Gmail (ara.ghahramanyan07@gmail.com).</p>
      ) : null}
      {sp.approved === "sent" ? <p className="lede">Approuvé et envoyé via Gmail.</p> : null}
      {sp.applied === "1" ? <p className="lede">Marqué postulé — relances planifiées.</p> : null}
      {sp.drafted ? <p className="lede">Brouillon Gmail créé (tu envoies toi-même).</p> : null}
      {sp.contact === "1" ? <p className="lede">Contact enregistré.</p> : null}

      <h2>Workflow assisté (Dossier)</h2>
      <p className="lede">
        Find → Match CV → Research company → Recruiter/email public → Email personnalisé →{" "}
        <strong>ton approbation</strong> → Gmail → suivi.
      </p>
      <form action={prepareWorkflowAction} className="panel filters">
        <input type="hidden" name="applicationId" value={app.id} />
        <button type="submit" className="primary">
          Préparer (recherche + email)
        </button>
      </form>

      {outreach.length > 0 && !outreach[0].approved_at && !outreach[0].gmail_draft_id ? (
        <form action={approveOutreachAction} className="panel">
          <input type="hidden" name="applicationId" value={app.id} />
          <input type="hidden" name="outreachId" value={outreach[0].id} />
          <p>
            <strong>À approuver →</strong> {outreach[0].to_email}
          </p>
          <pre className="description">{`Subject: ${outreach[0].subject}\n\n${outreach[0].body}`}</pre>
          <div className="filters">
            <button type="submit" className="primary">
              Approuver → brouillon Gmail
            </button>
          </div>
          <p className="empty">
            Assisted Mode : rien n&apos;est envoyé tant que tu n&apos;as pas approuvé. L&apos;envoi
            direct nécessite GMAIL_ALLOW_SEND=true + scope gmail.send.
          </p>
        </form>
      ) : null}

      {app.status === "ready" || outreach.some((o) => o.approved_at && !o.sent_at) ? (
        <form action={markAppliedAction} className="filters">
          <input type="hidden" name="applicationId" value={app.id} />
          <button type="submit">J&apos;ai envoyé dans Gmail → marquer postulé</button>
        </form>
      ) : null}

      <div className="panel">
        <dl className="facts">
          <dt>Status</dt>
          <dd>
            <form action={changeStatus} className="filters" style={{ marginBottom: 0 }}>
              <input type="hidden" name="applicationId" value={app.id} />
              <select name="status" defaultValue={app.status}>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button type="submit">Update</button>
            </form>
          </dd>

          <dt>Submitted</dt>
          <dd>{day(app.submitted_at)}</dd>

          <dt>Where</dt>
          <dd>{place(app.location, app.workplace_type)}</dd>

          <dt>Posted</dt>
          <dd>{day(app.posted_at)}</dd>

          <dt>Posting</dt>
          <dd>{app.closed_at ? `closed ${day(app.closed_at)}` : "open"}</dd>

          <dt>Detected as</dt>
          <dd>{categories.join(", ")}</dd>

          <dt>CV pour cette offre ({lang})</dt>
          <dd>
            {resume ? (
              <>
                <span className="badge green">{resume.label}</span>{" "}
                <Link href="/resumes">{resume.storage_path}</Link>
                {resume.profile_json?.skills?.length ? (
                  <div className="empty" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                    {(resume.profile_json.skills as string[]).slice(0, 12).join(", ")}
                  </div>
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

      <h2>Dossier entreprise (Preframe)</h2>
      <p className="lede">
        Recherche le site + l&apos;offre, produit un fait sourcé et des cibles de contact. Aucun email
        inventé. Claude enrichit si <code>ANTHROPIC_API_KEY</code> est défini.
      </p>
      <form action={researchApplicationAction} className="panel filters">
        <input type="hidden" name="applicationId" value={app.id} />
        <label>
          <input type="checkbox" name="force" value="1" /> Forcer une nouvelle recherche
        </label>
        <button type="submit" className="primary">
          Lancer la recherche
        </button>
      </form>

      {dossier ? (
        <div className="panel">
          <p>
            <strong>Confiance :</strong> {Number(dossier.confidence).toFixed(2)} ·{" "}
            <strong>Modèle :</strong> {dossier.model ?? "heuristic"} ·{" "}
            <strong>Le :</strong> {day(dossier.researched_at)}
          </p>
          <p>{dossier.summary}</p>
          <p>
            <strong>Fait email :</strong> {dossier.company_fact}
            <br />
            <span className="empty">Source : {dossier.company_fact_source}</span>
          </p>
          <h3>Signaux</h3>
          <ul>
            {(Array.isArray(dossier.signals) ? dossier.signals : []).map((s, i) => (
              <li key={`${s.signal}-${i}`}>
                {s.signal}{" "}
                <span className="empty">({s.source})</span>
              </li>
            ))}
          </ul>
          <h3>Cibles de contact à chercher</h3>
          <ul>
            {(Array.isArray(dossier.contact_targets) ? dossier.contact_targets : []).map((t, i) => (
              <li key={`${t.role}-${i}`}>
                <strong>{t.role}</strong> — {t.why}
                <div className="empty">{t.searchHint}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="empty">Pas encore de dossier pour cette candidature.</p>
      )}

      <h2>Contacts &amp; outreach Gmail</h2>
      <p className="lede">
        Broullons seulement (<code>gmail.compose</code>). Les adresses doivent avoir un{" "}
        <code>source_url</code> public. Les doublons sont bloqués.
      </p>

      <form action={addContactAction} className="panel">
        <input type="hidden" name="applicationId" value={app.id} />
        <div className="row">
          <div className="field">
            <label htmlFor="name">Nom</label>
            <input id="name" name="name" placeholder="Optional" />
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
            <input id="sourceUrl" name="sourceUrl" type="url" required placeholder="https://..." />
          </div>
        </div>
        <button type="submit">Ajouter le contact</button>
      </form>

      {contacts.length === 0 ? (
        <p className="empty">Aucun contact pour cette entreprise.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Contact</th>
              <th>Email</th>
              <th>Source</th>
              <th>Draft Gmail</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name ?? "—"}
                  <div className="empty">{c.role ?? ""}</div>
                </td>
                <td>{c.email ?? "—"}</td>
                <td>
                  <a href={c.source_url} target="_blank" rel="noreferrer">
                    source
                  </a>
                </td>
                <td>
                  {c.email ? (
                    <form action={draftOutreachAction} className="filters" style={{ margin: 0 }}>
                      <input type="hidden" name="applicationId" value={app.id} />
                      <input type="hidden" name="contactId" value={c.id} />
                      <select name="kind" defaultValue="outreach">
                        <option value="outreach">Outreach</option>
                        <option value="application">Application</option>
                        <option value="cover">Cover letter email</option>
                        <option value="followup">Follow-up</option>
                      </select>
                      <button type="submit" className="primary">
                        Créer brouillon
                      </button>
                    </form>
                  ) : (
                    <span className="empty">pas d&apos;email</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {outreach.length > 0 ? (
        <>
          <h3>Historique outreach</h3>
          <table>
            <thead>
              <tr>
                <th>Quand</th>
                <th>Type</th>
                <th>À</th>
                <th>Gmail</th>
                <th>Envoyé?</th>
              </tr>
            </thead>
            <tbody>
              {outreach.map((o) => (
                <tr key={o.id}>
                  <td>{day(o.created_at)}</td>
                  <td>{o.kind}</td>
                  <td>{o.to_email}</td>
                  <td>{o.gmail_draft_id ?? "local only"}</td>
                  <td>
                    {o.sent_detected_at ? (
                      <span className="badge green">détecté {day(o.sent_detected_at)}</span>
                    ) : (
                      <span className="badge">brouillon</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <div className="panel">
        <p className="lede" style={{ marginBottom: "0.5rem" }}>
          Browser assist fills green fields, pre-fills yellow ones, leaves red empty, and never
          clicks Submit. Mark submitted here after you send the form yourself.
        </p>
        <pre className="description">{`npx tsx scripts/assist-apply.ts --application ${app.id}`}</pre>
      </div>

      <form action={saveApplication} className="panel">
        <input type="hidden" name="applicationId" value={app.id} />
        <div className="row">
          <div className="field">
            <label htmlFor="resumePath">Resume file</label>
            <input
              type="text"
              id="resumePath"
              name="resumePath"
              defaultValue={app.resume_path ?? resume?.storage_path ?? ""}
              placeholder="managed via /resumes"
            />
          </div>
          <div className="field">
            <label htmlFor="coverLetterPath">Cover letter file</label>
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
        <button type="submit" className="primary">
          Save
        </button>
      </form>

      <h2>Application package</h2>
      <p className="lede">
        The letter is filled only from the answer bank, the selected projects, and a company fact you
        write with its source URL. Green answers paste as-is. Yellow ones you reword yourself. Red
        ones stay empty until you type them. Le CV actif ({lang}) est attaché automatiquement.
      </p>

      <form action={buildPackage} className="panel">
        <input type="hidden" name="applicationId" value={app.id} />
        <div className="field">
          <label htmlFor="companyFact">Company fact (your words)</label>
          <textarea
            id="companyFact"
            name="companyFact"
            rows={3}
            required
            defaultValue={stored?.companyFact ?? dossier?.company_fact ?? ""}
            placeholder="One concrete fact about this company that is true and yours."
          />
        </div>
        <div className="field">
          <label htmlFor="companyFactSource">Source URL for that fact</label>
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
          <label htmlFor="lang">Letter language</label>
          <select id="lang" name="lang" defaultValue={stored?.lang ?? lang}>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
        </div>
        <button type="submit" className="primary">
          Build letter, email and checklist
        </button>
      </form>

      {stored?.letter ? (
        <>
          {stored.emailBody ? (
            <>
              <h2>Outreach email ({stored.lang})</h2>
              <p className="lede">
                Brouillon court (Agent 5). {stored.emailWordCount ?? "?"} mots. Tu envoies toi-même.
              </p>
              <div className="panel">
                <p>
                  <strong>Objet :</strong> {stored.emailSubject}
                </p>
                <pre className="description">{stored.emailBody}</pre>
              </div>
            </>
          ) : null}

          <h2>Draft letter ({stored.lang})</h2>
          <p className="lede">
            Projects used: {(stored.projects ?? []).join(", ") || "none"}. Files under{" "}
            <code>{stored.dir}</code>.
          </p>
          <div className="panel">
            <pre className="description">{stored.letter}</pre>
          </div>

          <h2>Noun check</h2>
          {(stored.flags ?? []).length === 0 ? (
            <p className="empty">No proper noun outside the letter input.</p>
          ) : (
            <ul>
              {(stored.flags ?? []).map((f) => (
                <li key={f.word}>
                  <span className="badge red">{f.word}</span> {f.reason}
                </li>
              ))}
            </ul>
          )}

          <h2>Pre-submit checklist</h2>
          <p className="lede">
            {allClear
              ? "Every check passed. You still submit by hand."
              : "Fix the failed checks before you treat this package as ready."}
          </p>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Result</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {checklist.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    <span className={`badge ${c.ok ? "green" : "red"}`}>{c.ok ? "ok" : "fail"}</span>
                  </td>
                  <td>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Answer bank for this form</h2>
      <p className="lede">
        Lookup first. Green goes in unchanged. Yellow is a starting point you rewrite for this
        posting. Red is shown so you remember the topic, then you type the answer yourself.
      </p>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>How</th>
            <th>Text ({lang})</th>
          </tr>
        </thead>
        <tbody>
          {bank.map((a) => (
            <tr key={a.key}>
              <td>{a.key}</td>
              <td>
                <span className={`badge ${a.category}`}>
                  {a.mode === "verbatim"
                    ? "paste as-is"
                    : a.mode === "reword"
                      ? "reword yourself"
                      : "type yourself"}
                </span>
              </td>
              <td>
                {a.mode === "manual" ? (
                  <span className="empty">{a.text ?? "no stored text — type it on the form"}</span>
                ) : (
                  (a.text ?? <span className="empty">to write</span>)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Posting text</h2>
      <div className="panel">
        {app.description ? (
          <pre className="description">{app.description}</pre>
        ) : (
          <p className="empty">No description stored for this one.</p>
        )}
      </div>

      <p>
        <Link href="/board">Back to the board</Link>
      </p>
    </>
  );
}
