import Link from "next/link";
import { markAppliedAction, stopAutoApplyAction } from "../auto-apply-actions";
import { continuePortalAction } from "../portal-actions";
import { AutoApplyAction } from "../components/auto-apply-action";
import { AutoApplyLive } from "../components/auto-apply-live";
import { Flash, SubmitButton } from "../components/client-ui";
import { DbUnavailable, EmptyState, ExtLink, PageHeader, ScoreMeter, Section, Stat, StatusPill, TableWrap } from "../components/ui";
import { day } from "../../lib/format";
import { gmailWorks } from "../../lib/gmail";
import {
  countShown,
  countWaitingDrafts,
  getRun,
  isMissingSchema,
  latestRun,
  listItems,
  summarize,
  type AutoApplyItem,
  type ItemOutcome,
  type RunState,
} from "../../lib/auto-apply/store";

export const metadata = { title: "Postuler automatiquement" };

// The batch writes here while it runs: never prerender this at build time.
export const dynamic = "force-dynamic";

type Search = { run?: string; error?: string; continued?: string; marked?: string };

const ERROR_FR: Record<string, string> = {
  count: "Choisis un nombre de stages entre 1 et 50.",
  gmail: "Gmail refuse la connexion (l’autorisation a expiré ou n’a jamais été donnée) : lance « npm run gmail:auth » une fois, puis réessaie. Les emails doivent pouvoir être mis en brouillon.",
  busy: "Un lot est déjà en cours : attends qu’il se termine, ou arrête-le.",
};

const OUTCOME_FR: Record<ItemOutcome, { label: string; tone: string }> = {
  working: { label: "En cours…", tone: "accent" },
  draft: { label: "Brouillon Gmail prêt", tone: "yellow" },
  sent: { label: "Envoyé", tone: "green" },
  review: { label: "À finir", tone: "mid" },
  skipped: { label: "Ignoré", tone: "neutral" },
  failed: { label: "Erreur", tone: "red" },
};

const RUN_STATE_FR: Record<RunState, { label: string; tone: string }> = {
  running: { label: "En cours", tone: "accent" },
  done: { label: "Terminé", tone: "green" },
  stopped: { label: "Arrêté", tone: "neutral" },
  failed: { label: "Interrompu", tone: "red" },
};

const CHANNEL_FR: Record<string, string> = { email: "Email (Gmail)", portal: "Formulaire", manual: "À la main" };

/** Form runs that a browser can take up again: a form that was opened, filled in part, and stopped. */
const RESUMABLE = new Set(["needs_review", "ready_to_submit", "planned", "blocked", "failed"]);

/** "J'ai postulé": for an application you finished yourself. */
function MarkApplied({ item, runId }: { item: AutoApplyItem; runId: string }) {
  return (
    <form action={markAppliedAction}>
      <input type="hidden" name="applicationId" value={item.application_id} />
      <input type="hidden" name="runId" value={runId} />
      <SubmitButton className="small ghost" pendingLabel="Enregistrement…">
        J’ai postulé : marquer comme envoyée
      </SubmitButton>
    </form>
  );
}

/**
 * One line's detail. Sent: when and how it went out (never the draft-stage notes). Not finished: what stopped it, on
 * which page, what is already filled, how to finish it by hand, and a button to mark it sent once you have.
 */
function ItemDetail({ item, back, runId }: { item: AutoApplyItem; back: string; runId: string }) {
  if (item.shown === "sent") {
    const when = item.submitted_at ? ` le ${day(item.submitted_at)}` : "";
    if (item.outcome === "sent") return <>{item.detail ?? `Envoyée${when}.`}</>;
    if (item.outcome === "draft") return <>Email envoyé depuis Gmail{when}, avec le CV et la lettre.</>;
    return <>Marquée comme envoyée{when} : tu l’as finie toi-même.</>;
  }
  if (item.shown === "working") return <>{item.detail ?? ""}</>;
  if (item.shown === "draft") {
    return (
      <>
        {item.detail ?? ""}
        <div className="auto-apply-continue">
          <MarkApplied item={item} runId={runId} />
        </div>
      </>
    );
  }

  const p = item.portal;
  const formStarted = !!p && RESUMABLE.has(p.state) && (p.filled > 0 || p.stop_step !== null);
  const noAddress = item.channel === "email" && item.shown !== "review";
  return (
    <>
      <dl className="auto-apply-stop">
        <dt>Ce qui bloque</dt>
        <dd>{(formStarted ? p?.reason : null) ?? item.detail ?? "Raison inconnue."}</dd>
        {formStarted && p?.stop_step ? (
          <>
            <dt>Étape à finir</dt>
            <dd>
              Page {p.stop_step}
              {p.step_count && p.step_count > 1 ? ` (le formulaire a ${p.step_count} pages atteintes)` : " du formulaire"}
            </dd>
          </>
        ) : null}
        {formStarted ? (
          <>
            <dt>Déjà rempli</dt>
            <dd>
              {p!.filled} champ{p!.filled > 1 ? "s" : ""}.{" "}
              <Link href={`/applications/${item.application_id}#portail`}>Voir le détail</Link>
            </dd>
          </>
        ) : null}
      </dl>
      <div className="auto-apply-continue form-actions">
        {formStarted ? (
          <form action={continuePortalAction}>
            <input type="hidden" name="applicationId" value={item.application_id} />
            <input type="hidden" name="back" value={back} />
            <SubmitButton className="small" pendingLabel="Ouverture…">
              Continuer à la main
            </SubmitButton>
          </form>
        ) : noAddress ? null : (
          <ExtLink href={p?.form_url ?? item.apply_url}>Ouvrir le formulaire et postuler toi-même</ExtLink>
        )}
        <MarkApplied item={item} runId={runId} />
      </div>
    </>
  );
}

export default async function AutoApplyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  let run, items, waiting, gmail;
  try {
    run = sp.run ? await getRun(sp.run) : await latestRun();
    [items, waiting, gmail] = await Promise.all([
      run ? listItems(run.id) : Promise.resolve([]),
      countWaitingDrafts(),
      // Asks Google, so an expired authorization shows here before a batch is started, not on its first email.
      gmailWorks(),
    ]);
  } catch (err) {
    if (isMissingSchema(err)) {
      return (
        <>
          <PageHeader title="Postuler automatiquement" />
          <EmptyState title="Schéma V13 absent">
            Applique <code>schema-v13.sql</code> une fois :
            <pre className="code-block">docker exec -i internship-desk-db psql -U internship -d internship_desk -f - &lt; schema-v13.sql</pre>
          </EmptyState>
        </>
      );
    }
    return (
      <>
        <PageHeader title="Postuler automatiquement" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const count = (o: ItemOutcome) => items.filter((i) => i.shown === o).length;
  const running = run?.state === "running";
  const finished = items.filter((i) => i.outcome !== "working").length;
  const error = sp.error ? ERROR_FR[sp.error] : undefined;
  const back = run ? `/auto-apply?run=${run.id}` : "/auto-apply";
  const continued = sp.continued ? items.find((i) => i.application_id === sp.continued) : undefined;
  const marked = sp.marked ? items.find((i) => i.application_id === sp.marked) : undefined;
  // A finished batch's summary is recounted from what each line shows now: drafts you sent since count as sent.
  const note = run && (run.state === "done" || run.state === "stopped") ? summarize(countShown(items), run.requested, run.state === "stopped") : run?.note;

  return (
    <>
      <PageHeader
        title="Postuler automatiquement"
        lede="Le bureau postule aux meilleures offres, de la meilleure à la moins bonne. Les emails restent en brouillon dans Gmail : tu cliques sur Envoyer, et la candidature passe à « Envoyé »."
        actions={<AutoApplyAction />}
      />

      <div className="stack stack-tight flash-stack">
        {error ? <Flash tone="error">{error}</Flash> : null}
        {marked ? <Flash>« {marked.role_title} » est marquée comme envoyée.</Flash> : null}
        {continued ? (
          <Flash tone="info">
            Une fenêtre de navigateur s’ouvre pour « {continued.role_title} » : le bureau remplit tout ce qu’il sait, passe les pages
            déjà complètes et s’arrête sur celle qui t’attend. Finis-la et soumets ; la candidature est enregistrée dès que le portail
            confirme. Ferme la fenêtre quand tu as terminé.
          </Flash>
        ) : null}
        {!gmail.ok && !error ? (
          <Flash tone="warn">
            Gmail refuse la connexion : l’autorisation a expiré ou n’a jamais été donnée. Lance « npm run gmail:auth » une fois ;
            sans cela, aucun brouillon ne peut être créé et aucun envoi ne peut être détecté.
          </Flash>
        ) : null}
      </div>

      <AutoApplyLive running={Boolean(running)} waiting={waiting} />

      {!run ? (
        <EmptyState title="Aucun lot pour le moment">
          Clique sur « Postuler automatiquement », choisis combien de stages, et le bureau s’occupe du reste. Tu verras ici
          où il en est, offre par offre.
        </EmptyState>
      ) : (
        <>
          <div className="stats">
            <Stat value={`${count("draft") + count("sent")} / ${run.requested}`} label="Candidatures faites" tone={count("draft") + count("sent") > 0 ? "good" : undefined} />
            <Stat value={count("draft")} label="Brouillons à envoyer" tone={count("draft") > 0 ? "good" : undefined} />
            <Stat value={count("sent")} label="Envoyées" />
            <Stat value={count("review")} label="À finir toi-même" tone={count("review") > 0 ? "alert" : undefined} />
            <Stat value={count("skipped") + count("failed")} label="Ignorées ou en erreur" />
          </div>

          <Section
            title={`Lot du ${day(run.started_at)}`}
            note={
              <>
                <span className={`badge ${RUN_STATE_FR[run.state].tone}`}>{RUN_STATE_FR[run.state].label}</span>{" "}
                {running ? `${finished} offre${finished > 1 ? "s" : ""} traitée${finished > 1 ? "s" : ""}…` : null}
              </>
            }
            id="lot"
          >
            {note ? <p className="auto-apply-note">{note}</p> : null}
            {running ? (
              <form action={stopAutoApplyAction} className="form-actions">
                <input type="hidden" name="runId" value={run.id} />
                <SubmitButton pendingLabel="Arrêt demandé…" disabled={run.stop_requested}>
                  {run.stop_requested ? "Arrêt demandé : fin de l’offre en cours…" : "Arrêter après l’offre en cours"}
                </SubmitButton>
              </form>
            ) : null}

            {items.length === 0 ? (
              <EmptyState title={running ? "Démarrage…" : "Aucune offre traitée"}>
                {running
                  ? "Le bureau cherche les offres admissibles et prépare la première."
                  : "Aucune offre admissible n’a été trouvée pour ce lot."}
              </EmptyState>
            ) : (
              <TableWrap>
                <table>
                  <caption className="visually-hidden">Offres traitées par ce lot, de la meilleure à la moins bonne</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="tight">
                        #
                      </th>
                      <th scope="col">Poste</th>
                      <th scope="col">Score</th>
                      <th scope="col">Voie</th>
                      <th scope="col">Résultat</th>
                      <th scope="col">Statut</th>
                      <th scope="col">Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td data-label="#" className="tight num muted">
                          {i.position}
                        </td>
                        <td data-label="Poste">
                          <Link href={`/applications/${i.application_id}`} className="cell-main">
                            {i.role_title}
                          </Link>
                          <span className="cell-sub">{i.company_name}</span>
                        </td>
                        <td data-label="Score">
                          <ScoreMeter score={i.score} />
                        </td>
                        <td data-label="Voie" className="muted">
                          {i.channel ? CHANNEL_FR[i.channel] : "n/d"}
                        </td>
                        <td data-label="Résultat">
                          <span className={`badge ${OUTCOME_FR[i.shown].tone}`}>{OUTCOME_FR[i.shown].label}</span>
                        </td>
                        <td data-label="Statut">
                          <StatusPill status={i.status} />
                        </td>
                        <td data-label="Détail" className="muted auto-apply-detail">
                          <ItemDetail item={i} back={back} runId={run.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}

            {waiting > 0 ? (
              <p className="auto-apply-note">
                {waiting} brouillon{waiting > 1 ? "s" : ""} attend{waiting > 1 ? "ent" : ""} dans Gmail.{" "}
                <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">
                  Ouvrir les brouillons
                  <span className="visually-hidden"> (nouvel onglet)</span>
                </a>
                . Relis chacun, clique sur Envoyer : l’offre passe à « Envoyé » toute seule.
              </p>
            ) : null}
          </Section>
        </>
      )}

      <nav className="page-foot" aria-label="Liens connexes">
        <Link href="/pipeline">Tracker</Link>
        <Link href="/portal">Candidatures par formulaire</Link>
        <Link href="/">Retour aux offres</Link>
      </nav>
    </>
  );
}
