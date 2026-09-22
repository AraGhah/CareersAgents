import Link from "next/link";
import { findInternshipsAction } from "../actions";
import { day, percent, place } from "../../lib/format";
import { listPipelineRows } from "../../lib/queries";
import { listSourceCapabilities, assistedModeDefault, gmailSendAllowed } from "../../lib/sources";
import { APPLICATION_STATUS_FR } from "../../lib/status-labels";
import { PIPELINE_STATUSES } from "../../lib/types";
import { getActiveResume } from "../../lib/resumes";
import { bandOf } from "../../lib/score";

type Search = {
  found?: string;
  new?: string;
  qualified?: string;
  boards?: string;
};

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const [rows, sources, en, fr] = await Promise.all([
    listPipelineRows(),
    Promise.resolve(listSourceCapabilities()),
    getActiveResume("en"),
    getActiveResume("fr"),
  ]);

  return (
    <>
      <h1>Pipeline</h1>
      <p className="lede">
        Mode assisté : le desk trouve, matche au CV, recherche l&apos;entreprise et le contact, prépare
        l&apos;email — tu approuves avant tout envoi Gmail
        {assistedModeDefault() ? " (Assisted Mode ON)" : ""}.
        {gmailSendAllowed()
          ? " GMAIL_ALLOW_SEND est actif."
          : " Par défaut : brouillon Gmail après approbation (pas d'envoi auto)."}
      </p>

      {sp.found === "1" ? (
        <p className="lede">
          Recherche terminée : {sp.new ?? "0"} nouvelles offres, {sp.qualified ?? "0"} qualifiées,{" "}
          {sp.boards ?? "0"} boards ATS.
        </p>
      ) : null}

      <div className="stats">
        <article>
          <strong>{en ? "EN" : "—"}</strong>
          <span>{en?.label ?? "Pas de CV EN"}</span>
        </article>
        <article>
          <strong>{fr ? "FR" : "—"}</strong>
          <span>{fr?.label ?? "Pas de CV FR"}</span>
        </article>
        <article>
          <strong>{rows.filter((r) => r.status === "qualified" || r.status === "ready").length}</strong>
          <span>À préparer / prêts</span>
        </article>
        <article>
          <strong>{rows.filter((r) => r.status === "applied" || r.status === "followup").length}</strong>
          <span>Postulé / relance</span>
        </article>
      </div>

      <form action={findInternshipsAction} className="panel filters">
        <button type="submit" className="primary">
          Find Internships
        </button>
        <span className="empty">
          ATS réels (Greenhouse / Lever / Workable / Ashby) + score CV. LinkedIn / Indeed seulement si
          clés API autorisées.
        </span>
      </form>

      <h2>Sources</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Disponible</th>
            <th>Détail</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td>
                <span className={`badge ${s.available ? "green" : "yellow"}`}>
                  {s.available ? "oui" : "non"}
                </span>
              </td>
              <td>{s.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Kanban</h2>
      <div className="board">
        {PIPELINE_STATUSES.filter((s) => !["withdrawn"].includes(s)).map((status) => {
          const column = rows.filter((r) => r.status === status);
          return (
            <section key={status}>
              <h3>
                {APPLICATION_STATUS_FR[status]} ({column.length})
              </h3>
              {column.length === 0 ? (
                <p className="empty">&mdash;</p>
              ) : (
                <ul>
                  {column.map((r) => (
                    <li key={r.application_id}>
                      <Link href={`/applications/${r.application_id}`}>{r.title}</Link>
                      <div className="co">
                        {r.company_name}
                        {r.score != null
                          ? ` · ${percent(Number(r.score))}`
                          : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <h2>Dashboard</h2>
      {rows.length === 0 ? (
        <p className="empty">
          Aucune candidature. Clique <strong>Find Internships</strong> ou{" "}
          <Link href="/jobs/new">ajoute une offre</Link>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Position</th>
              <th>Location</th>
              <th>Match</th>
              <th>Source</th>
              <th>Recruiter</th>
              <th>Email</th>
              <th>Status</th>
              <th>Applied</th>
              <th>Next follow-up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.score != null ? Math.round(Number(r.score) * 100) : null;
              const band = pct != null ? bandOf(pct, Boolean(r.gated)) : null;
              return (
                <tr key={r.application_id}>
                  <td>{r.company_name}</td>
                  <td>
                    <Link href={`/applications/${r.application_id}`}>{r.title}</Link>
                  </td>
                  <td>{place(r.location, null)}</td>
                  <td>
                    {pct != null ? (
                      <span className={`badge ${band ?? ""}`}>{pct}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{r.source ?? "—"}</td>
                  <td>{r.recruiter_name ?? "—"}</td>
                  <td>{r.recruiter_email ?? "—"}</td>
                  <td>
                    <span className="badge">{APPLICATION_STATUS_FR[r.status]}</span>
                    {r.outreach_approved ? (
                      <>
                        {" "}
                        <span className="badge green">approuvé</span>
                      </>
                    ) : null}
                  </td>
                  <td>{day(r.submitted_at)}</td>
                  <td>{r.next_followup ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p>
        <Link href="/resumes">Changer le CV actif</Link>
        {" · "}
        <Link href="/">Offres</Link>
      </p>
    </>
  );
}
