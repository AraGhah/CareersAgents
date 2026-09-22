import Link from "next/link";
import { day } from "../../lib/format";
import { listOpenFollowups } from "../../lib/followups";
import { pool } from "../../lib/db";
import {
  DbUnavailable,
  EmptyState,
  PageHeader,
  Section,
  Stat,
  StatusPill,
  TableWrap,
} from "../components/ui";

export const metadata = { title: "Relances" };

const STATE_LABEL: Record<string, string> = {
  pending: "à préparer",
  drafted: "brouillon prêt",
  sent: "envoyée",
  skipped: "ignorée",
};

const CLASSIFICATION_TONE: Record<string, string> = {
  rejection: "red",
  interview: "green",
  offer: "green",
  acknowledgement: "neutral",
};

export default async function FollowupsPage() {
  let followups, recent;
  try {
    const result = await Promise.all([
      listOpenFollowups(),
      pool.query<{
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
      ),
    ]);
    followups = result[0];
    recent = result[1].rows;
  } catch (err) {
    return (
      <>
        <PageHeader eyebrow="Suivi" title="Relances" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const pending = followups.filter((f) => f.state === "pending").length;
  const drafted = followups.filter((f) => f.state === "drafted").length;
  const overdue = followups.filter((f) => f.due_on <= today).length;

  return (
    <>
      <PageHeader
        eyebrow="Suivi"
        title="Relances"
        lede="Les relances se planifient toutes seules au jour 7 et au jour 14 après l'envoi. Le desk prépare le brouillon dans Gmail — c'est toi qui appuies sur envoyer."
        actions={
          <Link href="/board" className="btn">
            Voir le board
          </Link>
        }
      />

      <div className="stats">
        <Stat value={overdue} label="Dues aujourd'hui ou en retard" tone={overdue > 0 ? "alert" : undefined} />
        <Stat value={pending} label="À préparer" />
        <Stat value={drafted} label="Brouillons prêts dans Gmail" tone={drafted > 0 ? "good" : undefined} />
        <Stat value={recent.length} label="Messages synchronisés" />
      </div>

      <Section n="01" title="Relances ouvertes" id="ouvertes">
        {followups.length === 0 ? (
          <EmptyState
            mark="Rien à relancer"
            title="Aucune relance ouverte"
            actions={
              <Link href="/pipeline" className="btn">
                Ouvrir le pipeline
              </Link>
            }
          >
            Elles apparaissent dès qu&apos;une candidature passe à « postulé » : une au jour 7, une
            au jour 14.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">Relances planifiées, de la plus urgente à la plus lointaine</caption>
              <thead>
                <tr>
                  <th scope="col" className="tight">
                    Échéance
                  </th>
                  <th scope="col">État</th>
                  <th scope="col">Poste</th>
                  <th scope="col">Candidature</th>
                </tr>
              </thead>
              <tbody>
                {followups.map((f) => {
                  const late = f.due_on <= today;
                  return (
                    <tr key={f.id}>
                      <td data-label="Échéance" className="tight num">
                        {f.due_on}
                        {late ? (
                          <span className="cell-sub">
                            <span className="badge red">à faire</span>
                          </span>
                        ) : null}
                      </td>
                      <td data-label="État">
                        <span className={`badge ${f.state === "drafted" ? "green" : "yellow"}`}>
                          {STATE_LABEL[f.state] ?? f.state}
                        </span>
                      </td>
                      <td data-label="Poste">
                        <span className="cell-main">{f.title}</span>
                        <span className="cell-sub">{f.company_name}</span>
                      </td>
                      <td data-label="Candidature">
                        <Link href={`/applications/${f.application_id}`}>
                          <StatusPill status={f.status} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section n="02" title="Boîte de réception" note="25 derniers messages appariés" id="inbox">
        {recent.length === 0 ? (
          <EmptyState mark="Pas de synchro" title="Aucun message synchronisé">
            Authentifie Gmail puis lance la synchronisation :{" "}
            <code>npm run gmail:auth</code> puis <code>npm run sync:inbox</code>.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">Messages Gmail récents rapprochés des candidatures</caption>
              <thead>
                <tr>
                  <th scope="col" className="tight">
                    Reçu le
                  </th>
                  <th scope="col">Type</th>
                  <th scope="col">Objet</th>
                  <th scope="col">Rapproché de</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Reçu le" className="tight num muted">
                      {day(m.occurred_at)}
                    </td>
                    <td data-label="Type">
                      {m.classification ? (
                        <span
                          className={`badge ${CLASSIFICATION_TONE[m.classification] ?? "neutral"}`}
                        >
                          {m.classification}
                        </span>
                      ) : (
                        <span className="empty">non classé</span>
                      )}
                    </td>
                    <td data-label="Objet">{m.subject ?? "—"}</td>
                    <td data-label="Rapproché de">
                      {m.application_id ? (
                        <Link href={`/applications/${m.application_id}`}>
                          {m.company_name}
                          {m.title ? ` · ${m.title}` : ""}
                        </Link>
                      ) : (
                        <span className="empty">non apparié</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}
