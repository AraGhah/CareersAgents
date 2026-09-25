"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { getJobDetailAction, trackJob, type JobRowDetail } from "../actions";
import { SubmitButton } from "./client-ui";
import { CompanyTile, ScoreMeter, StatusPill } from "./ui";
import { Collapse } from "./disclosure";
import { IconChevronDown } from "./icons";
import { day, place } from "../../lib/format";
import { isPriorityCompany } from "../../lib/priority-companies";
import type { JobRow } from "../../lib/types";

export function JobsTable({ jobs }: { jobs: JobRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, JobRowDetail | null>>({});

  function toggle(jobId: string) {
    const next = expandedId === jobId ? null : jobId;
    setExpandedId(next);
    if (next && !(next in details)) {
      getJobDetailAction(next)
        .then((detail) => {
          setDetails((d) => ({ ...d, [next]: detail }));
        })
        .catch(() => {
          setDetails((d) => ({ ...d, [next]: null }));
        });
    }
  }

  return (
    <table className="table-roomy">
      <caption className="visually-hidden">
        Offres trouvées, avec leur score de correspondance et l&apos;état de la candidature
      </caption>
      <thead>
        <tr>
          <th scope="col" className="tight" aria-hidden="true" />
          <th scope="col">Poste</th>
          <th scope="col">Score</th>
          <th scope="col" className="tight">
            Vue le
          </th>
          <th scope="col">Candidature</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const open = expandedId === job.id;
          const detail = details[job.id];
          const panelId = `job-detail-${job.id}`;
          return (
            <Fragment key={job.id}>
              <tr>
                <td className="tight row-expand-cell">
                  <button
                    type="button"
                    className="row-expand-btn"
                    aria-expanded={open}
                    aria-controls={panelId}
                    aria-label={open ? "Masquer les détails" : "Afficher les détails"}
                    onClick={() => toggle(job.id)}
                  >
                    <IconChevronDown className={`disclosure-chevron${open ? " is-open" : ""}`} />
                  </button>
                </td>
                <td data-label="Poste">
                  <div className="job-cell">
                    <CompanyTile name={job.company_name} />
                    <div className="job-cell-text">
                      <Link href={`/jobs/${job.id}`} className="job-title">
                        {job.title}
                      </Link>
                      <span className="job-meta">
                        {job.company_name}
                        {job.location || job.workplace_type
                          ? ` · ${place(job.location, job.workplace_type)}`
                          : ""}
                        {isPriorityCompany(job.company_name) ? (
                          <span className="tag-priority">Prioritaire</span>
                        ) : null}
                        {job.closed_at ? <span className="tag-closed">Fermée</span> : null}
                      </span>
                    </div>
                  </div>
                </td>
                <td data-label="Score">
                  <ScoreMeter score={job.score} gated={job.gated} />
                </td>
                <td data-label="Vue le" className="tight num muted">
                  {day(job.first_seen_at)}
                </td>
                <td data-label="Candidature">
                  {job.application_id ? (
                    <Link href={`/applications/${job.application_id}`}>
                      <StatusPill status={job.status} />
                    </Link>
                  ) : (
                    <form action={trackJob}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <SubmitButton className="small">Suivre</SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
              <tr className={`row-detail${open ? " is-open" : ""}`}>
                <td className="row-detail-cell" colSpan={5}>
                  <Collapse open={open}>
                    <div className="row-detail-inner" id={panelId} role="region">
                      {open && detail === undefined ? (
                        <p className="small muted">Chargement…</p>
                      ) : null}
                      {detail ? (
                        <>
                          <p className="small">
                            {detail.description || "Pas de description disponible."}
                          </p>
                          {detail.explanationFr ? (
                            <p className="small muted">{detail.explanationFr}</p>
                          ) : null}
                          <Link href={`/jobs/${job.id}`} className="small">
                            Détail du score
                          </Link>
                        </>
                      ) : null}
                      {open && detail === null ? (
                        <p className="small muted">Impossible de charger les détails.</p>
                      ) : null}
                    </div>
                  </Collapse>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
