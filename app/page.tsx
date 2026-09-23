import Link from "next/link";
import { trackJob } from "./actions";
import { SubmitButton } from "./components/client-ui";
import {
  DbUnavailable,
  EmptyState,
  PageHeader,
  ScoreMeter,
  Stat,
  StatusPill,
  TableWrap,
} from "./components/ui";
import { day, place } from "../lib/format";
import { deskSummary, listJobs } from "../lib/queries";

type Search = {
  q?: string;
  closed?: string;
  untracked?: string;
  low?: string;
  skipped?: string;
};

export const metadata = { title: "Offres" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const search = sp.q?.trim() || undefined;
  const includeClosed = sp.closed === "1";
  const untrackedOnly = sp.untracked === "1";
  const includeLow = sp.low === "1";
  const includeSkipped = sp.skipped === "1";

  let jobs, summary;
  try {
    [jobs, summary] = await Promise.all([
      listJobs({ search, includeClosed, untrackedOnly, includeLow, includeSkipped }),
      deskSummary(),
    ]);
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Découverte" title="Offres" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const activeFilters = [
    search ? `« ${search} »` : null,
    untrackedOnly ? "non suivies" : null,
    includeClosed ? "fermées incluses" : null,
    includeLow ? "sous 60 incluses" : null,
    includeSkipped ? "rejetées incluses" : null,
  ].filter(Boolean) as string[];

  const filtered = activeFilters.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Découverte"
        title="Offres"
        lede="Tout ce que le desk a trouvé ou que tu as ajouté à la main. Le score compare l'offre à ton CV actif : 85 et plus passe en priorité."
        actions={
          <>
            <Link href="/jobs/new" className="btn">
              Ajouter une offre
            </Link>
            <Link href="/pipeline" className="btn primary">
              Lancer une recherche
            </Link>
          </>
        }
      />

      <div className="stats">
        <Stat value={summary.openJobs} label="Offres ouvertes" />
        <Stat
          value={summary.priorityOpen}
          label="Priorité · score 85+"
          tone={summary.priorityOpen > 0 ? "good" : undefined}
        />
        <Stat value={summary.tracked} label="Candidatures suivies" href="/board" />
        <Stat
          value={summary.followupsDue}
          label="Relances dues"
          href="/followups"
          tone={summary.followupsDue > 0 ? "alert" : undefined}
        />
      </div>

      <form className="filters" method="get" role="search">
        <div className="search">
          <label htmlFor="q" className="visually-hidden">
            Chercher un poste ou une entreprise
          </label>
          <input
            type="search"
            id="q"
            name="q"
            placeholder="Poste ou entreprise…"
            defaultValue={search ?? ""}
          />
        </div>

        <label className="check">
          <input type="checkbox" name="untracked" value="1" defaultChecked={untrackedOnly} />
          Non suivies
        </label>
        <label className="check">
          <input type="checkbox" name="closed" value="1" defaultChecked={includeClosed} />
          Fermées
        </label>
        <label className="check">
          <input type="checkbox" name="low" value="1" defaultChecked={includeLow} />
          Sous 60
        </label>
        <label className="check">
          <input type="checkbox" name="skipped" value="1" defaultChecked={includeSkipped} />
          Rejetées
        </label>

        <SubmitButton className="primary">Filtrer</SubmitButton>
        {filtered ? (
          <Link href="/" className="btn ghost">
            Réinitialiser
          </Link>
        ) : null}
      </form>

      <p className="small muted" aria-live="polite" style={{ marginBottom: "var(--s-4)" }}>
        <strong className="mono">{jobs.length}</strong>{" "}
        {jobs.length === 1 ? "offre affichée" : "offres affichées"}
        {filtered ? ` · filtres : ${activeFilters.join(", ")}` : " · ouvertes uniquement"}
      </p>

      {jobs.length === 0 ? (
        <EmptyState
          mark={filtered ? "Aucun résultat" : "Vide"}
          title={filtered ? "Aucune offre ne correspond" : "Aucune offre pour l'instant"}
          actions={
            <>
              {filtered ? (
                <Link href="/" className="btn">
                  Effacer les filtres
                </Link>
              ) : null}
              <Link href="/jobs/new" className="btn primary">
                Ajouter une offre
              </Link>
              <Link href="/pipeline" className="btn">
                Lancer la recherche ATS
              </Link>
            </>
          }
        >
          {filtered
            ? "Élargis la recherche : coche « Sous 60 » ou « Fermées » pour voir ce qui a été écarté."
            : "Lance une recherche depuis le pipeline, ou colle toi-même une offre trouvée ailleurs."}
        </EmptyState>
      ) : (
        <TableWrap>
          <table>
            <caption className="visually-hidden">
              Offres trouvées, avec leur score de correspondance et l&apos;état de la candidature
            </caption>
            <thead>
              <tr>
                <th scope="col">Poste</th>
                <th scope="col">Entreprise</th>
                <th scope="col">Lieu</th>
                <th scope="col">Score</th>
                <th scope="col" className="tight">
                  Vue le
                </th>
                <th scope="col">Candidature</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td data-label="Poste">
                    <Link href={`/jobs/${job.id}`} className="cell-main">
                      {job.title}
                    </Link>
                    {job.closed_at ? (
                      <span className="cell-sub">
                        <span className="badge neutral">fermée</span>
                      </span>
                    ) : null}
                  </td>
                  <td data-label="Entreprise">{job.company_name}</td>
                  <td data-label="Lieu" className="muted">
                    {place(job.location, job.workplace_type)}
                  </td>
                  <td data-label="Score">
                    <ScoreMeter score={job.score} gated={job.gated} />
                  </td>
                  <td data-label="Vue le" className="tight num muted">
                    {day(job.first_seen_at)}
                  </td>
                  <td data-label="Candidature">
                    {job.application_id ? (
                      <Link href={`/applications/${job.application_id}`}>
                        <StatusPill status={job.status} />
                      </Link>
                    ) : (
                      <form action={trackJob}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <SubmitButton className="small">Suivre</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
