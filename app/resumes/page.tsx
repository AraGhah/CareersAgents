import Link from "next/link";
import {
  activateResumeAction,
  reanalyzeResumeAction,
  replaceResumeAction,
  uploadResumeAction,
} from "../actions";
import { FileInput, Flash, Select, SubmitButton } from "../components/client-ui";
import { DbUnavailable, EmptyState, HeroMetric, PageHeader, Section } from "../components/ui";
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
  const activeCount = [activeEn, activeFr].filter(Boolean).length;

  return (
    <>
      <PageHeader
        title="CV"
        lede="Un CV actif par langue et par catégorie. Chaque offre reçoit celui qui lui correspond le mieux."
      />

      {sp.ok && OK_MESSAGE[sp.ok] ? <Flash>{OK_MESSAGE[sp.ok]}</Flash> : null}

      <HeroMetric
        value={activeCount}
        label="CV actifs sur 2 langues"
        tone={activeCount === 2 ? "good" : "alert"}
        aside={
          <>
            <span className={activeEn ? undefined : "is-alert"}>
              EN — {activeEn?.label ?? "aucun"}
            </span>
            <span className={activeFr ? undefined : "is-alert"}>
              FR — {activeFr?.label ?? "aucun"}
            </span>
            <span>{activeSkills.length} compétences extraites</span>
            <Link href="#bibliotheque">{resumes.length} CV en bibliothèque</Link>
          </>
        }
      />

      <Section title="Importer un CV" id="upload">
        <form action={uploadResumeAction} className="panel">
          <div className="row">
            <div className="field">
              <label htmlFor="language">Langue</label>
              <Select
                id="language"
                name="language"
                ariaLabel="Langue"
                defaultValue="en"
                options={[
                  { value: "en", label: "Anglais" },
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
              id="category"
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
          <ul className="card-grid">
            {resumes.map((r) => {
              const skills = r.profile_json?.skills ?? [];
              return (
                <li key={r.id} className={`item-card${r.is_active ? " is-active" : ""}`}>
                  <div className="item-card-head">
                    <div>
                      <h3 className="item-card-title">{r.label}</h3>
                      <div className="item-card-meta">
                        <span className="badge accent">{r.language.toUpperCase()}</span>
                        <span>
                          {r.category ? INTERNSHIP_CATEGORY_LABEL_FR[r.category] : "Générale"}
                        </span>
                      </div>
                    </div>
                    {r.is_active ? <span className="badge green">Actif</span> : null}
                  </div>

                  <div className="item-card-body">
                    <span className="cell-sub">
                      {r.filename} · {day(r.uploaded_at)}
                    </span>
                    {r.analysis_error ? (
                      <p className="flush">
                        <span className="badge red">Erreur</span>{" "}
                        <span className="small">{r.analysis_error}</span>
                      </p>
                    ) : r.analyzed_at ? (
                      <p className="flush small muted">
                        {skills.length > 0
                          ? skills.slice(0, 8).join(", ")
                          : "Analysé — aucune compétence extraite"}
                      </p>
                    ) : (
                      <span className="badge yellow">Analyse en attente</span>
                    )}
                  </div>

                  <div className="item-card-actions">
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
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {activeProfile ? (
        <Section title="Profil actif" id="profil">
          <div className="panel panel-quiet">
            <ResumeProfilePreview profile={activeProfile} />
            <div className="profile-raw">
              <Disclosure label="Voir les données brutes" openLabel="Masquer les données brutes">
                <pre className="code-block block-spaced">{JSON.stringify(activeProfile, null, 2)}</pre>
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
