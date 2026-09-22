import Link from "next/link";
import {
  activateResumeAction,
  reanalyzeResumeAction,
  replaceResumeAction,
  uploadResumeAction,
} from "../actions";
import { day } from "../../lib/format";
import { listResumes } from "../../lib/resumes";

type Search = { ok?: string; id?: string };

export default async function ResumesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const resumes = await listResumes();
  const activeEn = resumes.find((r) => r.language === "en" && r.is_active);
  const activeFr = resumes.find((r) => r.language === "fr" && r.is_active);

  return (
    <>
      <h1>Resumes</h1>
      <p className="lede">
        Les CV actifs pilotent le matching, le package de candidature et la langue des emails. Rien n&apos;est
        hardcodé : uploade, active, remplace — le profil est réanalysé automatiquement.
      </p>

      {sp.ok ? (
        <p className="lede">
          {sp.ok === "uploaded" && "CV enregistré et analysé."}
          {sp.ok === "activated" && "CV actif mis à jour."}
          {sp.ok === "analyzed" && "Profil réanalysé."}
          {sp.ok === "replaced" && "CV remplacé et réanalysé."}
        </p>
      ) : null}

      <div className="stats">
        <article>
          <strong>{activeEn ? "EN actif" : "—"}</strong>
          <span>{activeEn?.label ?? "Aucun CV anglais actif"}</span>
        </article>
        <article>
          <strong>{activeFr ? "FR actif" : "—"}</strong>
          <span>{activeFr?.label ?? "Aucun CV français actif"}</span>
        </article>
        <article>
          <strong>{(activeEn?.profile_json?.skills ?? activeFr?.profile_json?.skills ?? []).length}</strong>
          <span>Compétences extraites</span>
        </article>
      </div>

      <h2>Uploader un CV</h2>
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
        <label>
          <input type="checkbox" name="activate" value="on" defaultChecked /> Activer pour les
          candidatures de cette langue
        </label>
        <div style={{ marginTop: "0.75rem" }}>
          <button type="submit" className="primary">
            Upload et analyser
          </button>
        </div>
      </form>

      <h2>Bibliothèque</h2>
      {resumes.length === 0 ? (
        <p className="empty">
          Aucun CV. Importe d&apos;abord tes PDF Full-Stack, ou utilise{" "}
          <code>npm run resumes:import</code>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Langue</th>
              <th>Libellé</th>
              <th>Actif</th>
              <th>Analyse</th>
              <th>Compétences</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {resumes.map((r) => {
              const skills = r.profile_json?.skills ?? [];
              return (
                <tr key={r.id}>
                  <td>{r.language.toUpperCase()}</td>
                  <td>
                    <div>{r.label}</div>
                    <div className="empty" style={{ fontSize: "0.8rem" }}>
                      {r.filename} · {day(r.uploaded_at)}
                    </div>
                  </td>
                  <td>
                    {r.is_active ? (
                      <span className="badge green">actif</span>
                    ) : (
                      <span className="badge">—</span>
                    )}
                  </td>
                  <td>
                    {r.analysis_error ? (
                      <span className="badge red">erreur</span>
                    ) : r.analyzed_at ? (
                      <span className="badge green">ok</span>
                    ) : (
                      <span className="badge">pending</span>
                    )}
                    {r.analysis_error ? (
                      <div className="empty" style={{ fontSize: "0.75rem" }}>
                        {r.analysis_error}
                      </div>
                    ) : null}
                  </td>
                  <td>{skills.slice(0, 8).join(", ") || "—"}</td>
                  <td>
                    <div className="filters" style={{ margin: 0, flexWrap: "wrap" }}>
                      {!r.is_active ? (
                        <form action={activateResumeAction}>
                          <input type="hidden" name="resumeId" value={r.id} />
                          <button type="submit">Activer</button>
                        </form>
                      ) : null}
                      <form action={reanalyzeResumeAction}>
                        <input type="hidden" name="resumeId" value={r.id} />
                        <button type="submit">Réanalyser</button>
                      </form>
                      <form action={replaceResumeAction}>
                        <input type="hidden" name="resumeId" value={r.id} />
                        <input type="file" name="file" accept="application/pdf,.pdf" required />
                        <button type="submit">Remplacer</button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {(activeEn?.profile_json || activeFr?.profile_json) && (
        <>
          <h2>Profil actif (aperçu)</h2>
          <div className="panel">
            <pre className="description">
              {JSON.stringify(activeEn?.profile_json ?? activeFr?.profile_json, null, 2)}
            </pre>
          </div>
        </>
      )}

      <p>
        <Link href="/">Retour aux offres</Link>
      </p>
    </>
  );
}
