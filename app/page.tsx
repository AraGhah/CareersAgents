import Form from "next/form";
import Link from "next/link";
import { findInternshipsFromJobsAction } from "./actions";
import { AutoApplyAction } from "./components/auto-apply-action";
import { AutoSubmit, Flash, Select, SubmitButton } from "./components/client-ui";
import { FlowStrip } from "./components/flow-strip";
import { DbUnavailable, EmptyState, HeroMetric, PageHeader, TableWrap } from "./components/ui";
import { JobsTable } from "./components/jobs-table";
import { deskSummary, listJobs } from "../lib/queries";
import { getActiveCategory } from "../lib/settings";
import {
  detectInternshipCategories,
  INTERNSHIP_CATEGORIES,
  INTERNSHIP_CATEGORY_LABEL_FR,
  isInternshipCategory,
} from "../lib/internship-category";
import { isPriorityCompany } from "../lib/priority-companies";
import { today } from "../lib/format";
import { JOB_SORT_OPTIONS, MIN_SCORE_OPTIONS, jobSortLabel, minScoreLabel, parseJobSort, parseMinScore } from "../lib/list-filters";

type Search = {
  q?: string;
  closed?: string;
  untracked?: string;
  low?: string;
  /** Lowest score shown, in percent. */
  min?: string;
  /** best (default) | worst | recent | company | actionable */
  sort?: string;
  skipped?: string;
  email?: string;
  category?: string;
  found?: string;
  new?: string;
  qualified?: string;
  boards?: string;
  prepared?: string;
};

export const metadata = { title: "Offres" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const search = sp.q?.trim() || undefined;
  const includeClosed = sp.closed === "1";
  const untrackedOnly = sp.untracked === "1";
  const includeLow = sp.low === "1";
  const includeSkipped = sp.skipped === "1";
  const withEmail = sp.email === "1";
  const minScore = parseMinScore(sp.min, sp.low);
  const sort = parseJobSort(sp.sort);

  let jobs, summary, defaultCategory;
  try {
    [jobs, summary, defaultCategory] = await Promise.all([
      // "actionable" keeps the score order from the query and then brings jobs with a known email forward (below).
      listJobs({ search, includeClosed, untrackedOnly, includeLow, includeSkipped, withEmail, minScore, sort: sort === "actionable" ? "best" : sort }),
      deskSummary(),
      getActiveCategory(),
    ]);
  } catch (err) {
    return (
      <>
        <PageHeader title="Offres" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  // Category is a bias, not a hard exclusion: pre-select the globally
  // "targeted" category on first load, but once the filter form is
  // submitted the URL always carries the explicit (possibly cleared) choice.
  const categoryParamGiven = sp.category !== undefined;
  const categoryFilter = categoryParamGiven
    ? isInternshipCategory(sp.category)
      ? sp.category
      : null
    : defaultCategory;

  // Category detection uses title + a short description excerpt so roles that
  // only name the track in the body still match, without loading full text.
  const visibleJobs = categoryFilter
    ? jobs.filter((job) =>
        detectInternshipCategories(job.title, job.description_preview ?? null).includes(categoryFilter),
      )
    : jobs;
  // The list is ordered by the query (best score first unless another order is chosen). Only "avec email d'abord" re-orders
  // it: a job whose company has no known email can't be sent to from this app yet, so those with one come first, priority
  // companies next, and the score order is kept within each group.
  const sortedJobs =
    sort === "actionable"
      ? [...visibleJobs].sort((a, b) => {
          const emailDiff = Number(!a.has_email) - Number(!b.has_email);
          if (emailDiff !== 0) return emailDiff;
          return Number(!isPriorityCompany(a.company_name)) - Number(!isPriorityCompany(b.company_name));
        })
      : visibleJobs;

  const activeFilters = [
    search ? `« ${search} »` : null,
    categoryFilter ? INTERNSHIP_CATEGORY_LABEL_FR[categoryFilter] : null,
    withEmail ? "avec email" : null,
    untrackedOnly ? "non suivies" : null,
    includeClosed ? "fermées incluses" : null,
    minScoreLabel(minScore),
    includeSkipped ? "rejetées incluses" : null,
  ].filter(Boolean) as string[];

  const filtered = activeFilters.length > 0;

  return (
    <>
      <PageHeader
        eyebrow={today()}
        title="Offres"
        lede="Les offres découvertes, classées par score de correspondance."
        actions={
          <>
            <form action={findInternshipsFromJobsAction}>
              <SubmitButton className="primary" pendingLabel="Recherche en cours…">
                Chercher des stages
              </SubmitButton>
            </form>
            <AutoApplyAction />
            <Link href="/jobs/new" className="btn">
              Ajouter une offre
            </Link>
            <Link href="/pipeline" className="btn">
              My Applications
            </Link>
          </>
        }
      />

      <FlowStrip current="offers" />

      {sp.found === "1" ? (
        <Flash>
          Recherche terminée. {sp.new ?? "0"} nouvelles offres, {sp.qualified ?? "0"} qualifiées sur{" "}
          {sp.boards ?? "0"} boards.
          {Number(sp.prepared) > 0
            ? ` ${sp.prepared} candidature${Number(sp.prepared) > 1 ? "s" : ""} prête${Number(sp.prepared) > 1 ? "s" : ""} à approuver.`
            : null}
        </Flash>
      ) : null}

      <HeroMetric
        value={summary.priorityOpen}
        label="Score 85 et plus"
        tone={summary.priorityOpen > 0 ? "good" : undefined}
        aside={
          <>
            <span>{summary.openJobs} ouvertes</span>
            <Link href="/board">{summary.tracked} suivies</Link>
            {summary.followupsDue > 0 ? (
              <Link href="/followups" className="is-alert">
                {summary.followupsDue} relance{summary.followupsDue > 1 ? "s" : ""}
              </Link>
            ) : (
              <Link href="/followups">Relances</Link>
            )}
          </>
        }
      />

      {/* Client-side GET navigation: filtering keeps the shell and the scroll
          position instead of reloading the page. */}
      <Form action="" scroll={false} className="filters" role="search">
        <AutoSubmit />
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

        <Select
          name="category"
          ariaLabel="Catégorie"
          defaultValue={categoryFilter ?? ""}
          placeholder="Toutes catégories"
          compact
          autoSubmit
          options={[
            { value: "", label: "Toutes catégories" },
            ...INTERNSHIP_CATEGORIES.map((c) => ({ value: c, label: INTERNSHIP_CATEGORY_LABEL_FR[c] })),
          ]}
        />

        <label className="check">
          <input type="checkbox" name="email" value="1" defaultChecked={withEmail} />
          Avec email
        </label>
        <label className="check">
          <input type="checkbox" name="untracked" value="1" defaultChecked={untrackedOnly} />
          Non suivies
        </label>
        <label className="check">
          <input type="checkbox" name="closed" value="1" defaultChecked={includeClosed} />
          Fermées
        </label>
        <label className="check">
          <input type="checkbox" name="skipped" value="1" defaultChecked={includeSkipped} />
          Rejetées
        </label>

        <Select
          name="min"
          ariaLabel="Score minimum"
          defaultValue={minScore === undefined ? "" : String(minScore)}
          placeholder="Score minimum"
          compact
          autoSubmit
          options={MIN_SCORE_OPTIONS}
        />
        <Select
          name="sort"
          ariaLabel="Ordre de la liste"
          defaultValue={sort}
          placeholder="Ordre"
          compact
          autoSubmit
          options={JOB_SORT_OPTIONS}
        />

        <SubmitButton className="primary">Filtrer</SubmitButton>
        {filtered || sort !== "best" ? (
          <Link href="/" className="btn ghost">
            Réinitialiser
          </Link>
        ) : null}
      </Form>

      <p className="result-count" aria-live="polite">
        {sortedJobs.length} {sortedJobs.length === 1 ? "offre" : "offres"}
        {filtered ? `, filtrées par ${activeFilters.join(", ")}` : null} · {jobSortLabel(sort)}
      </p>

      {sortedJobs.length === 0 ? (
        <EmptyState
          title={filtered ? "Aucune offre ne correspond à ces filtres" : "Aucune offre pour le moment"}
          actions={
            filtered ? (
              <Link href="/" className="btn">
                Effacer les filtres
              </Link>
            ) : (
              <>
                <Link href="/pipeline" className="btn primary">
                  My Applications
                </Link>
                <Link href="/jobs/new" className="btn">
                  Ajouter une offre
                </Link>
              </>
            )
          }
        >
          {filtered ? "Baisse le score minimum, ou coche « Rejetées » ou « Fermées », pour voir plus d’offres." : null}
        </EmptyState>
      ) : (
        <TableWrap>
          <JobsTable jobs={sortedJobs} />
        </TableWrap>
      )}
    </>
  );
}
