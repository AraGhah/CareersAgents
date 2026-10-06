import Link from "next/link";
import { DbUnavailable, EmptyState, ExtLink, PageHeader, Section, Stat, TableWrap } from "../components/ui";
import { day } from "../../lib/format";
import { filledFields, listAwaitingApproval, type AwaitingApproval, type FilledField } from "../../lib/apply/approval";
import { submitMode } from "../../lib/apply/submit";
import { latestDailyRun, type DailyRunRow } from "../../lib/registry/daily";
import { recentCompanies, registryReady, registryStats, type RecentCompany, type RegistryStats } from "../../lib/registry/store";
import { approveAllAction, approveSubmitAction, continuePortalAction, dismissApprovalAction } from "../portal-actions";

export const metadata = { title: "À approuver" };

// Changes with every daily run and every approval: never prerendered.
export const dynamic = "force-dynamic";

const PLATFORM_FR: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  workday: "Workday",
  successfactors: "SuccessFactors",
  smartrecruiters: "SmartRecruiters",
  icims: "iCIMS",
  ibm: "IBM",
  "careers-page": "page carrières",
};

const VIA_FR: Record<string, string> = {
  freehire: "freehire",
  "careers-site": "son site",
  "employers.json": "liste vérifiée",
  seed: "liste de départ",
};

const MODE_NOTE: Record<string, string> = {
  approve: "Rien n’est envoyé sans ton accord : « Approuver et envoyer » soumet le formulaire tel que tu le vois ici.",
  auto: "PORTAL_SUBMIT=auto : le bureau soumet seul les formulaires qui passent toutes les vérifications. Mets PORTAL_SUBMIT=approve pour revenir à l’approbation.",
  off: "PORTAL_SUBMIT=off : les formulaires ne sont ni remplis par le lot ni envoyés.",
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function FieldsTable({ fields }: { fields: FilledField[] }) {
  const shown = fields.filter((f) => f.value && f.status !== "skipped");
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Question du formulaire</th>
            <th>Ce que le bureau a écrit</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((f, i) => (
            <tr key={`${f.label}-${i}`}>
              <td data-label="Question">
                {f.label}
                {f.required ? <span className="field-hint">obligatoire</span> : null}
              </td>
              <td data-label="Réponse" style={{ whiteSpace: "pre-wrap" }}>
                {f.kind === "file" ? <em>{(f.value ?? "").split(/[\\/]/).pop()}</em> : f.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function ApprovalCard({ a, fields }: { a: AwaitingApproval; fields: FilledField[] }) {
  const sending = !!a.approved_at;
  const written = fields.filter((f) => f.value && f.status !== "skipped").length;
  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <span className="panel-title">
            <Link href={`/applications/${a.application_id}#portail`}>
              <strong>{a.company_name}</strong> · {a.title}
            </Link>
          </span>
          <span className="field-hint">
            {a.location ? `${a.location} · ` : ""}rempli le {day(a.finished_at)} sur <ExtLink href={a.form_url}>{hostOf(a.form_url)}</ExtLink>
          </span>
        </div>
        {sending ? <span className="badge accent">Approuvé : envoi en cours</span> : <span className="badge green">Rempli et vérifié</span>}
      </div>

      {a.screenshot_path ? (
        <a href={`/approvals/shot/${a.run_id}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local, per-run screenshot served by the desk */}
          <img className="approval-shot" src={`/approvals/shot/${a.run_id}`} alt={`Le formulaire de ${a.company_name} rempli`} loading="lazy" />
        </a>
      ) : null}

      <details className="apply-more">
        <summary>Ce qui a été écrit ({written} champ{written > 1 ? "s" : ""})</summary>
        <FieldsTable fields={fields} />
      </details>

      {sending ? null : (
        <div className="cluster" style={{ marginTop: "var(--s-3)" }}>
          <form action={approveSubmitAction}>
            <input type="hidden" name="applicationId" value={a.application_id} />
            <input type="hidden" name="runId" value={a.run_id} />
            <button type="submit" className="btn primary">
              Approuver et envoyer
            </button>
          </form>
          <form action={continuePortalAction}>
            <input type="hidden" name="applicationId" value={a.application_id} />
            <button type="submit" className="btn">
              Ouvrir et finir moi-même
            </button>
          </form>
          <form action={dismissApprovalAction}>
            <input type="hidden" name="applicationId" value={a.application_id} />
            <button type="submit" className="btn ghost">
              Pas celle-ci
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  let waiting: AwaitingApproval[];
  let fields: Map<string, FilledField[]>;
  let stats: RegistryStats | null = null;
  let recent: RecentCompany[] = [];
  let lastRun: DailyRunRow | null = null;
  let ready = false;
  let dbError: string | null = null;
  try {
    ready = await registryReady();
    waiting = ready ? await listAwaitingApproval() : [];
    fields = new Map(await Promise.all(waiting.map(async (a) => [a.run_id, await filledFields(a.run_id)] as const)));
    if (ready) [stats, recent, lastRun] = await Promise.all([registryStats(), recentCompanies(7), latestDailyRun()]);
  } catch (err) {
    waiting = [];
    fields = new Map();
    dbError = (err as Error).message;
  }
  if (dbError) {
    return (
      <>
        <PageHeader title="Candidatures à approuver" />
        <DbUnavailable detail={dbError} />
      </>
    );
  }
  if (!ready) {
    return (
      <>
        <PageHeader title="Candidatures à approuver" />
        <EmptyState title="Schéma V17 absent">
          <p>
            Applique <code>schema-v17.sql</code>, puis lance <code>npm run daily</code>.
          </p>
        </EmptyState>
      </>
    );
  }

  const mode = submitMode();
  const toApprove = waiting.filter((a) => !a.approved_at);
  const sending = waiting.length - toApprove.length;
  const flash = params.approved
    ? Number(params.approved) > 1
      ? `${params.approved} formulaires approuvés : ils partent un par un, en arrière-plan.`
      : "Approuvé : le formulaire part en arrière-plan. Il passe à « Envoyé » dès que le portail confirme."
    : params.dismissed
      ? "Mis de côté : cette offre ne reviendra pas dans le lot."
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Site carrières d’abord"
        title="Candidatures à approuver"
        lede="Chaque jour, le bureau trouve de nouvelles entreprises, lit leur site carrières et remplit les meilleurs formulaires. Ils t’attendent ici."
      />

      <p className="field-hint">{MODE_NOTE[mode]}</p>
      {flash ? (
        <p className="badge green" role="status">
          {flash}
        </p>
      ) : null}

      <div className="stats">
        <Stat value={toApprove.length} label="À approuver" tone={toApprove.length ? "alert" : undefined} />
        <Stat value={sending} label="En cours d’envoi" />
        <Stat value={stats?.companies ?? 0} label="Entreprises suivies" />
        <Stat value={stats?.active ?? 0} label="Sites carrières lus chaque jour" />
      </div>

      <Section
        title="Formulaires remplis"
        id="attente"
        note={lastRun ? `Dernière passe : ${day(lastRun.started_at)}${lastRun.finished_at ? "" : " (en cours)"}` : "Aucune passe quotidienne encore : npm run daily"}
      >
        {waiting.length === 0 ? (
          <EmptyState title="Rien à approuver pour l’instant">
            <p>
              La passe quotidienne (<code>npm run daily</code>, ou chaque matin avec <code>npm run automate</code>) remplit les
              meilleurs formulaires et les dépose ici.
            </p>
          </EmptyState>
        ) : (
          <>
            {toApprove.length > 1 ? (
              <form action={approveAllAction} className="cluster" style={{ marginBottom: "var(--s-4)" }}>
                {toApprove.map((a) => (
                  <input key={a.run_id} type="hidden" name="runId" value={a.run_id} />
                ))}
                <button type="submit" className="btn">
                  Tout approuver ({toApprove.length}) après les avoir relus
                </button>
              </form>
            ) : null}
            {waiting.map((a) => (
              <ApprovalCard key={a.run_id} a={a} fields={fields.get(a.run_id) ?? []} />
            ))}
          </>
        )}
      </Section>

      <Section title="Nouvelles entreprises" note="Arrivées ces 7 derniers jours" id="nouvelles">
        {recent.length === 0 ? (
          <EmptyState title="Aucune nouvelle entreprise cette semaine" />
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Trouvée par</th>
                  <th>Site carrières lu</th>
                  <th>Stages ouverts ici</th>
                  <th>Depuis</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Entreprise">{c.name}</td>
                    <td data-label="Trouvée par">{VIA_FR[c.via ?? ""] ?? c.via ?? "—"}</td>
                    <td data-label="Site carrières">
                      {c.boards
                        ? c.boards
                            .split(", ")
                            .map((p) => PLATFORM_FR[p] ?? p)
                            .join(", ")
                        : "à chercher"}
                    </td>
                    <td data-label="Stages">{c.open_jobs}</td>
                    <td data-label="Depuis">{day(c.discovered_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {stats?.byPlatform.length ? (
          <p className="field-hint">
            Sites lus chaque jour : {stats.byPlatform.map((p) => `${PLATFORM_FR[p.platform] ?? p.platform} ${p.n}`).join(" · ")}
            {stats.retired ? ` · ${stats.retired} retiré(s) (ne répondent plus)` : ""}
          </p>
        ) : null}
      </Section>
    </>
  );
}
