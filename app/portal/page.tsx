import Link from "next/link";
import { DbUnavailable, EmptyState, ExtLink, PageHeader, Section, Stat, TableWrap } from "../components/ui";
import { day } from "../../lib/format";
import { listPortalAccounts } from "../../lib/apply/account";
import { listPortalErrors } from "../../lib/apply/store";
import { listPortalRunsForTracking } from "../../lib/apply/view";

const ACCOUNT_STATE_FR: Record<string, { label: string; tone: string }> = {
  created: { label: "Créé", tone: "green" },
  signed_in: { label: "Connecté", tone: "green" },
  verify_email: { label: "À vérifier par courriel", tone: "yellow" },
  failed: { label: "Échec", tone: "red" },
};

export const metadata = { title: "Portails" };

// Tracking data changes with every run: never prerender it at build time.
export const dynamic = "force-dynamic";

const STATE_FR: Record<string, { label: string; tone: string }> = {
  planning: { label: "Lecture", tone: "accent" },
  needs_review: { label: "À relire", tone: "yellow" },
  planned: { label: "Prêt", tone: "green" },
  filling: { label: "Remplissage", tone: "accent" },
  ready_to_submit: { label: "Rempli, à soumettre", tone: "green" },
  submitted: { label: "Soumise", tone: "green" },
  blocked: { label: "Bloquée", tone: "red" },
  failed: { label: "Erreur", tone: "red" },
  duplicate: { label: "Déjà envoyée", tone: "brass" },
};

const MODE_FR: Record<string, string> = { plan: "lecture", review: "remplissage", submit: "soumission" };

const PLATFORM_FR: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  workable: "Workable",
  ashby: "Ashby",
  generic: "portail de l’entreprise",
};

const file = (p: string | null) => (p ? p.split(/[\\/]/).pop() : "—");

export default async function PortalPage() {
  let runs, errors, accounts;
  try {
    [runs, errors, accounts] = await Promise.all([listPortalRunsForTracking(), listPortalErrors(30).catch(() => []), listPortalAccounts().catch(() => [])]);
  } catch (err) {
    return (
      <>
        <PageHeader title="Candidatures par formulaire" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }
  if (!runs) {
    return (
      <>
        <PageHeader title="Candidatures par formulaire" />
        <EmptyState title="Schéma V11 absent">
          <p>
            Applique <code>schema-v11.sql</code> pour suivre les candidatures envoyées par les formulaires en ligne.
          </p>
        </EmptyState>
      </>
    );
  }

  const submitted = runs.filter((r) => r.state === "submitted");
  // Per application, only its newest run counts, and nothing already submitted is "waiting".
  const done = new Set(submitted.map((r) => r.application_id));
  const newest = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!newest.has(r.application_id)) newest.set(r.application_id, r);
  const waiting = [...newest.values()].filter(
    (r) => !done.has(r.application_id) && ["needs_review", "planned", "ready_to_submit"].includes(r.state),
  );
  const blocked = runs.filter((r) => r.state === "blocked" || r.state === "failed").length;

  return (
    <>
      <PageHeader
        title="Candidatures par formulaire"
        lede="Chaque tentative sur un portail d’entreprise : quel CV, quelle lettre, quelles réponses, et ce qui s’est passé."
      />

      <div className="stats">
        <Stat value={submitted.length} label="Soumises" tone={submitted.length ? "good" : undefined} />
        <Stat value={waiting.length} label="Attendent ta relecture" tone={waiting.length ? "alert" : undefined} />
        <Stat value={blocked} label="Bloquées ou en erreur" />
        <Stat value={runs.length} label="Tentatives au total" />
      </div>

      <Section title="Historique" note="La plus récente d’abord">
        {runs.length === 0 ? (
          <EmptyState title="Aucune tentative pour l’instant">
            <p>
              Les offres sans adresse de recruteur passent par ici. Lance <code>npm run portal -- --queue plan</code> ou le
              bouton « Lire le formulaire » sur une candidature.
            </p>
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entreprise · poste</th>
                  <th>État</th>
                  <th>Portail</th>
                  <th>CV</th>
                  <th>Lettre</th>
                  <th>Champs</th>
                  <th>Réponses écrites</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const s = STATE_FR[r.state] ?? { label: r.state, tone: "accent" };
                  return (
                    <tr key={r.id}>
                      <td data-label="Date">
                        {day(r.submitted_at ?? r.started_at)}
                        <span className="field-hint">{MODE_FR[r.mode] ?? r.mode}</span>
                      </td>
                      <td data-label="Poste">
                        <Link href={`/applications/${r.application_id}#portail`}>
                          <strong>{r.company_name}</strong> · {r.role_title}
                        </Link>
                        {r.blocked_reason || r.error ? <span className="field-hint">{r.blocked_reason ?? r.error}</span> : null}
                      </td>
                      <td data-label="État">
                        <span className={`badge ${s.tone}`}>{s.label}</span>
                      </td>
                      <td data-label="Portail">
                        {r.form_url ? <ExtLink href={r.form_url}>{PLATFORM_FR[r.platform ?? ""] ?? "formulaire"}</ExtLink> : <ExtLink href={r.posting_url}>offre</ExtLink>}
                      </td>
                      <td data-label="CV" title={r.resume_reason ?? undefined}>
                        {file(r.resume_path)}
                      </td>
                      <td data-label="Lettre">{file(r.cover_letter_path)}</td>
                      <td data-label="Champs">
                        {r.field_count}
                        {r.manual_count ? <span className="field-hint">{r.manual_count} pour toi</span> : null}
                      </td>
                      <td data-label="Réponses">{r.answers}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {accounts.length ? (
        <Section title="Comptes sur les portails" note="Créés ou ouverts à ta demande, avec l’adresse configurée. Le mot de passe n’est jamais enregistré ici.">
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Portail</th>
                  <th>Compte</th>
                  <th>État</th>
                  <th>Mis à jour</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const s = ACCOUNT_STATE_FR[a.state] ?? { label: a.state, tone: "accent" };
                  return (
                    <tr key={a.host}>
                      <td data-label="Portail">{a.host}</td>
                      <td data-label="Compte">{a.email}</td>
                      <td data-label="État">
                        <span className={`badge ${s.tone}`}>{s.label}</span>
                        {a.note ? <span className="field-hint">{a.note}</span> : null}
                      </td>
                      <td data-label="Mis à jour">{day(a.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      {errors.length ? (
        <Section title="Erreurs récentes" note="Aussi dans portal_errors">
          <ul className="small">
            {errors.map((e) => (
              <li key={e.id}>
                {day(e.created_at)} · {e.stage} : {e.message}
                {e.application_id ? (
                  <>
                    {" "}
                    · <Link href={`/applications/${e.application_id}#portail`}>voir</Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
