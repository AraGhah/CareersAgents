import Link from "next/link";
import { trackJob } from "./actions";
import { day, place } from "../lib/format";
import { listJobs } from "../lib/queries";

type Search = { q?: string; closed?: string; untracked?: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const search = sp.q?.trim() || undefined;
  const includeClosed = sp.closed === "1";
  const untrackedOnly = sp.untracked === "1";

  const jobs = await listJobs({ search, includeClosed, untrackedOnly });

  return (
    <>
      <h1>Openings</h1>
      <p className="lede">
        {jobs.length} {jobs.length === 1 ? "posting" : "postings"}
        {includeClosed ? ", closed ones included" : ", open only"}
        {untrackedOnly ? ", not tracked yet" : ""}.
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
              <th>First seen</th>
              <th>Application</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <a href={job.url} target="_blank" rel="noreferrer">
                    {job.title}
                  </a>
                  {job.closed_at ? <span className="badge"> closed</span> : null}
                </td>
                <td>{job.company_name}</td>
                <td>{place(job.location, job.workplace_type)}</td>
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
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
