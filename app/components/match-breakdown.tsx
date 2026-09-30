import { fr1 } from "../../lib/match/for-job";
import { BAND_LABEL_FR } from "../../lib/status-labels";
import type { MatchReport, Section as PostingSection } from "../../lib/match/types";

const SECTION_FR: Record<PostingSection, string> = {
  title: "dans le titre",
  required: "exigé",
  responsibility: "responsabilités",
  mentioned: "mentionné",
  nice: "atout",
  about: "présentation",
};

const CONFIDENCE_FR = { high: "élevée", medium: "moyenne", low: "faible" } as const;
const CONFIDENCE_TONE = { high: "green", medium: "yellow", low: "neutral" } as const;

/**
 * Why the percentage is what it is: each criterion with its score, its weight and the points it adds, then the
 * technologies and practices the posting asks for, split into what the CV shows, what is close, and what is missing.
 */
export function MatchBreakdown({ report, storedPercent }: { report: MatchReport; storedPercent?: number | null }) {
  const band = BAND_LABEL_FR[report.band] ?? report.band;
  const stale = storedPercent != null && Math.abs(storedPercent - report.percentPrecise) >= 0.6;
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Correspondance avec ton CV</span>
          <span className={`badge ${CONFIDENCE_TONE[report.confidence]}`}>Fiabilité {CONFIDENCE_FR[report.confidence]}</span>
        </div>
        <p style={{ margin: "var(--s-2) 0", fontSize: "2.2rem", fontWeight: 650, lineHeight: 1.1 }}>
          {fr1(report.percentPrecise)} %{" "}
          <span className="muted" style={{ fontSize: "1rem", fontWeight: 400 }}>
            {report.gated ? "· offre écartée" : `· ${band}`}
          </span>
        </p>
        {report.gated ? (
          <p className="small" role="status">
            <strong>Écartée :</strong> {report.gateReasons.join(" ; ")}. Le score reste affiché pour information.
          </p>
        ) : null}
        {report.notes.map((n) => (
          <p key={n} className="small muted">
            {n}
          </p>
        ))}
        {stale ? (
          <p className="small muted">
            Le score enregistré ({fr1(storedPercent!)} %) date d&apos;avant un changement de CV ou de règles : lance <code>npm run score</code> pour le mettre à jour.
          </p>
        ) : null}
      </div>

      <div className="table-wrap stackable">
        <table>
          <caption className="visually-hidden">Détail du score de correspondance, critère par critère</caption>
          <thead>
            <tr>
              <th scope="col">Critère</th>
              <th scope="col" className="tight">Score</th>
              <th scope="col" className="tight">Poids</th>
              <th scope="col" className="tight">Points</th>
              <th scope="col">Constat</th>
            </tr>
          </thead>
          <tbody>
            {report.criteria.map((c) => (
              <tr key={c.id}>
                <td data-label="Critère">
                  <span className="cell-main">{c.label}</span>
                </td>
                <td data-label="Score" className="tight num">
                  {Math.round(c.score * 100)} %
                </td>
                <td data-label="Poids" className="tight num muted">
                  {Math.round(c.weight * 100)} %
                </td>
                <td data-label="Points" className="tight num">
                  {fr1(c.score * c.weight * 100)}
                </td>
                <td data-label="Constat">
                  {c.verdict}
                  {c.details.length ? (
                    <ul className="small muted" style={{ margin: "var(--s-1) 0 0", paddingLeft: "1.1em" }}>
                      {c.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td className="tight num">
                <strong>{fr1(report.percentPrecise)}</strong>
              </td>
              <td className="muted small">Somme des points ; lieu, période ou poste à 0 écarte l&apos;offre.</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Technologies demandées</span>
        </div>
        {report.skills.matched.length + report.skills.related.length + report.skills.missing.length === 0 ? (
          <p className="empty" style={{ margin: 0 }}>
            {report.hasDescription ? "Aucune technologie connue n'est nommée dans l'offre." : "Pas de description : les technologies demandées sont inconnues."}
          </p>
        ) : (
          <div className="stack">
            {report.skills.matched.length ? (
              <div>
                <div className="small muted">Dans ton CV</div>
                <p className="tag-list">
                  {report.skills.matched.map((s) => (
                    <span key={s.name} className="badge green" title={`${s.evidence} · ${SECTION_FR[s.section]}`}>
                      {s.name}
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
            {report.skills.related.length ? (
              <div>
                <div className="small muted">Proches de ce que tu connais (crédit partiel)</div>
                <p className="tag-list">
                  {report.skills.related.map((s) => (
                    <span key={s.name} className="badge yellow" title={`${SECTION_FR[s.section]} · crédit ${Math.round(s.credit * 100)} % grâce à ${s.via}`}>
                      {s.name} ≈ {s.via}
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
            {report.skills.missing.length ? (
              <div>
                <div className="small muted">Absentes de ton CV</div>
                <p className="tag-list">
                  {report.skills.missing.map((s) => (
                    <span key={s.name} className="badge neutral" title={SECTION_FR[s.section]}>
                      {s.name}
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {report.concepts.matched.length + report.concepts.missing.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Pratiques et domaines</span>
          </div>
          <p className="tag-list">
            {report.concepts.matched.map((c) => (
              <span key={c} className="badge green">
                {c}
              </span>
            ))}
            {report.concepts.missing.map((c) => (
              <span key={c} className="badge neutral" title="Ton CV n'en parle pas">
                {c}
              </span>
            ))}
          </p>
        </div>
      ) : null}
    </div>
  );
}
