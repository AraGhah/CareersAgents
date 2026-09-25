import Link from "next/link";
import { changeStatus } from "../actions";
import { FlowStrip } from "../components/flow-strip";
import { KanbanBoard, type KanbanCard } from "../components/kanban-board";
import { day } from "../../lib/format";
import { listApplications } from "../../lib/queries";
import { APPLICATION_STATUSES } from "../../lib/types";
import { APPLICATION_STATUS_FR } from "../../lib/status-labels";
import { DbUnavailable, EmptyState, HeroMetric, PageHeader } from "../components/ui";

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
  const interviews = applications.filter((a) => a.status === "interview").length;
  const toPrep = applications.filter((a) =>
    ["discovered", "qualified", "ready"].includes(a.status),
  ).length;

  return (
    <>
      <PageHeader
        title="Board"
        lede="Suis chaque candidature jusqu’à l’envoi."
        actions={
          <Link href="/pipeline" className="btn primary">
            Préparer
          </Link>
        }
      />

      <FlowStrip current="track" />

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
          Suis une offre depuis la liste — elle apparaîtra ici.
        </EmptyState>
      ) : (
        <>
          <HeroMetric
            value={live}
            label="Encore en vie"
            tone={live > 0 ? "good" : undefined}
            aside={
              <>
                <span>{applications.length} au total</span>
                <Link href="/pipeline">{toPrep} à préparer</Link>
                {interviews > 0 ? (
                  <span className="is-good">{interviews} en entrevue</span>
                ) : null}
              </>
            }
          />

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
