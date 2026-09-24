"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { getJobDetailAction, trackJob, type JobRowDetail } from "../actions";
import { SubmitButton } from "./client-ui";
import { ScoreMeter, StatusPill } from "./ui";
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
      getJobDetailAction(next).then((detail) => {
        setDetails((d) => ({ ...d, [next]: detail }));
      });
    }
  }

  return (
    <table>
      <caption className="visually-hidden">
        Offres trouvées, avec leur score de correspondance et l&apos;état de la candidature
      </caption>
      <thead>
        <tr>
          <th scope="col" className="tight" aria-hidden="true" />
          <th scope="col">Poste</th>
          <th scope="col">Entreprise</th>
          <th scope="col">Lieu</th>
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
          return (
            <Fragment key={job.id}>
              <tr>
                <td className="tight">
                  <button
                    type="button"
                    className="row-expand-btn"
                    aria-expanded={open}
                    aria-label={open ? "Masquer les détails" : "Afficher les détails"}
                    onClick={() => toggle(job.id)}
                  >
                    <IconChevronDown className={`disclosure-chevron${open ? " is-open" : ""}`} />
                  </button>
                </td>
                <td data-label="Poste">
                  <Link href={`/jobs/${job.id}`} className="cell-main">
                    {job.title}
                  </Link>
                  {job.closed_at ? (
                    <span className="cell-sub">
                      <span className="badge neutral">fermée</span>
                    </span>
                  ) : null}
                </td>
                <td data-label="Entreprise">
                  {job.company_name}
                  {isPriorityCompany(job.company_name) ? (
                    <span className="cell-sub">
                      <span className="badge accent">prioritaire</span>
                    </span>
                  ) : null}
                </td>
                <td data-label="Lieu" className="muted">
                  {place(job.location, job.workplace_type)}
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
              <tr className="row-detail">
                <td className="row-detail-cell" colSpan={7}>
                  <Collapse open={open}>
                    <div className="row-detail-inner">
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
