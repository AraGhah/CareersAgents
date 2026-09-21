import Link from "next/link";
import { day } from "../../lib/format";
import { listOpenFollowups } from "../../lib/followups";
import { pool } from "../../lib/db";

export default async function FollowupsPage() {
  const followups = await listOpenFollowups();
  const { rows: recent } = await pool.query<{
    id: string;
    subject: string | null;
    classification: string | null;
    occurred_at: Date;
    company_name: string | null;
    title: string | null;
    application_id: string | null;
  }>(
    `SELECT m.id, m.subject, m.classification, m.occurred_at,
            c.name AS company_name, j.title, m.application_id
       FROM messages m
       LEFT JOIN applications a ON a.id = m.application_id
       LEFT JOIN jobs j ON j.id = a.job_id
       LEFT JOIN companies c ON c.id = j.company_id
      ORDER BY m.occurred_at DESC
      LIMIT 25`,
  );

  const dueSoon = followups.filter((f) => f.state === "pending").length;
  const drafted = followups.filter((f) => f.state === "drafted").length;

  return (
    <>
      <h1>Follow-ups</h1>
      <p className="lede">
        {dueSoon} pending, {drafted} drafted in Gmail. Drafts are prepared for you; nothing is sent
        until you press send in Gmail.
      </p>

      {followups.length === 0 ? (
        <p className="empty">
          No open follow-ups. They appear when an application moves to submitted (day 7 and day 14).
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Due</th>
              <th>State</th>
              <th>Company</th>
              <th>Role</th>
              <th>Application</th>
            </tr>
          </thead>
          <tbody>
            {followups.map((f) => (
              <tr key={f.id}>
                <td className="tight">{f.due_on}</td>
                <td>
                  <span className="badge">{f.state}</span>
                </td>
                <td>{f.company_name}</td>
                <td>{f.title}</td>
                <td>
                  <Link href={`/applications/${f.application_id}`}>
                    <span className="badge">{f.status}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent inbox matches</h2>
      {recent.length === 0 ? (
        <p className="empty">Nothing synced yet. Run npm run sync:inbox after gmail:auth.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Classification</th>
              <th>Subject</th>
              <th>Matched</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((m) => (
              <tr key={m.id}>
                <td className="tight">{day(m.occurred_at)}</td>
                <td>
                  {m.classification ? (
                    <span className="badge">{m.classification}</span>
                  ) : (
                    <span className="empty">unclassified</span>
                  )}
                </td>
                <td>{m.subject ?? "\u2014"}</td>
                <td>
                  {m.application_id ? (
                    <Link href={`/applications/${m.application_id}`}>
                      {m.company_name}
                      {m.title ? ` · ${m.title}` : ""}
                    </Link>
                  ) : (
                    <span className="empty">unmatched</span>
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
