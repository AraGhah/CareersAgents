import Link from "next/link";
import { notFound } from "next/navigation";
import { trackJob } from "../../actions";
import { SubmitButton } from "../../components/client-ui";
import { MatchBreakdown } from "../../components/match-breakdown";
import { DbUnavailable, ExtLink, PageHeader, ScoreMeter, Section, StatusPill } from "../../components/ui";
import { day, place } from "../../../lib/format";
import { reportForJob } from "../../../lib/match/for-job";
import { getJob } from "../../../lib/queries";

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

  const scored = job.components.length > 0;
  const gated = Boolean(job.gated);
  // Computed now, against the CVs that are active now: the page shows the reasoning behind the number, not a number alone.
  const report = await reportForJob(job);
  const storedPercent = scored ? Math.round(Number(job.score) * 1000) / 10 : null;

  return (
    <>
      <PageHeader
        eyebrow={job.company_name}
        title={job.title}
        lede={
          <>
            {place(job.location, job.workplace_type)}
            {" · "}
            <ExtLink href={job.url}>voir l&apos;offre</ExtLink>
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
          <Section title="Pourquoi ce pourcentage" id="composantes">
            <MatchBreakdown report={report} storedPercent={storedPercent} />
          </Section>

          <Section title="Texte de l'offre" id="texte">
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
                      <span className="field-hint">Lieu, période ou poste à 0 : offre écartée.</span>
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
