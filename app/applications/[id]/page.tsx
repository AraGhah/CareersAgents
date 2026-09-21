import Link from "next/link";
import { notFound } from "next/navigation";
import { buildPackage, changeStatus, saveApplication } from "../../actions";
import { day, place } from "../../../lib/format";
import { detectCategories } from "../../../lib/category";
import { detectLetterLang } from "../../../lib/letter";
import { loadAnswerBank } from "../../../lib/package";
import { loadStoredPackage } from "../../../lib/package-store";
import { getApplication } from "../../../lib/queries";
import { APPLICATION_STATUSES } from "../../../lib/types";

type Search = { built?: string };

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const app = await getApplication(id);
  if (!app) notFound();

  const lang = detectLetterLang(app.title, app.description);
  const categories = detectCategories(app.title, app.description);
  const bank = await loadAnswerBank(lang);
  const stored = await loadStoredPackage(app.cover_letter_path);
  const checklist = stored?.checklist ?? [];
  const allClear = checklist.length > 0 && checklist.every((c) => c.ok);

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

      {sp.built === "1" ? (
        <p className="lede">Package written. Read the letter and the checklist before you submit anything.</p>
      ) : null}

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

          <dt>Detected as</dt>
          <dd>{categories.join(", ")}</dd>
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
              placeholder="C:\\path\\to\\resume.pdf"
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

      <h2>Application package</h2>
      <p className="lede">
        The letter is filled only from the answer bank, the selected projects, and a company fact you
        write with its source URL. Green answers paste as-is. Yellow ones you reword yourself. Red
        ones stay empty until you type them.
      </p>

      <form action={buildPackage} className="panel">
        <input type="hidden" name="applicationId" value={app.id} />
        <div className="field">
          <label htmlFor="companyFact">Company fact (your words)</label>
          <textarea
            id="companyFact"
            name="companyFact"
            rows={3}
            required
            defaultValue={stored?.companyFact ?? ""}
            placeholder="One concrete fact about this company that is true and yours."
          />
        </div>
        <div className="field">
          <label htmlFor="companyFactSource">Source URL for that fact</label>
          <input
            type="url"
            id="companyFactSource"
            name="companyFactSource"
            required
            defaultValue={stored?.companyFactSource ?? app.company_website ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="lang">Letter language</label>
          <select id="lang" name="lang" defaultValue={stored?.lang ?? lang}>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
        </div>
        <button type="submit" className="primary">
          Build letter and checklist
        </button>
      </form>

      {stored?.letter ? (
        <>
          <h2>Draft letter ({stored.lang})</h2>
          <p className="lede">
            Projects used: {(stored.projects ?? []).join(", ") || "none"}. Files under{" "}
            <code>{stored.dir}</code>.
          </p>
          <div className="panel">
            <pre className="description">{stored.letter}</pre>
          </div>

          <h2>Noun check</h2>
          {(stored.flags ?? []).length === 0 ? (
            <p className="empty">No proper noun outside the letter input.</p>
          ) : (
            <ul>
              {(stored.flags ?? []).map((f) => (
                <li key={f.word}>
                  <span className="badge red">{f.word}</span> {f.reason}
                </li>
              ))}
            </ul>
          )}

          <h2>Pre-submit checklist</h2>
          <p className="lede">
            {allClear
              ? "Every check passed. You still submit by hand."
              : "Fix the failed checks before you treat this package as ready."}
          </p>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Result</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {checklist.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    <span className={`badge ${c.ok ? "green" : "red"}`}>{c.ok ? "ok" : "fail"}</span>
                  </td>
                  <td>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Answer bank for this form</h2>
      <p className="lede">
        Lookup first. Green goes in unchanged. Yellow is a starting point you rewrite for this
        posting. Red is shown so you remember the topic, then you type the answer yourself.
      </p>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>How</th>
            <th>Text ({lang})</th>
          </tr>
        </thead>
        <tbody>
          {bank.map((a) => (
            <tr key={a.key}>
              <td>{a.key}</td>
              <td>
                <span className={`badge ${a.category}`}>
                  {a.mode === "verbatim"
                    ? "paste as-is"
                    : a.mode === "reword"
                      ? "reword yourself"
                      : "type yourself"}
                </span>
              </td>
              <td>
                {a.mode === "manual" ? (
                  <span className="empty">{a.text ?? "no stored text — type it on the form"}</span>
                ) : (
                  (a.text ?? <span className="empty">to write</span>)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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
