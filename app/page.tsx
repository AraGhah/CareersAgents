import Link from "next/link";
import { trackJob } from "./actions";
import { day, percent, place } from "../lib/format";
import { deskSummary, listJobs } from "../lib/queries";
import { BAND_LABEL_FR } from "../lib/status-labels";
import { bandOf } from "../lib/score";

type Search = {
  q?: string;
  closed?: string;
  untracked?: string;
  low?: string;
  skipped?: string;
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const search = sp.q?.trim() || undefined;
  const includeClosed = sp.closed === "1";
  const untrackedOnly = sp.untracked === "1";
  const includeLow = sp.low === "1";
  const includeSkipped = sp.skipped === "1";

  const [jobs, summary] = await Promise.all([
    listJobs({
      search,
      includeClosed,
      untrackedOnly,
      includeLow,
      includeSkipped,
    }),
    deskSummary(),
  ]);

  return (
    <>
      <h1>Openings</h1>

      <div className="stats">
        <article>
          <strong>{summary.openJobs}</strong>
          <span>Offres ouvertes</span>
        </article>
        <article>
          <strong>{summary.priorityOpen}</strong>
          <span>Score 85+ (priorité)</span>
        </article>
        <article>
          <strong>{summary.tracked}</strong>
          <span>Candidatures suivies</span>
        </article>
        <article>
          <strong>{summary.followupsDue}</strong>
          <span>Relances dues</span>
        </article>
      </div>
      <p className="lede">
        {jobs.length} {jobs.length === 1 ? "posting" : "postings"}
        {includeClosed ? ", closed ones included" : ", open only"}
        {untrackedOnly ? ", not tracked yet" : ""}
        {includeLow ? ", below 60 included" : ", below 60 hidden"}
        {includeSkipped ? ", skipped included" : ""}.
      </p>

      <form className="filters" method="get">
        <input type="text" name="q" placeholder="Role or company" defaultValue={search ?? ""} />
        <label>
          <input type="checkbox" name="untracked" value="1" defaultChecked={untrackedOnly} /> Not
          tracked yet
        </label>
        <label>
          <input type="checkbox" name="closed" value="1" defaultChecked={includeClosed} /> Include
          closed
        </label>
        <label>
          <input type="checkbox" name="low" value="1" defaultChecked={includeLow} /> Below 60
        </label>
        <label>
          <input type="checkbox" name="skipped" value="1" defaultChecked={includeSkipped} /> Skipped
          (location/timing)
        </label>
        <button type="submit">Filter</button>
      </form>

      {jobs.length === 0 ? (
        <p className="empty">
          Nothing here yet. <Link href="/jobs/new">Add a job you found</Link>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Company</th>
              <th>Where</th>
              <th>Score</th>
              <th>First seen</th>
              <th>Application</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const pct = job.score == null ? null : Math.round(Number(job.score) * 100);
              const band = pct == null ? null : bandOf(pct, Boolean(job.gated));
              return (
                <tr key={job.id}>
                  <td>
                    <Link href={`/jobs/${job.id}`}>{job.title}</Link>
                    {job.closed_at ? <span className="badge"> closed</span> : null}
                  </td>
                  <td>{job.company_name}</td>
                  <td>{place(job.location, job.workplace_type)}</td>
                  <td>
                    {pct == null ? (
                      <span className="empty">{"\u2014"}</span>
                    ) : (
                      <span className={`badge ${band}`} title={band ? BAND_LABEL_FR[band] : undefined}>
                        {job.gated ? "skip" : percent(job.score)}
                      </span>
                    )}
                  </td>
                  <td className="tight">{day(job.first_seen_at)}</td>
                  <td>
                    {job.application_id ? (
                      <Link href={`/applications/${job.application_id}`}>
                        <span className="badge">{job.status}</span>
                      </Link>
                    ) : (
                      <form action={trackJob}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <button type="submit">Track</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
