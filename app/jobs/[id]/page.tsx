import Link from "next/link";
import { notFound } from "next/navigation";
import { trackJob } from "../../actions";
import { day, percent, place } from "../../../lib/format";
import { getJob } from "../../../lib/queries";
import {
  COMPONENT_NAMES,
  bandOf,
  explain,
  explainFr,
  findSkills,
  type Components,
} from "../../../lib/score";
import { COMPONENT_LABEL_FR } from "../../../lib/status-labels";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const components = {} as Components;
  for (const name of COMPONENT_NAMES) {
    const row = job.components.find((c) => c.component === name);
    components[name] = row ? Number(row.raw_value) : 0;
  }
  const scored = job.components.length > 0;
  const pct = scored ? Math.round(Number(job.score) * 100) : null;
  const gated = Boolean(job.gated);
  const band = pct == null ? null : bandOf(pct, gated);
  const explanation = scored ? explain(components, pct ?? 0, gated) : null;
  const explanationFr = scored ? explainFr(components, pct ?? 0, gated) : null;
  const found = findSkills(
    [job.title, job.location, job.workplace_type, job.company_city, job.description]
      .filter(Boolean)
      .join("\n"),
  );

  return (
    <>
      <h1>{job.title}</h1>
      <p className="lede">
        {job.company_name}
        {job.company_city ? ` \u00b7 ${job.company_city}` : ""}
        {" \u2014 "}
        <a href={job.url} target="_blank" rel="noreferrer">
          the posting
        </a>
        {job.closed_at ? ` \u00b7 closed ${day(job.closed_at)}` : ""}
      </p>

      <div className="panel">
        <dl className="facts">
          <dt>Where</dt>
          <dd>{place(job.location, job.workplace_type)}</dd>
          <dt>Posted</dt>
          <dd>{day(job.posted_at)}</dd>
          <dt>First seen</dt>
          <dd>{day(job.first_seen_at)}</dd>
          <dt>Score</dt>
          <dd>
            {scored ? (
              <>
                <span className={`badge ${band}`}>{gated ? "skip" : pct}</span>
                {gated ? " \u2014 location or timing is 0" : null}
              </>
            ) : (
              <span className="empty">not scored yet. Run npm run score.</span>
            )}
          </dd>
          <dt>Application</dt>
          <dd>
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
          </dd>
        </dl>
      </div>

      {scored ? (
        <>
          <h2>Components</h2>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Value</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {COMPONENT_NAMES.map((name) => {
                const row = job.components.find((c) => c.component === name);
                return (
                  <tr key={name}>
                    <td>
                      {name}
                      <span className="empty"> ({COMPONENT_LABEL_FR[name] ?? name})</span>
                    </td>
                    <td>{percent(row?.raw_value ?? null)}</td>
                    <td className="tight">{row ? percent(row.weight) : "\u2014"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {explanation || explanationFr ? (
            <div className="two-col-explain">
              {explanation ? <p className="lede">{explanation}</p> : null}
              {explanationFr ? <p className="lede">{explanationFr}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}

      <h2>Keywords in the posting</h2>
      {found.length === 0 ? (
        <p className="empty">None of the dictionary skills showed up in the text.</p>
      ) : (
        <p>
          {found.map((s) => (
            <span key={s.name} className={`badge ${s.have ? "green" : ""}`}>
              {s.name}
              {s.have ? "" : " \u2014 missing"}
            </span>
          ))}
        </p>
      )}

      <h2>Posting text</h2>
      <div className="panel">
        {job.description ? (
          <pre className="description">{job.description}</pre>
        ) : (
          <p className="empty">No description stored for this one.</p>
        )}
      </div>

      <p>
        <Link href="/">Back to openings</Link>
      </p>
    </>
  );
}