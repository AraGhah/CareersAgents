import Link from "next/link";
import { findInternshipsAction } from "../actions";
import { Flash, SubmitButton } from "../components/client-ui";
import {
  DbUnavailable,
  EmptyState,
  PageHeader,
  ScoreMeter,
  Section,
  Stat,
  StatusPill,
  TableWrap,
} from "../components/ui";
import { day, place } from "../../lib/format";
import { listPipelineRows } from "../../lib/queries";
import { listSourceCapabilities, assistedModeDefault, gmailSendAllowed } from "../../lib/sources";
import { APPLICATION_STATUS_FR } from "../../lib/status-labels";
import { PIPELINE_STATUSES } from "../../lib/types";
import { getActiveResume } from "../../lib/resumes";

type Search = {
  found?: string;
  new?: string;
  qualified?: string;
  boards?: string;
  prepared?: string;
};

export const metadata = { title: "Pipeline" };

const FLOW = [
  "Trouver les offres (ATS réels + LinkedIn si configuré)",
  "Matcher avec le CV actif et qualifier automatiquement",
  "Rechercher l'entreprise et un contact public — automatique",
  "Rédiger un email personnalisé — automatique",
  "Ton approbation — rien ne part sans elle",
  "Brouillon Gmail, puis suivi des relances",
];

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  let rows, sources, en, fr;
  try {
    [rows, sources, en, fr] = await Promise.all([
      listPipelineRows(),
      Promise.resolve(listSourceCapabilities()),
      getActiveResume("en"),
      getActiveResume("fr"),
    ]);
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Mode assisté" title="Pipeline" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const toPrepare = rows.filter((r) => r.status === "qualified" || r.status === "ready").length;
  const inFlight = rows.filter((r) => r.status === "applied" || r.status === "followup").length;
  const availableSources = sources.filter((s) => s.available).length;
  const columns = PIPELINE_STATUSES.filter((s) => s !== "withdrawn");

  return (
    <>
      <PageHeader
        eyebrow={assistedModeDefault() ? "Mode assisté · actif" : "Mode assisté"}
        title="Pipeline"
        lede="Le desk trouve, score, recherche l'entreprise et prépare l'email. Tu gardes la main sur le dernier geste : aucun envoi sans ton approbation."
      />

      {sp.found === "1" ? (
        <Flash>
          Recherche terminée — <strong>{sp.new ?? "0"}</strong> nouvelles offres,{" "}
          <strong>{sp.qualified ?? "0"}</strong> qualifiées, <strong>{sp.boards ?? "0"}</strong>{" "}
          boards ATS consultés.
          {Number(sp.prepared) > 0 ? (
            <>
              {" "}
              <strong>{sp.prepared}</strong> déjà préparée{Number(sp.prepared) > 1 ? "s" : ""}{" "}
              (recherche + contact + brouillon d&apos;email) — reste à approuver.
            </>
          ) : null}
        </Flash>
      ) : null}

      {!en && !fr ? (
        <Flash tone="warn">
          Aucun CV actif : le matching et les emails ne peuvent pas être personnalisés.{" "}
          <Link href="/resumes">Uploader un CV</Link>.
        </Flash>
      ) : null}

      <div className="stats">
        <Stat
          value={en ? "EN" : "—"}
          label={en?.label ?? "Pas de CV anglais actif"}
          href="/resumes"
          tone={en ? "good" : undefined}
        />
        <Stat
          value={fr ? "FR" : "—"}
          label={fr?.label ?? "Pas de CV français actif"}
          href="/resumes"
          tone={fr ? "good" : undefined}
        />
        <Stat value={toPrepare} label="À préparer ou prêtes" />
        <Stat value={inFlight} label="Postulées ou en relance" href="/followups" />
      </div>

      <Section
        n="01"
        title="Recherche"
        note={`${availableSources} source${availableSources === 1 ? "" : "s"} sur ${sources.length} disponible${availableSources === 1 ? "" : "s"}`}
        id="recherche"
      >
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Comment ça marche</span>
            <span className="badge neutral">
              {gmailSendAllowed() ? "Envoi Gmail autorisé" : "Brouillon Gmail seulement"}
            </span>
          </div>

          <ol className="steps" style={{ marginBottom: "var(--s-5)" }}>
            {FLOW.map((s) => (
              <li key={s} className="step">
                {s}
              </li>
            ))}
          </ol>

          <form action={findInternshipsAction} className="form-actions">
            <SubmitButton className="primary" pendingLabel="Recherche en cours…">
              Chercher des stages
            </SubmitButton>
            <span className="small muted grow">
              Interroge les ATS réels (Greenhouse, Lever, Workable, Ashby) puis score chaque offre
              contre ton CV. LinkedIn et Indeed tournent chacun si leur acteur Apify est
              configuré (Indeed n&apos;a plus d&apos;API officielle depuis 2023 — seul Apify
              fonctionne). Chaque offre qualifiée est automatiquement suivie, recherchée et son
              email préparé — il ne reste que ton approbation. Programme
              <code> npm run automate</code> pour que ça tourne tout seul, sans revenir ici.
            </span>
          </form>
        </div>

        <TableWrap>
          <table>
            <caption className="visually-hidden">Disponibilité de chaque source d&apos;offres</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Disponible</th>
                <th scope="col">Détail</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td data-label="Source" className="cell-main">
                    {s.label}
                  </td>
                  <td data-label="Disponible">
                    <span className={`badge ${s.available ? "green" : "neutral"}`}>
                      <span className="dot" aria-hidden="true" />
                      {s.available ? "oui" : "non"}
                    </span>
                  </td>
                  <td data-label="Détail" className="muted">
                    {s.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section n="02" title="Kanban" note={`${rows.length} candidature${rows.length === 1 ? "" : "s"}`} id="kanban">
        <div className="board">
          {columns.map((status) => {
            const column = rows.filter((r) => r.status === status);
            return (
              <section key={status} className={`board-col${column.length === 0 ? " is-empty" : ""}`}>
                <h3>
                  {APPLICATION_STATUS_FR[status]}
                  <span className="count">{column.length}</span>
                </h3>
                {column.length === 0 ? (
                  <p className="board-empty">—</p>
                ) : (
                  <ul>
                    {column.map((r) => (
                      <li key={r.application_id}>
                        <Link href={`/applications/${r.application_id}`} className="board-card">
                          {r.title}
                          <span className="co">
                            {r.company_name}
                            {r.score != null ? (
                              <span className="mono">{Math.round(Number(r.score) * 100)}</span>
                            ) : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </Section>

      <Section n="03" title="Tableau de bord" id="tableau">
        {rows.length === 0 ? (
          <EmptyState
            mark="Aucune candidature"
            title="Le pipeline est vide"
            actions={
              <>
                <Link href="#recherche" className="btn primary">
                  Lancer une recherche
                </Link>
                <Link href="/jobs/new" className="btn">
                  Ajouter une offre
                </Link>
              </>
            }
          >
            Dès qu&apos;une offre est suivie, elle apparaît ici avec son score, son contact et sa
            prochaine relance.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">
                Toutes les candidatures suivies, avec leur contact et leur prochaine relance
              </caption>
              <thead>
                <tr>
                  <th scope="col">Poste</th>
                  <th scope="col">Lieu</th>
                  <th scope="col">Score</th>
                  <th scope="col">Source</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="tight">
                    Postulé
                  </th>
                  <th scope="col" className="tight">
                    Relance
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.application_id}>
                    <td data-label="Poste">
                      <Link href={`/applications/${r.application_id}`} className="cell-main">
                        {r.title}
                      </Link>
                      <span className="cell-sub">{r.company_name}</span>
                    </td>
                    <td data-label="Lieu" className="muted">
                      {place(r.location, null)}
                    </td>
                    <td data-label="Score">
                      <ScoreMeter score={r.score} gated={r.gated} />
                    </td>
                    <td data-label="Source" className="muted">
                      {r.source ?? "—"}
                    </td>
                    <td data-label="Contact">
                      {r.recruiter_name || r.recruiter_email ? (
                        <>
                          <span>{r.recruiter_name ?? "—"}</span>
                          {r.recruiter_email ? (
                            <span className="cell-sub mono">{r.recruiter_email}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="empty">—</span>
                      )}
                    </td>
                    <td data-label="Statut">
                      <StatusPill status={r.status} />
                      {r.outreach_approved ? (
                        <span className="cell-sub">
                          <span className="badge green">approuvé</span>
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Postulé" className="tight num muted">
                      {day(r.submitted_at)}
                    </td>
                    <td data-label="Relance" className="tight num muted">
                      {r.next_followup ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/resumes">Changer le CV actif</Link>
        <Link href="/followups">Voir les relances</Link>
        <Link href="/">Retour aux offres</Link>
      </nav>
    </>
  );
}
