import Link from "next/link";
import { changeStatus, findInternshipsAction, setActiveCategoryAction } from "../actions";
import { Flash, Select, SubmitButton } from "../components/client-ui";
import { KanbanBoard, type KanbanCard } from "../components/kanban-board";
import {
  DbUnavailable,
  EmptyState,
  PageHeader,
  ScoreMeter,
  Section,
  Stat,
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

type Search = {
  found?: string;
  new?: string;
  qualified?: string;
  boards?: string;
  prepared?: string;
  ok?: string;
};

export const metadata = { title: "Pipeline" };

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

  const toPrepare = rows.filter((r) => r.status === "qualified" || r.status === "ready").length;
  const inFlight = rows.filter((r) => r.status === "applied" || r.status === "followup").length;
  const availableSources = sources.filter((s) => s.available).length;
  const columns = PIPELINE_STATUSES.filter((s) => s !== "withdrawn");

  return (
    <>
      <PageHeader
        title="Pipeline"
        actions={
          <form action={findInternshipsAction} id="recherche">
            <SubmitButton className="primary" pendingLabel="Recherche en cours…">
              Chercher des stages
            </SubmitButton>
          </form>
        }
      />

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

      <div className="stats">
        <Stat
          value={en?.label ?? "Aucun"}
          label="CV anglais"
          href="/resumes"
          tone={en ? undefined : "alert"}
        />
        <Stat
          value={fr?.label ?? "Aucun"}
          label="CV français"
          href="/resumes"
          tone={fr ? undefined : "alert"}
        />
        <Stat value={toPrepare} label="À préparer ou prêtes" />
        <Stat value={inFlight} label="Postulées ou en relance" href="/followups" />
      </div>

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

      <Section title="Kanban" note={`${rows.length} candidature${rows.length === 1 ? "" : "s"}`} id="kanban">
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
            cards={rows.map(
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

      <Section title="Candidatures" id="candidatures">
        {rows.length === 0 ? (
          <EmptyState
            title="Aucune candidature suivie"
            actions={
              <Link href="/jobs/new" className="btn">
                Ajouter une offre
              </Link>
            }
          />
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
                {rows.map((r) => (
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

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/resumes">Changer le CV actif</Link>
        <Link href="/followups">Voir les relances</Link>
        <Link href="/">Retour aux offres</Link>
      </nav>
    </>
  );
}
