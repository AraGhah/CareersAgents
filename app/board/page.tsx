import Link from "next/link";
import { day } from "../../lib/format";
import { listApplications } from "../../lib/queries";
import { APPLICATION_STATUSES } from "../../lib/types";
import { APPLICATION_STATUS_FR } from "../../lib/status-labels";
import { DbUnavailable, EmptyState, PageHeader, Stat } from "../components/ui";

export const metadata = { title: "Board" };

const CLOSED: string[] = ["rejected", "withdrawn"];

export default async function BoardPage() {
  let applications;
  try {
    applications = await listApplications();
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Vue d'ensemble" title="Board" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const live = applications.filter((a) => !CLOSED.includes(a.status)).length;
  const applied = applications.filter((a) =>
    ["applied", "followup", "interview"].includes(a.status),
  ).length;
  const interviews = applications.filter((a) => a.status === "interview").length;

  return (
    <>
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Board"
        lede="Chaque candidature suivie, rangée par étape. Clique une carte pour ouvrir son dossier complet."
        actions={
          <Link href="/pipeline" className="btn">
            Ouvrir le pipeline
          </Link>
        }
      />

      {applications.length === 0 ? (
        <EmptyState
          mark="Aucune candidature"
          title="Rien à suivre pour l'instant"
          actions={
            <>
              <Link href="/" className="btn primary">
                Choisir une offre
              </Link>
              <Link href="/jobs/new" className="btn">
                Ajouter une offre
              </Link>
            </>
          }
        >
          Suis une offre depuis la liste des offres et elle apparaîtra ici, colonne par colonne.
        </EmptyState>
      ) : (
        <>
          <div className="stats">
            <Stat value={applications.length} label="Candidatures au total" />
            <Stat value={live} label="Encore en vie" tone={live > 0 ? "good" : undefined} />
            <Stat value={applied} label="Envoyées" />
            <Stat
              value={interviews}
              label="En entrevue"
              tone={interviews > 0 ? "good" : undefined}
            />
          </div>

          <div className="board">
            {APPLICATION_STATUSES.map((status) => {
              const column = applications.filter((a) => a.status === status);
              return (
                <section
                  key={status}
                  className={`board-col${column.length === 0 ? " is-empty" : ""}`}
                  aria-label={`${APPLICATION_STATUS_FR[status]} : ${column.length}`}
                >
                  <h3>
                    {APPLICATION_STATUS_FR[status]}
                    <span className="count">{column.length}</span>
                  </h3>
                  {column.length === 0 ? (
                    <p className="board-empty">—</p>
                  ) : (
                    <ul>
                      {column.map((a) => (
                        <li key={a.id}>
                          <Link href={`/applications/${a.id}`} className="board-card">
                            {a.title}
                            <span className="co">
                              {a.company_name}
                              {a.submitted_at ? (
                                <span className="mono">{day(a.submitted_at)}</span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
