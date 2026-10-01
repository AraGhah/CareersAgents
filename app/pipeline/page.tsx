import Form from "next/form";
import Link from "next/link";
import { changeStatus, findInternshipsAction, setActiveCategoryAction } from "../actions";
import { AutoApplyAction } from "../components/auto-apply-action";
import { AutoSubmit, Flash, Select, SubmitButton } from "../components/client-ui";
import { FlowStrip } from "../components/flow-strip";
import { KanbanBoard, type KanbanCard } from "../components/kanban-board";
import {
  DbUnavailable,
  EmptyState,
  HeroMetric,
  PageHeader,
  ScoreMeter,
  Section,
  StatusPill,
  TableWrap,
} from "../components/ui";
import { day, place } from "../../lib/format";
import { listPipelineRows } from "../../lib/queries";
import { listSourceCapabilities } from "../../lib/sources";
import { APPLICATION_STATUS_FR } from "../../lib/status-labels";
import { PIPELINE_STATUSES } from "../../lib/types";
import { getActiveResume } from "../../lib/resumes";
import { getActiveCategory } from "../../lib/settings";
import { INTERNSHIP_CATEGORIES, INTERNSHIP_CATEGORY_LABEL_FR } from "../../lib/internship-category";
import { TRACKER_MIN_OPTIONS, TRACKER_SORT_OPTIONS, parseTrackerMin, parseTrackerSort, viewTrackerRows } from "../../lib/list-filters";

type Search = {
  /** Lowest score shown, in percent. */
  min?: string;
  /** status (default) | best | worst */
  sort?: string;
  found?: string;
  new?: string;
  qualified?: string;
  boards?: string;
  prepared?: string;
  ok?: string;
};

export const metadata = { title: "Tracker" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  let rows, sources, en, fr, activeCategory;
  try {
    [rows, sources, en, fr, activeCategory] = await Promise.all([
      listPipelineRows(),
      Promise.resolve(listSourceCapabilities()),
      getActiveResume("en"),
      getActiveResume("fr"),
      getActiveCategory(),
    ]);
  } catch (err) {
    return (
      <>
        <PageHeader title="Pipeline" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  // The score filter and the order apply to the board and to the table below it; the counts above stay those of everything.
  const minScore = parseTrackerMin(sp.min);
  const sort = parseTrackerSort(sp.sort);
  const shown = viewTrackerRows(rows, { min: minScore, sort });
  const narrowed = minScore !== undefined || sort !== "status";

  const toPrepare = rows.filter((r) => r.status === "qualified" || r.status === "ready").length;
  const inFlight = rows.filter((r) => r.status === "applied" || r.status === "followup").length;
  const availableSources = sources.filter((s) => s.available).length;
  const columns = PIPELINE_STATUSES.filter((s) => s !== "withdrawn");

  return (
    <>
      <PageHeader
        title="Tracker"
        lede="Prepare your applications and send them out."
        actions={
          <>
            <form action={findInternshipsAction} id="recherche">
              <SubmitButton className="primary" pendingLabel="Recherche en cours…">
                Chercher des stages
              </SubmitButton>
            </form>
            <AutoApplyAction />
          </>
        }
      />

      <FlowStrip current="prepare" />

      {sp.found === "1" ? (
        <Flash>
          Recherche terminée. {sp.new ?? "0"} nouvelles offres, {sp.qualified ?? "0"} qualifiées
          sur {sp.boards ?? "0"} boards.
          {Number(sp.prepared) > 0
            ? ` ${sp.prepared} candidature${Number(sp.prepared) > 1 ? "s" : ""} prête${Number(sp.prepared) > 1 ? "s" : ""} à approuver.`
            : null}
        </Flash>
      ) : null}

      {!en && !fr ? (
        <Flash tone="warn">
          Aucun CV actif, les scores et les emails ne seront pas personnalisés.{" "}
          <Link href="/resumes">Ajouter un CV</Link>
        </Flash>
      ) : null}

      {sp.ok === "category" ? <Flash>Catégorie enregistrée.</Flash> : null}

      <form action={setActiveCategoryAction} className="toolbar">
        <span className="toolbar-label">Catégorie ciblée</span>
        <Select
          name="category"
          ariaLabel="Catégorie ciblée"
          defaultValue={activeCategory ?? ""}
          placeholder="Toutes"
          compact
          options={[
            { value: "", label: "Toutes" },
            ...INTERNSHIP_CATEGORIES.map((c) => ({
              value: c,
              label: INTERNSHIP_CATEGORY_LABEL_FR[c],
            })),
          ]}
        />
        <SubmitButton className="small">Enregistrer</SubmitButton>
      </form>

      <HeroMetric
        value={toPrepare}
        label="À préparer ou prêtes"
        tone={toPrepare > 0 ? "good" : undefined}
        aside={
          <>
            <Link href="/resumes">{en || fr ? "CV actifs" : "Ajouter un CV"}</Link>
            <Link href="/followups">{inFlight} en cours</Link>
            <span>
              {availableSources}/{sources.length} sources
            </span>
          </>
        }
      />

      <Section
        title="Sources"
        note={`${availableSources} sur ${sources.length} actives`}
        id="sources"
      >
        <TableWrap>
          <table>
            <caption className="visually-hidden">Disponibilité de chaque source d&apos;offres</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">État</th>
                <th scope="col">Détail</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td data-label="Source" className="cell-main">
                    {s.label}
                  </td>
                  <td data-label="État">
                    <span className={`badge ${s.available ? "green" : "neutral"}`}>
                      {s.available ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td data-label="Détail" className="muted">
                    {s.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Form action="#kanban" scroll={false} className="filters" role="search">
        <AutoSubmit />
        <Select
          name="min"
          ariaLabel="Score minimum"
          defaultValue={minScore === undefined ? "" : String(minScore)}
          placeholder="Score minimum"
          compact
          autoSubmit
          options={TRACKER_MIN_OPTIONS}
        />
        <Select
          name="sort"
          ariaLabel="Ordre des candidatures"
          defaultValue={sort}
          placeholder="Ordre"
          compact
          autoSubmit
          options={TRACKER_SORT_OPTIONS}
        />
        <SubmitButton className="primary">Filtrer</SubmitButton>
        {narrowed ? (
          <Link href="/pipeline#kanban" className="btn ghost">
            Réinitialiser
          </Link>
        ) : null}
        {narrowed ? (
          <span className="result-count" aria-live="polite">
            {shown.length} sur {rows.length}
          </span>
        ) : null}
      </Form>

      <Section
        title="Status Board"
        note={narrowed ? `${shown.length} sur ${rows.length} application${rows.length === 1 ? "" : "s"}` : `${rows.length} application${rows.length === 1 ? "" : "s"}`}
        id="kanban"
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Aucune candidature à afficher"
            actions={
              <Link href="/jobs/new" className="btn">
                Ajouter une offre
              </Link>
            }
          >
            Suis une offre depuis la liste pour la voir ici, colonne par colonne.
          </EmptyState>
        ) : (
          <KanbanBoard
            cards={shown.map(
              (r): KanbanCard => ({
                id: r.application_id,
                title: r.title,
                companyName: r.company_name,
                status: r.status,
                meta: r.score != null ? String(Math.round(Number(r.score) * 100)) : null,
              }),
            )}
            statuses={columns}
            statusLabels={APPLICATION_STATUS_FR}
            changeStatusAction={changeStatus}
          />
        )}
      </Section>

      <Section title="Applications" id="candidatures">
        {rows.length === 0 ? (
          <EmptyState
            title="Aucune candidature suivie"
            actions={
              <Link href="/jobs/new" className="btn">
                Ajouter une offre
              </Link>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Aucune candidature ne correspond à ce filtre"
            actions={
              <Link href="/pipeline#candidatures" className="btn">
                Effacer le filtre
              </Link>
            }
          >
            {rows.length} candidature{rows.length === 1 ? "" : "s"} suivie{rows.length === 1 ? "" : "s"}, aucune avec un score de {minScore} ou plus.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">
                Toutes les candidatures suivies, avec leur contact et leur prochaine relance
              </caption>
              <thead>
                <tr>
                  <th scope="col">Poste</th>
                  <th scope="col">Lieu</th>
                  <th scope="col">Score</th>
                  <th scope="col">Source</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="tight">
                    Postulé
                  </th>
                  <th scope="col" className="tight">
                    Relance
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.application_id}>
                    <td data-label="Poste">
                      <Link href={`/applications/${r.application_id}`} className="cell-main">
                        {r.title}
                      </Link>
                      <span className="cell-sub">{r.company_name}</span>
                    </td>
                    <td data-label="Lieu" className="muted">
                      {place(r.location, null)}
                    </td>
                    <td data-label="Score">
                      <ScoreMeter score={r.score} gated={r.gated} />
                    </td>
                    <td data-label="Source" className="muted">
                      {r.source ?? "n/d"}
                    </td>
                    <td data-label="Contact">
                      {r.recruiter_name || r.recruiter_email ? (
                        <>
                          <span>{r.recruiter_name ?? "n/d"}</span>
                          {r.recruiter_email ? (
                            <span className="cell-sub mono">{r.recruiter_email}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="empty">n/d</span>
                      )}
                    </td>
                    <td data-label="Statut">
                      <StatusPill status={r.status} />
                      {r.outreach_approved ? (
                        <span className="cell-sub">
                          <span className="badge green">approuvé</span>
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Postulé" className="tight num muted">
                      {day(r.submitted_at)}
                    </td>
                    <td data-label="Relance" className="tight num muted">
                      {r.next_followup ? day(r.next_followup) : "n/d"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <nav className="page-foot" aria-label="Related links">
        <Link href="/resumes">Change active resume</Link>
        <Link href="/followups">View follow-ups</Link>
        <Link href="/">Back to jobs</Link>
      </nav>
    </>
  );
}
