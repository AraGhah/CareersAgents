import Link from "next/link";
import {
  activateResumeAction,
  reanalyzeResumeAction,
  replaceResumeAction,
  uploadResumeAction,
} from "../actions";
import { Flash, SubmitButton } from "../components/client-ui";
import { DbUnavailable, EmptyState, PageHeader, Section, Stat, TableWrap } from "../components/ui";
import { day } from "../../lib/format";
import { listResumes } from "../../lib/resumes";

type Search = { ok?: string; id?: string };

export const metadata = { title: "CV" };

const OK_MESSAGE: Record<string, string> = {
  uploaded: "CV enregistré et analysé.",
  activated: "CV actif mis à jour.",
  analyzed: "Profil réanalysé.",
  replaced: "CV remplacé et réanalysé.",
};

export default async function ResumesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  let resumes;
  try {
    resumes = await listResumes();
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Profil" title="CV" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }
  const activeEn = resumes.find((r) => r.language === "en" && r.is_active);
  const activeFr = resumes.find((r) => r.language === "fr" && r.is_active);
  const activeSkills = activeEn?.profile_json?.skills ?? activeFr?.profile_json?.skills ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Profil"
        title="CV"
        lede="Les CV actifs pilotent le matching, le package de candidature et la langue des emails. Rien n'est codé en dur : uploade, active, remplace — le profil est réanalysé automatiquement."
      />

      {sp.ok && OK_MESSAGE[sp.ok] ? <Flash>{OK_MESSAGE[sp.ok]}</Flash> : null}

      <div className="stats">
        <Stat
          value={activeEn ? "EN" : "—"}
          label={activeEn?.label ?? "Aucun CV anglais actif"}
          tone={activeEn ? "good" : "alert"}
        />
        <Stat
          value={activeFr ? "FR" : "—"}
          label={activeFr?.label ?? "Aucun CV français actif"}
          tone={activeFr ? "good" : "alert"}
        />
        <Stat value={activeSkills.length} label="Compétences extraites" />
        <Stat value={resumes.length} label="CV dans la bibliothèque" />
      </div>

      <Section n="01" title="Uploader un CV" id="upload">
        <form action={uploadResumeAction} className="panel">
          <div className="row">
            <div className="field">
              <label htmlFor="language">Langue</label>
              <select id="language" name="language" required defaultValue="en">
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="label">Libellé</label>
              <input id="label" name="label" placeholder="Full-Stack EN" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="file">Fichier PDF</label>
            <input id="file" name="file" type="file" accept="application/pdf,.pdf" required />
          </div>

          <label className="check-plain">
            <input type="checkbox" name="activate" value="on" defaultChecked />
            Activer pour les candidatures de cette langue
          </label>

          <div className="form-actions">
            <SubmitButton className="primary" pendingLabel="Analyse en cours…">
              Uploader et analyser
            </SubmitButton>
          </div>
        </form>
      </Section>

      <Section n="02" title="Bibliothèque" note={`${resumes.length} CV`} id="bibliotheque">
        {resumes.length === 0 ? (
          <EmptyState mark="Vide" title="Aucun CV importé">
            Importe d&apos;abord tes PDF, ou lance <code>npm run resumes:import</code>.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">
                Bibliothèque des CV, avec leur langue, état d&apos;analyse et actions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Langue</th>
                  <th scope="col">Libellé</th>
                  <th scope="col">Actif</th>
                  <th scope="col">Analyse</th>
                  <th scope="col">Compétences</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {resumes.map((r) => {
                  const skills = r.profile_json?.skills ?? [];
                  return (
                    <tr key={r.id}>
                      <td data-label="Langue" className="mono">
                        {r.language.toUpperCase()}
                      </td>
                      <td data-label="Libellé">
                        <span className="cell-main">{r.label}</span>
                        <span className="cell-sub">
                          {r.filename} · {day(r.uploaded_at)}
                        </span>
                      </td>
                      <td data-label="Actif">
                        {r.is_active ? (
                          <span className="badge green">
                            <span className="dot" aria-hidden="true" />
                            actif
                          </span>
                        ) : (
                          <span className="badge neutral">—</span>
                        )}
                      </td>
                      <td data-label="Analyse">
                        {r.analysis_error ? (
                          <span className="badge red">erreur</span>
                        ) : r.analyzed_at ? (
                          <span className="badge green">ok</span>
                        ) : (
                          <span className="badge yellow">en attente</span>
                        )}
                        {r.analysis_error ? (
                          <span className="cell-sub">{r.analysis_error}</span>
                        ) : null}
                      </td>
                      <td data-label="Compétences" className="muted">
                        {skills.slice(0, 8).join(", ") || "—"}
                      </td>
                      <td data-label="Actions">
                        <div className="cluster">
                          {!r.is_active ? (
                            <form action={activateResumeAction}>
                              <input type="hidden" name="resumeId" value={r.id} />
                              <SubmitButton className="small">Activer</SubmitButton>
                            </form>
                          ) : null}
                          <form action={reanalyzeResumeAction}>
                            <input type="hidden" name="resumeId" value={r.id} />
                            <SubmitButton className="small ghost" pendingLabel="Analyse…">
                              Réanalyser
                            </SubmitButton>
                          </form>
                          <form action={replaceResumeAction} className="cluster">
                            <input type="hidden" name="resumeId" value={r.id} />
                            <input
                              type="file"
                              name="file"
                              accept="application/pdf,.pdf"
                              required
                              aria-label={`Remplacer le fichier pour ${r.label}`}
                              style={{ maxWidth: "11rem" }}
                            />
                            <SubmitButton className="small">Remplacer</SubmitButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {activeEn?.profile_json || activeFr?.profile_json ? (
        <Section n="03" title="Profil actif" note="aperçu JSON" id="profil">
          <div className="panel panel-quiet">
            <pre className="code-block">
              {JSON.stringify(activeEn?.profile_json ?? activeFr?.profile_json, null, 2)}
            </pre>
          </div>
        </Section>
      ) : null}

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/">Retour aux offres</Link>
      </nav>
    </>
  );
}
