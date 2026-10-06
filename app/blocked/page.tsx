import Link from "next/link";
import { CopyButton } from "../components/client-ui";
import { DbUnavailable, EmptyState, ExtLink, PageHeader, Section, Stat, TableWrap } from "../components/ui";
import { day } from "../../lib/format";
import { listBlocked, preparedAnswers, savedInfo, type BlockedInternship, type PreparedAnswer, type SavedInfo } from "../../lib/apply/blocked";
import { dismissBlockedAction, markBlockedAppliedAction } from "../portal-actions";

export const metadata = { title: "Bloquées" };

// Changes with every daily run and every form you finish: never prerendered.
export const dynamic = "force-dynamic";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The reason as the desk wrote it, with any link in it clickable ("The company's careers page: https://…"). */
function Reason({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+[^\s).,;])/g);
  return (
    <p className="field-hint" style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => (/^https?:\/\//.test(p) ? <ExtLink key={i} href={p}>{hostOf(p)}</ExtLink> : <span key={i}>{p}</span>))}
    </p>
  );
}

/** Where the desk got stuck, in a word, for the badge. */
function kindOf(reason: string): string {
  if (/linkedin/i.test(reason)) return "LinkedIn";
  if (/indeed/i.test(reason)) return "Indeed";
  if (/captcha/i.test(reason)) return "CAPTCHA";
  if (/account|compte|sign(ing)? in|password|mot de passe/i.test(reason)) return "Compte";
  if (/tokens|credit|crédit/i.test(reason)) return "Crédit Claude";
  if (/no (supporting|matching) fact|no option|aucun|address|adresse/i.test(reason)) return "Question";
  return "Formulaire";
}

function SavedInfoTable({ info }: { info: SavedInfo[] }) {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Champ</th>
            <th>English</th>
            <th>Français</th>
          </tr>
        </thead>
        <tbody>
          {info.map((s) => (
            <tr key={s.key}>
              <td data-label="Champ">{s.label}</td>
              <td data-label="English" style={{ whiteSpace: "pre-wrap" }}>
                {s.en ? (
                  <span className="cluster">
                    <span>{s.en}</span>
                    <CopyButton value={s.en} />
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td data-label="Français" style={{ whiteSpace: "pre-wrap" }}>
                {s.fr && s.fr !== s.en ? (
                  <span className="cluster">
                    <span>{s.fr}</span>
                    <CopyButton value={s.fr} />
                  </span>
                ) : (
                  <span className="field-hint">pareil</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function AnswersTable({ answers }: { answers: PreparedAnswer[] }) {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Question du formulaire</th>
            <th>Réponse préparée</th>
          </tr>
        </thead>
        <tbody>
          {answers.map((f, i) => (
            <tr key={`${f.label}-${i}`}>
              <td data-label="Question">
                {f.label}
                {f.required ? <span className="field-hint">obligatoire</span> : null}
              </td>
              <td data-label="Réponse" style={{ whiteSpace: "pre-wrap" }}>
                {f.kind === "file" ? (
                  <em>{f.value.split(/[\\/]/).pop()}</em>
                ) : (
                  <span className="cluster" style={{ alignItems: "flex-start" }}>
                    <span style={{ flex: 1 }}>{f.value}</span>
                    <CopyButton value={f.value} />
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function BlockedCard({ b, answers }: { b: BlockedInternship; answers: PreparedAnswer[] }) {
  const files = `/applications/${b.application_id}/files`;
  const sameLink = b.form_url === b.posting_url;
  return (
    <article className="panel" id={`b-${b.application_id}`}>
      <div className="panel-head">
        <div>
          <span className="panel-title">
            <Link href={`/applications/${b.application_id}`}>
              <strong>{b.company_name}</strong> · {b.title}
            </Link>
          </span>
          <span className="field-hint">
            {b.location ? `${b.location} · ` : ""}
            {b.score !== null ? `${Math.round(b.score * 100)} % · ` : ""}
            {b.blocked_at ? `bloquée le ${day(b.blocked_at)}` : "bloquée"}
          </span>
        </div>
        <span className="badge red">{kindOf(b.reason)}</span>
      </div>

      <Reason text={b.reason} />

      <div className="cluster" style={{ marginTop: "var(--s-2)" }}>
        <a className="btn primary" href={b.form_url} target="_blank" rel="noreferrer">
          Postuler sur {hostOf(b.form_url)}
        </a>
        {sameLink ? null : (
          <a className="btn" href={b.posting_url} target="_blank" rel="noreferrer">
            Voir l’offre ({hostOf(b.posting_url)})
          </a>
        )}
        {b.has_tailored_cv ? (
          <a className="btn" href={`${files}/cv-tailored`}>
            CV adapté (PDF)
          </a>
        ) : null}
        {b.has_cv ? (
          <a className="btn" href={`${files}/cv`}>
            CV
          </a>
        ) : null}
        {b.has_letter ? (
          <a className="btn" href={`${files}/letter`}>
            Lettre de présentation
          </a>
        ) : null}
      </div>

      {answers.length ? (
        <details className="apply-more">
          <summary>Réponses déjà préparées ({answers.length})</summary>
          <AnswersTable answers={answers} />
        </details>
      ) : (
        <p className="field-hint">Aucune réponse préparée pour ce formulaire : tes informations, plus haut, couvrent les champs habituels.</p>
      )}

      {b.screenshot_path && b.run_id ? (
        <details className="apply-more">
          <summary>Où le bureau s’est arrêté (capture)</summary>
          <a href={`/approvals/shot/${b.run_id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local, per-run screenshot served by the desk */}
            <img className="approval-shot" src={`/approvals/shot/${b.run_id}`} alt={`Le formulaire de ${b.company_name} là où le bureau s’est arrêté`} loading="lazy" />
          </a>
        </details>
      ) : null}

      <div className="cluster" style={{ marginTop: "var(--s-3)" }}>
        <form action={markBlockedAppliedAction}>
          <input type="hidden" name="applicationId" value={b.application_id} />
          <button type="submit" className="btn">
            J’ai postulé
          </button>
        </form>
        <form action={dismissBlockedAction}>
          <input type="hidden" name="applicationId" value={b.application_id} />
          <button type="submit" className="btn ghost">
            Pas celle-ci
          </button>
        </form>
      </div>
    </article>
  );
}

export default async function BlockedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  let blocked: BlockedInternship[];
  let info: SavedInfo[];
  let answers: Map<string, PreparedAnswer[]>;
  try {
    [blocked, info] = await Promise.all([listBlocked(), savedInfo()]);
    answers = new Map(await Promise.all(blocked.map(async (b) => [b.application_id, b.run_id ? await preparedAnswers(b.run_id) : []] as const)));
  } catch (err) {
    return (
      <>
        <PageHeader title="Stages bloqués" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }

  const kinds = new Map<string, number>();
  for (const b of blocked) kinds.set(kindOf(b.reason), (kinds.get(kindOf(b.reason)) ?? 0) + 1);
  const top = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const flash = params.applied
    ? "Noté : marquée « Envoyé ». Elle quitte la liste et le lot."
    : params.dismissed
      ? "Mise de côté : elle ne reviendra ni ici ni dans le lot."
      : null;

  return (
    <>
      <PageHeader
        eyebrow="À faire toi-même"
        title="Stages bloqués"
        lede="Le bureau a essayé ces stages et s’est arrêté (CAPTCHA, compte à créer, offre LinkedIn ou Indeed seulement, question sans réponse). Tout ce qu’il avait préparé est ici : ouvre le formulaire, copie les réponses, joins le CV et la lettre."
      />

      {flash ? (
        <p className="badge green" role="status">
          {flash}
        </p>
      ) : null}

      <div className="stats">
        <Stat value={blocked.length} label="Stages bloqués" tone={blocked.length ? "alert" : undefined} />
        {top.map(([k, n]) => (
          <Stat key={k} value={n} label={k} />
        ))}
      </div>

      <Section title="Tes informations" note="Celles de ta banque de réponses, à copier dans n’importe quel formulaire" id="infos">
        {info.length ? (
          <details className="apply-more">
            <summary>Nom, courriel, téléphone, adresse, liens, école… ({info.length})</summary>
            <SavedInfoTable info={info} />
          </details>
        ) : (
          <EmptyState title="Banque de réponses vide">
            <p>
              Remplis <Link href="/answers">/answers</Link> : ces réponses apparaîtront ici.
            </p>
          </EmptyState>
        )}
      </Section>

      <Section title="À finir toi-même" note="Le meilleur score d’abord" id="liste">
        {blocked.length === 0 ? (
          <EmptyState title="Rien de bloqué">
            <p>Chaque stage que le bureau ne peut pas envoyer seul apparaîtra ici, avec ce qu’il avait préparé.</p>
          </EmptyState>
        ) : (
          blocked.map((b) => <BlockedCard key={b.application_id} b={b} answers={answers.get(b.application_id) ?? []} />)
        )}
      </Section>
    </>
  );
}
