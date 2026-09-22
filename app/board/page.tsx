import Link from "next/link";
import { day } from "../../lib/format";
import { listApplications } from "../../lib/queries";
import { APPLICATION_STATUSES } from "../../lib/types";
import { APPLICATION_STATUS_FR } from "../../lib/status-labels";

export default async function BoardPage() {
  const applications = await listApplications();

  const live = applications.filter(
    (a) => !["rejected", "withdrawn"].includes(a.status),
  ).length;

  return (
    <>
      <h1>Board</h1>
      <p className="lede">
        {applications.length} {applications.length === 1 ? "application" : "applications"}, {live}{" "}
        still alive.
      </p>

      <div className="board">
        {APPLICATION_STATUSES.map((status) => {
          const column = applications.filter((a) => a.status === status);
          return (
            <section key={status}>
              <h3>
                {APPLICATION_STATUS_FR[status]} ({column.length})
              </h3>
              {column.length === 0 ? (
                <p className="empty">&mdash;</p>
              ) : (
                <ul>
                  {column.map((a) => (
                    <li key={a.id}>
                      <Link href={`/applications/${a.id}`}>{a.title}</Link>
                      <div className="co">
                        {a.company_name}
                        {a.submitted_at ? ` \u00b7 ${day(a.submitted_at)}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
