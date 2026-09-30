import { approvePortalFieldAction, planPortalAction, runPortalAction, setFormUrlAction } from "../../portal-actions";
import { Select, SubmitButton } from "../../components/client-ui";
import { Disclosure } from "../../components/disclosure";
import { ExtLink } from "../../components/ui";
import { day } from "../../../lib/format";
import { accountCredentials } from "../../../lib/apply/account-config";
import { realOptions } from "../../../lib/apply/options";
import type { PortalFieldRow } from "../../../lib/apply/store";
import type { PortalView } from "../../../lib/apply/view";

const STATE_FR: Record<string, { label: string; tone: string }> = {
  planning: { label: "Lecture du formulaire", tone: "accent" },
  needs_review: { label: "À relire", tone: "yellow" },
  planned: { label: "Prêt à remplir", tone: "green" },
  filling: { label: "Remplissage en cours", tone: "accent" },
  ready_to_submit: { label: "Rempli, à soumettre", tone: "green" },
  submitted: { label: "Soumise", tone: "green" },
  blocked: { label: "Bloquée", tone: "red" },
  failed: { label: "Erreur", tone: "red" },
  duplicate: { label: "Déjà envoyée", tone: "brass" },
};

const PLATFORM_FR: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  workable: "Workable",
  ashby: "Ashby",
  generic: "Portail de l’entreprise",
};

const PREFLIGHT_FR: Record<string, string> = {
  not_duplicate: "Pas déjà envoyée",
  required_filled: "Tous les champs obligatoires sont remplis",
  read_back: "Chaque valeur écrite se relit correctement",
  nothing_pending: "Aucune question en attente de toi",
  resume_selected: "Le bon CV est choisi et présent sur le disque",
  resume_lang: "Le CV est dans la langue de l’offre",
  cv_on_form: "Le formulaire prend ton CV (candidature complète, pas une première étape)",
  resume_attached: "Le CV est joint au formulaire",
  cover_letter_matches: "La lettre correspond à l’entreprise, au poste et à la langue",
  answers_grounded: "Les réponses écrites n’inventent rien",
  no_placeholders: "Aucun texte de remplissage oublié",
  no_captcha: "Aucun CAPTCHA à résoudre",
  no_form_errors: "Le formulaire n’affiche aucune erreur",
  not_target: "Pas une entreprise prioritaire (toujours relue à la main)",
  submit_enabled: "Soumission automatique activée (PORTAL_ALLOW_SUBMIT=true)",
};

const PORTAL_FLASH: Record<string, { text: string; tone: "success" | "info" | "error" }> = {
  planned: { text: "Formulaire lu et réponses préparées. Relis ce qui est surligné ci-dessous.", tone: "success" },
  "plan-failed": { text: "La lecture du formulaire a échoué. Le détail est dans le journal ci-dessous.", tone: "error" },
  "launched-review": { text: "Une fenêtre de navigateur s’ouvre et remplit le formulaire. Tu soumets toi-même.", tone: "info" },
  "launched-submit": { text: "Une fenêtre s’ouvre, remplit, vérifie et soumet seulement si tout est vert.", tone: "info" },
  approved: { text: "Réponse enregistrée. Une réponse écrite que tu approuves sert aussi d’exemple de ton style.", tone: "success" },
  "form-invalid": { text: "Ce lien n’est pas utilisable : colle l’adresse de l’offre sur le site de l’entreprise, pas celle de LinkedIn ou d’Indeed.", tone: "error" },
  "form-manual": { text: "Lien enregistré. Ce portail demande un compte : ouvre-le et postule toi-même, l’adresse est rappelée ci-dessous.", tone: "info" },
};

export { PORTAL_FLASH };

function kindOf(f: PortalFieldRow) {
  const [intent, questionType] = f.intent.split(":");
  return { intent, questionType };
}

function FieldForm({ f, applicationId, runId, lang, draft }: { f: PortalFieldRow; applicationId: string; runId: string; lang: string; draft: boolean }) {
  const options = realOptions(f.options ?? []).map((o) => o.text);
  const choice = ["select", "radio", "combobox", "checkbox-group"].includes(f.kind) && options.length > 0;
  const failing = (f.checks ?? []).filter((c) => !c.ok);
  const long = f.kind === "textarea" || kindOf(f).intent === "open_question";
  return (
    <form action={approvePortalFieldAction} className="portal-field">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="fieldId" value={f.id} />
      <input type="hidden" name="lang" value={lang} />
      <div className="field">
        <label htmlFor={`pf-${f.id}`}>
          {f.label}
          {f.required ? <span className="optional"> (obligatoire)</span> : null}
        </label>
        {f.kind === "checkbox" ? (
          <Select
            id={`pf-${f.id}`}
            name="value"
            ariaLabel={f.label}
            defaultValue={f.value ?? ""}
            options={[
              { value: "Yes", label: "Oui, cocher la case" },
              { value: "No", label: "Non, laisser décochée" },
            ]}
          />
        ) : choice ? (
          <Select
            id={`pf-${f.id}`}
            name="value"
            ariaLabel={f.label}
            defaultValue={f.value && options.includes(f.value) ? f.value : ""}
            options={options.map((o) => ({ value: o, label: o }))}
          />
        ) : long ? (
          <textarea id={`pf-${f.id}`} name="value" rows={draft ? 8 : 4} defaultValue={f.value ?? ""} />
        ) : (
          <input id={`pf-${f.id}`} name="value" defaultValue={f.value ?? ""} />
        )}
        {f.reason ? <span className="field-hint">{f.reason}</span> : null}
        {failing.length ? (
          <ul className="portal-checks">
            {failing.map((c) => (
              <li key={c.id}>
                {c.label}
                {c.detail ? ` : ${c.detail}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="form-actions">
        <SubmitButton pendingLabel="Enregistrement…">{draft ? "Approuver cette réponse" : "Valider"}</SubmitButton>
        {draft ? <span className="small muted">Modifie le texte d’abord si tu veux : ta version devient un exemple de ton style.</span> : null}
      </div>
    </form>
  );
}

export function PortalPanel({
  applicationId,
  lang,
  view,
  postingUrl,
  submitEnabled,
}: {
  applicationId: string;
  lang: string;
  view: PortalView | null;
  postingUrl: string;
  submitEnabled: boolean;
}) {
  if (!view) {
    return (
      <section className="section" id="portail">
        <div className="section-head">
          <h2>Postuler par le formulaire en ligne</h2>
        </div>
        <p className="small muted">
          Applique <code>schema-v11.sql</code> pour activer la candidature automatique par formulaire.
        </p>
      </section>
    );
  }

  const { run, planRun, fields } = view;
  const state = run ? STATE_FR[run.state] ?? { label: run.state, tone: "accent" } : null;
  const planId = planRun?.id ?? null;
  const manual = fields.filter((f) => f.status === "manual" && (f.required || f.value));
  const drafts = fields.filter((f) => f.status === "generated");
  const done = fields.filter((f) => ["resolved", "approved", "filled"].includes(f.status));
  const skipped = fields.filter((f) => f.status === "skipped" || (f.status === "manual" && !f.required && !f.value));
  const failed = fields.filter((f) => f.status === "failed");
  const preflight = run?.preflight ?? [];
  const planReady = planRun?.state === "planned" || (planRun && manual.length === 0 && drafts.length === 0 && failed.length === 0);

  return (
    <section className="section" id="portail">
      <div className="section-head">
        <h2>Postuler par le formulaire en ligne</h2>
        <span className="section-note">
          {view.channel === "portal"
            ? "Aucune adresse de recruteur publiée : la candidature passe par le formulaire de l’entreprise."
            : view.channel === "manual"
              ? accountCredentials()
                ? "Si ce portail demande un compte, « Lire le formulaire » s’y connecte ou le crée avec l’adresse configurée ; un formulaire en plusieurs étapes reste à faire toi-même."
                : "Ce portail demande ton compte : à faire toi-même."
              : "Utilisable même si une adresse existe."}
        </span>
      </div>

      {run ? (
        <p className="apply-step-lede">
          <span className={`badge ${state!.tone}`}>{state!.label}</span> {run.platform ? `${PLATFORM_FR[run.platform] ?? run.platform} · ` : ""}
          {run.form_url ? <ExtLink href={run.form_url}>formulaire</ExtLink> : <ExtLink href={postingUrl}>offre</ExtLink>}
          {" · "}
          {day(run.started_at)}
          {run.submitted_at ? ` · soumise le ${day(run.submitted_at)}` : ""}
        </p>
      ) : (
        <p className="apply-step-lede">
          Un clic lit le formulaire sans rien remplir, choisit le CV, prépare la lettre si elle est demandée et rédige les
          réponses écrites à partir de ton profil. Tu relis ici avant que quoi que ce soit ne soit rempli.
        </p>
      )}

      {run?.blocked_reason ? <p className="small"><strong>Pourquoi :</strong> {run.blocked_reason}</p> : null}
      {run?.error ? <p className="small"><strong>Erreur :</strong> {run.error}</p> : null}
      {run?.confirmation_text ? <p className="small"><strong>Confirmation :</strong> {run.confirmation_text}</p> : null}
      {run?.resume_path ? (
        <p className="small muted">
          CV : {run.resume_path.split(/[\\/]/).pop()} · {run.resume_reason}
          {run.cover_letter_path ? ` · Lettre : ${run.cover_letter_path.split(/[\\/]/).pop()}` : ""}
        </p>
      ) : null}

      {manual.length ? (
        <div className="portal-group">
          <h3>
            <span className="badge red">{manual.length}</span> À toi
          </h3>
          <p className="small muted">Questions légales, personnelles, ou absentes de ton profil : rien n’est deviné.</p>
          {manual.map((f) => (
            <FieldForm key={f.id} f={f} applicationId={applicationId} runId={planId!} lang={lang} draft={false} />
          ))}
        </div>
      ) : null}

      {drafts.length ? (
        <div className="portal-group">
          <h3>
            <span className="badge yellow">{drafts.length}</span> Réponses rédigées à relire
          </h3>
          {drafts.map((f) => (
            <FieldForm key={f.id} f={f} applicationId={applicationId} runId={planId!} lang={lang} draft />
          ))}
        </div>
      ) : null}

      {failed.length ? (
        <div className="portal-group">
          <h3>
            <span className="badge red">{failed.length}</span> Non remplis au dernier essai
          </h3>
          <ul className="small">
            {failed.map((f) => (
              <li key={f.id}>
                {f.label} : {f.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preflight.length ? (
        <Disclosure label={`Vérifications avant envoi (${preflight.filter((p) => p.ok).length}/${preflight.length})`} defaultOpen={run?.state !== "submitted"}>
          <ul className="portal-preflight">
            {preflight.map((p) => (
              <li key={p.id} className={p.ok ? "is-ok" : p.blocking ? "is-bad" : "is-warn"}>
                <span aria-hidden="true">{p.ok ? "✓" : p.blocking ? "✗" : "!"}</span> {PREFLIGHT_FR[p.id] ?? p.label}
                {p.detail && !p.ok ? <span className="field-hint">{p.detail}</span> : null}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {done.length ? (
        <Disclosure label={`Réglé à partir de tes données (${done.length})`}>
          <ul className="portal-done small">
            {done.map((f) => (
              <li key={f.id}>
                <strong>{f.label}</strong> → {f.kind === "file" ? (f.value ?? "").split(/[\\/]/).pop() : (f.value ?? "").slice(0, 160)}
                {f.value && f.value.length > 160 ? "…" : ""}
                {f.reason ? <span className="field-hint">{f.reason}</span> : null}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {skipped.length ? (
        <Disclosure label={`Laissé vide (${skipped.length})`}>
          <ul className="small">
            {skipped.map((f) => (
              <li key={f.id}>
                {f.label} : {f.reason}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {view.errors.length ? (
        <Disclosure label={`Journal des erreurs (${view.errors.length})`}>
          <ul className="small">
            {view.errors.map((e, i) => (
              <li key={i}>
                {day(e.created_at)} · {e.stage} : {e.message}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {!run || run.state === "blocked" ? (
        <Disclosure label="J’ai le lien de l’offre sur le site de l’entreprise" defaultOpen={run?.state === "blocked"}>
          <form action={setFormUrlAction} className="form-grid">
            <input type="hidden" name="applicationId" value={applicationId} />
            <div className="field">
              <label htmlFor="formUrl">Adresse de l’offre ou du formulaire (pas LinkedIn ni Indeed)</label>
              <input id="formUrl" name="formUrl" type="url" required placeholder="https://…" />
              <span className="field-hint">
                Le bureau cherche déjà l’offre sur le site de l’entreprise. Si tu l’as trouvée toi-même, colle-la ici : il lit le
                formulaire à partir de là.
              </span>
            </div>
            <div className="form-actions">
              <SubmitButton pendingLabel="Lecture du formulaire…">Utiliser ce lien</SubmitButton>
            </div>
          </form>
        </Disclosure>
      ) : null}

      {run?.state === "submitted" || run?.state === "duplicate" ? null : (
        <div className="form-actions portal-actions">
          <form action={planPortalAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <SubmitButton className={planRun ? "" : "primary"} pendingLabel="Lecture du formulaire et rédaction…">
              {planRun ? "Relire le formulaire" : "Lire le formulaire et préparer les réponses"}
            </SubmitButton>
          </form>
          {planRun ? (
            <form action={runPortalAction}>
              <input type="hidden" name="applicationId" value={applicationId} />
              <input type="hidden" name="mode" value="review" />
              <SubmitButton className={planReady && !submitEnabled ? "primary" : ""} pendingLabel="Ouverture…">
                Remplir dans le navigateur (je soumets)
              </SubmitButton>
            </form>
          ) : null}
          {planRun && submitEnabled ? (
            <form action={runPortalAction}>
              <input type="hidden" name="applicationId" value={applicationId} />
              <input type="hidden" name="mode" value="submit" />
              <SubmitButton className={planReady ? "primary" : ""} disabled={!planReady} pendingLabel="Ouverture…">
                Remplir, vérifier et soumettre
              </SubmitButton>
            </form>
          ) : null}
        </div>
      )}
      {planRun && !planReady ? (
        <p className="small muted">La soumission reste bloquée tant qu’une question « À toi » ou une réponse rédigée attend.</p>
      ) : null}
    </section>
  );
}
