import Link from "next/link";
import { notFound } from "next/navigation";
import { changeStatus, saveApplication } from "../../actions";
import { day, place } from "../../../lib/format";
import { getApplication } from "../../../lib/queries";
import { APPLICATION_STATUSES } from "../../../lib/types";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app) notFound();

  return (
    <>
      <h1>{app.title}</h1>
      <p className="lede">
        {app.company_name}
        {app.company_city ? ` \u00b7 ${app.company_city}` : ""}
        {" \u2014 "}
        <a href={app.url} target="_blank" rel="noreferrer">
          the posting
        </a>
        {app.company_website ? (
          <>
            {" \u00b7 "}
            <a href={app.company_website} target="_blank" rel="noreferrer">
              company site
            </a>
          </>
        ) : null}
      </p>

      <div className="panel">
        <dl className="facts">
          <dt>Status</dt>
          <dd>
            <form action={changeStatus} className="filters" style={{ marginBottom: 0 }}>
              <input type="hidden" name="applicationId" value={app.id} />
              <select name="status" defaultValue={app.status}>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button type="submit">Update</button>
            </form>
          </dd>

          <dt>Submitted</dt>
          <dd>{day(app.submitted_at)}</dd>

          <dt>Where</dt>
          <dd>{place(app.location, app.workplace_type)}</dd>

          <dt>Posted</dt>
          <dd>{day(app.posted_at)}</dd>

          <dt>Posting</dt>
          <dd>{app.closed_at ? `closed ${day(app.closed_at)}` : "open"}</dd>
        </dl>
      </div>

      <form action={saveApplication} className="panel">
        <input type="hidden" name="applicationId" value={app.id} />
        <div className="row">
          <div className="field">
            <label htmlFor="resumePath">Resume file</label>
            <input
              type="text"
              id="resumePath"
              name="resumePath"
              defaultValue={app.resume_path ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="coverLetterPath">Cover letter file</label>
            <input
              type="text"
              id="coverLetterPath"
              name="coverLetterPath"
              defaultValue={app.cover_letter_path ?? ""}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={6} defaultValue={app.notes ?? ""} />
        </div>
        <button type="submit" className="primary">
          Save
        </button>
      </form>

      <h2>Posting text</h2>
      <div className="panel">
        {app.description ? (
          <pre className="description">{app.description}</pre>
        ) : (
          <p className="empty">No description stored for this one.</p>
        )}
      </div>

      <p>
        <Link href="/board">Back to the board</Link>
      </p>
    </>
  );
}
