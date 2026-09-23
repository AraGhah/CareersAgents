import Link from "next/link";
import { notFound } from "next/navigation";
import { trackJob } from "../../actions";
import { SubmitButton } from "../../components/client-ui";
import { DbUnavailable, PageHeader, ScoreMeter, Section, StatusPill } from "../../components/ui";
import { day, percent, place } from "../../../lib/format";
import { getJob } from "../../../lib/queries";
import {
  COMPONENT_NAMES,
  explain,
  explainFr,
  findSkills,
  type Components,
} from "../../../lib/score";
import { COMPONENT_LABEL_FR } from "../../../lib/status-labels";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job;
  try {
    job = await getJob(id);
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Offre" title="Détail de l'offre" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }
  if (!job) notFound();

  const components = {} as Components;
  for (const name of COMPONENT_NAMES) {
    const row = job.components.find((c) => c.component === name);
    components[name] = row ? Number(row.raw_value) : 0;
  }
  const scored = job.components.length > 0;
  const pct = scored ? Math.round(Number(job.score) * 100) : null;
  const gated = Boolean(job.gated);
  const explanation = scored ? explain(components, pct ?? 0, gated) : null;
  const explanationFr = scored ? explainFr(components, pct ?? 0, gated) : null;
  const found = findSkills(
    [job.title, job.location, job.workplace_type, job.company_city, job.description]
      .filter(Boolean)
      .join("\n"),
  );
  const haveCount = found.filter((s) => s.have).length;

  return (
    <>
      <PageHeader
        eyebrow={job.company_name}
        title={job.title}
        lede={
          <>
            {place(job.location, job.workplace_type)}
            {" · "}
            <a href={job.url} target="_blank" rel="noreferrer">
              voir l&apos;offre
            </a>
            {job.closed_at ? <> · fermée le {day(job.closed_at)}</> : null}
          </>
        }
        actions={
          job.application_id ? (
            <Link href={`/applications/${job.application_id}`} className="btn primary">
              Ouvrir la candidature
            </Link>
          ) : (
            <form action={trackJob}>
              <input type="hidden" name="jobId" value={job.id} />
              <SubmitButton className="primary" pendingLabel="Ajout…">
                Suivre cette offre
              </SubmitButton>
            </form>
          )
        }
      />

      <div className="split">
        <div className="stack">
          {scored ? (
            <Section n="01" title="Composantes du score" id="composantes">
              <div className="table-wrap stackable">
                <table>
                  <caption className="visually-hidden">
                    Détail du score de correspondance par composante
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Composante</th>
                      <th scope="col">Valeur</th>
                      <th scope="col" className="tight">
                        Poids
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPONENT_NAMES.map((name) => {
                      const row = job.components.find((c) => c.component === name);
                      return (
                        <tr key={name}>
                          <td data-label="Composante">
                            <span className="cell-main">{name}</span>
                            <span className="cell-sub">{COMPONENT_LABEL_FR[name] ?? name}</span>
                          </td>
                          <td data-label="Valeur">{percent(row?.raw_value ?? null)}</td>
                          <td data-label="Poids" className="tight num muted">
                            {row ? percent(row.weight) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {explanation || explanationFr ? (
                <div className="two-col-explain" style={{ marginTop: "var(--s-4)" }}>
                  {explanation ? <p className="lede">{explanation}</p> : null}
                  {explanationFr ? <p className="lede">{explanationFr}</p> : null}
                </div>
              ) : null}
            </Section>
          ) : (
            <div className="panel panel-quiet">
              <p className="empty" style={{ margin: 0 }}>
                Pas encore scorée. Lance <code>npm run score</code>.
              </p>
            </div>
          )}

          <Section
            n="02"
            title="Mots-clés dans l'offre"
            note={found.length ? `${haveCount}/${found.length} présents dans ton CV` : undefined}
            id="mots-cles"
          >
            {found.length === 0 ? (
              <p className="empty">
                Aucun des mots-clés du dictionnaire n&apos;apparaît dans le texte.
              </p>
            ) : (
              <p className="tag-list">
                {found.map((s) => (
                  <span key={s.name} className={`badge ${s.have ? "green" : "neutral"}`}>
                    {s.have ? <span className="dot" aria-hidden="true" /> : null}
                    {s.name}
                    {s.have ? "" : " (manquant)"}
                  </span>
                ))}
              </p>
            )}
          </Section>

          <Section n="03" title="Texte de l'offre" id="texte">
            <div className="panel">
              {job.description ? (
                <pre className="description">{job.description}</pre>
              ) : (
                <p className="empty" style={{ margin: 0 }}>
                  Aucune description enregistrée pour cette offre.
                </p>
              )}
            </div>
          </Section>
        </div>

        <aside className="split-aside">
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Fiche</span>
              {scored ? <ScoreMeter score={job.score} gated={gated} compact /> : null}
            </div>
            <dl className="facts rows">
              <dt>Lieu</dt>
              <dd>{place(job.location, job.workplace_type)}</dd>
              <dt>Publiée</dt>
              <dd>{day(job.posted_at)}</dd>
              <dt>Vue la première fois</dt>
              <dd>{day(job.first_seen_at)}</dd>
              <dt>Score</dt>
              <dd>
                {scored ? (
                  <>
                    <ScoreMeter score={job.score} gated={gated} />
                    {gated ? (
                      <span className="field-hint">Lieu ou période à 0 : offre écartée.</span>
                    ) : null}
                  </>
                ) : (
                  <span className="empty">non scorée</span>
                )}
              </dd>
              <dt>Candidature</dt>
              <dd>
                {job.application_id ? (
                  <Link href={`/applications/${job.application_id}`}>
                    <StatusPill status={job.status} />
                  </Link>
                ) : (
                  <span className="empty">non suivie</span>
                )}
              </dd>
            </dl>
          </div>
        </aside>
      </div>

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/">Retour aux offres</Link>
      </nav>
    </>
  );
}
