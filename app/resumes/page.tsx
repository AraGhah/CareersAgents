import Link from "next/link";
import {
  activateResumeAction,
  reanalyzeResumeAction,
  replaceResumeAction,
  uploadResumeAction,
} from "../actions";
import { FileInput, Flash, Select, SubmitButton } from "../components/client-ui";
import { DbUnavailable, EmptyState, PageHeader, Section, Stat, TableWrap } from "../components/ui";
import { Disclosure } from "../components/disclosure";
import { ResumeProfilePreview } from "../components/resume-profile";
import { day } from "../../lib/format";
import { listResumes } from "../../lib/resumes";
import { INTERNSHIP_CATEGORIES, INTERNSHIP_CATEGORY_LABEL_FR } from "../../lib/internship-category";

type Search = { ok?: string; id?: string };

export const metadata = { title: "CV" };

const OK_MESSAGE: Record<string, string> = {
  uploaded: "CV importé.",
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
        <PageHeader title="CV" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }
  const activeEn = resumes.find((r) => r.language === "en" && r.is_active);
  const activeFr = resumes.find((r) => r.language === "fr" && r.is_active);
  const activeProfile = activeEn?.profile_json ?? activeFr?.profile_json ?? null;
  const activeSkills = activeProfile?.skills ?? [];

  return (
    <>
      <PageHeader
        title="CV"
        lede="Un CV actif par langue et par catégorie. Chaque offre reçoit celui qui lui correspond le mieux."
      />

      {sp.ok && OK_MESSAGE[sp.ok] ? <Flash>{OK_MESSAGE[sp.ok]}</Flash> : null}

      <div className="stats">
        <Stat
          value={activeEn?.label ?? "Aucun"}
          label="CV anglais actif"
          tone={activeEn ? undefined : "alert"}
        />
        <Stat
          value={activeFr?.label ?? "Aucun"}
          label="CV français actif"
          tone={activeFr ? undefined : "alert"}
        />
        <Stat value={activeSkills.length} label="Compétences extraites" />
        <Stat value={resumes.length} label="CV dans la bibliothèque" />
      </div>

      <Section title="Importer un CV" id="upload">
        <form action={uploadResumeAction} className="panel">
          <div className="row">
            <div className="field">
              <label htmlFor="language">Langue</label>
              <Select
                name="language"
                ariaLabel="Langue"
                defaultValue="en"
                options={[
                  { value: "en", label: "English" },
                  { value: "fr", label: "Français" },
                ]}
              />
            </div>
            <div className="field">
              <label htmlFor="label">Libellé</label>
              <input id="label" name="label" placeholder="Full-Stack EN" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="category">Catégorie</label>
            <Select
              name="category"
              ariaLabel="Catégorie"
              defaultValue=""
              placeholder="Générale (toutes catégories)"
              options={[
                { value: "", label: "Générale (toutes catégories)" },
                ...INTERNSHIP_CATEGORIES.map((c) => ({ value: c, label: INTERNSHIP_CATEGORY_LABEL_FR[c] })),
              ]}
            />
          </div>

          <div className="field">
            <span className="field-label">Fichier PDF</span>
            <FileInput name="file" accept="application/pdf,.pdf" required buttonLabel="Choisir un PDF" />
          </div>

          <label className="check-plain">
            <input type="checkbox" name="activate" value="on" defaultChecked />
            Utiliser ce CV dès maintenant
          </label>

          <div className="form-actions">
            <SubmitButton className="primary" pendingLabel="Import en cours…">
              Importer
            </SubmitButton>
          </div>
        </form>
      </Section>

      <Section title="Bibliothèque" note={`${resumes.length} CV`} id="bibliotheque">
        {resumes.length === 0 ? (
          <EmptyState title="Aucun CV importé">
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
                  <th scope="col">Catégorie</th>
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
                      <td data-label="Langue">
                        {r.language.toUpperCase()}
                      </td>
                      <td data-label="Catégorie" className="muted">
                        {r.category ? INTERNSHIP_CATEGORY_LABEL_FR[r.category] : "Générale"}
                      </td>
                      <td data-label="Libellé">
                        <span className="cell-main">{r.label}</span>
                        <span className="cell-sub">
                          {r.filename} · {day(r.uploaded_at)}
                        </span>
                      </td>
                      <td data-label="Actif">
                        {r.is_active ? (
                          <span className="badge green">Actif</span>
                        ) : (
                          <span className="empty">Non</span>
                        )}
                      </td>
                      <td data-label="Analyse">
                        {r.analysis_error ? (
                          <span className="badge red">Erreur</span>
                        ) : r.analyzed_at ? (
                          <span className="muted">Analysé</span>
                        ) : (
                          <span className="badge yellow">En attente</span>
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
                          <form action={replaceResumeAction}>
                            <input type="hidden" name="resumeId" value={r.id} />
                            <FileInput
                              name="file"
                              accept="application/pdf,.pdf"
                              buttonLabel="Remplacer"
                              ariaLabel={`Remplacer le PDF de ${r.label}`}
                              autoSubmit
                            />
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

      {activeProfile ? (
        <Section title="Profil actif" id="profil">
          <div className="panel panel-quiet">
            <ResumeProfilePreview profile={activeProfile} />
            <div style={{ marginTop: "var(--s-5)" }}>
              <Disclosure label="Voir les données brutes" openLabel="Masquer les données brutes">
                <pre className="code-block" style={{ marginTop: "var(--s-3)" }}>
                  {JSON.stringify(activeProfile, null, 2)}
                </pre>
              </Disclosure>
            </div>
          </div>
        </Section>
      ) : null}

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/">Retour aux offres</Link>
      </nav>
    </>
  );
}
