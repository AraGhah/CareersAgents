import Link from "next/link";
import { Select, SubmitButton } from "./components/client-ui";
import { DbUnavailable, EmptyState, PageHeader, Stat, TableWrap } from "./components/ui";
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

type Search = {
  q?: string;
  closed?: string;
  untracked?: string;
  low?: string;
  skipped?: string;
  category?: string;
};

export const metadata = { title: "Offres" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const search = sp.q?.trim() || undefined;
  const includeClosed = sp.closed === "1";
  const untrackedOnly = sp.untracked === "1";
  const includeLow = sp.low === "1";
  const includeSkipped = sp.skipped === "1";

  let jobs, summary, defaultCategory;
  try {
    [jobs, summary, defaultCategory] = await Promise.all([
      listJobs({ search, includeClosed, untrackedOnly, includeLow, includeSkipped }),
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

  // listJobs() intentionally omits the (often large) description column for
  // list-page performance, so category detection here works off the title
  // only — titles for these roles almost always name the category directly.
  const visibleJobs = categoryFilter
    ? jobs.filter((job) => detectInternshipCategories(job.title, null).includes(categoryFilter))
    : jobs;
  const sortedJobs = [...visibleJobs].sort(
    (a, b) => Number(!isPriorityCompany(a.company_name)) - Number(!isPriorityCompany(b.company_name)),
  );

  const activeFilters = [
    search ? `« ${search} »` : null,
    categoryFilter ? INTERNSHIP_CATEGORY_LABEL_FR[categoryFilter] : null,
    untrackedOnly ? "non suivies" : null,
    includeClosed ? "fermées incluses" : null,
    includeLow ? "sous 60 incluses" : null,
    includeSkipped ? "rejetées incluses" : null,
  ].filter(Boolean) as string[];

  const filtered = activeFilters.length > 0;

  return (
    <>
      <PageHeader
        title="Offres"
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
          label="Score 85 et plus"
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

        <Select
          name="category"
          ariaLabel="Catégorie"
          defaultValue={categoryFilter ?? ""}
          placeholder="Toutes catégories"
          compact
          options={[
            { value: "", label: "Toutes catégories" },
            ...INTERNSHIP_CATEGORIES.map((c) => ({ value: c, label: INTERNSHIP_CATEGORY_LABEL_FR[c] })),
          ]}
        />

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

      <p className="result-count" aria-live="polite">
        {sortedJobs.length} {sortedJobs.length === 1 ? "offre" : "offres"}
        {filtered ? `, filtrées par ${activeFilters.join(", ")}` : null}
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
                  Lancer une recherche
                </Link>
                <Link href="/jobs/new" className="btn">
                  Ajouter une offre
                </Link>
              </>
            )
          }
        >
          {filtered ? "Coche « Sous 60 » ou « Fermées » pour voir les offres écartées." : null}
        </EmptyState>
      ) : (
        <TableWrap>
          <JobsTable jobs={sortedJobs} />
        </TableWrap>
      )}
    </>
  );
}
