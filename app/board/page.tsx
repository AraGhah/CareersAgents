import Link from "next/link";
import { changeStatus } from "../actions";
import { KanbanBoard, type KanbanCard } from "../components/kanban-board";
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
        <PageHeader title="Board" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const cards: KanbanCard[] = applications.map((a) => ({
    id: a.id,
    title: a.title,
    companyName: a.company_name,
    status: a.status,
    meta: a.submitted_at ? day(a.submitted_at) : null,
  }));

  const live = applications.filter((a) => !CLOSED.includes(a.status)).length;
  const applied = applications.filter((a) =>
    ["applied", "followup", "interview"].includes(a.status),
  ).length;
  const interviews = applications.filter((a) => a.status === "interview").length;

  return (
    <>
      <PageHeader
        title="Board"
        actions={
          <Link href="/pipeline" className="btn">
            Ouvrir le pipeline
          </Link>
        }
      />

      {applications.length === 0 ? (
        <EmptyState
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

          <KanbanBoard
            cards={cards}
            statuses={[...APPLICATION_STATUSES]}
            statusLabels={APPLICATION_STATUS_FR}
            changeStatusAction={changeStatus}
          />
        </>
      )}
    </>
  );
}
