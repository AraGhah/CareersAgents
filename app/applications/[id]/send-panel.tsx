"use client";

import { useState } from "react";
import { gmailComposeUrl, looksLikeEmail, mailtoUrl } from "../../../lib/gmail-link";
import { CopyButton, SubmitButton } from "../../components/client-ui";

export type Suggestion = {
  email: string;
  /** "recruiting" or "generic": what kind of inbox the address is. */
  kind: "recruiting" | "generic" | "other";
  /** The public page the address was read from. */
  source: string;
  sourceHost: string;
};

/**
 * The last step. The recipient comes from the company's own public pages (with the page shown, so it can
 * be checked). "Créer le brouillon Gmail" puts the email in Gmail with the CV and the cover letter already
 * attached; the other buttons open a message without attachments, for when Gmail is not connected.
 */
export function SendPanel({
  applicationId,
  subject,
  body,
  defaultTo,
  suggestions,
  account,
  companyName,
  postingUrl,
  gmailConnected,
  draft,
  attachmentNames,
  saveDraftAction,
  findRecipientAction,
  files,
}: {
  applicationId: string;
  subject: string;
  body: string;
  defaultTo: string;
  suggestions: Suggestion[];
  account?: string;
  companyName: string;
  postingUrl: string;
  gmailConnected: boolean;
  /** The draft already made for this application, when there is one. */
  draft: { link: string; when: string } | null;
  attachmentNames: string[];
  saveDraftAction: (form: FormData) => Promise<void>;
  findRecipientAction: (form: FormData) => Promise<void>;
  files: Array<{ label: string; href: string }>;
}) {
  const [to, setTo] = useState(defaultTo);
  const address = to.trim();
  const invalid = address !== "" && !looksLikeEmail(address);
  const message = { to: invalid ? undefined : address || undefined, subject, body, account };
  const known = suggestions.find((s) => s.email.toLowerCase() === address.toLowerCase());

  return (
    <div className="send-panel">
      <div className="field">
        <label htmlFor="sendTo">
          Envoyer à <span className="optional">(tu peux le changer)</span>
        </label>
        <input
          id="sendTo"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="recruteur@entreprise.com"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-invalid={invalid}
        />
        {invalid ? <span className="field-error">Cette adresse n’a pas l’air valide.</span> : null}
        {known ? (
          <span className="field-hint">
            {known.kind === "recruiting" ? "Adresse de recrutement" : "Adresse générale de l’entreprise (à vérifier)"},
            lue sur{" "}
            <a href={known.source} target="_blank" rel="noopener noreferrer">
              {known.sourceHost}
            </a>
            .
          </span>
        ) : null}
      </div>

      {suggestions.length > 1 ? (
        <div className="send-suggestions" aria-label="Autres adresses trouvées">
          {suggestions
            .filter((s) => s.email.toLowerCase() !== address.toLowerCase())
            .map((s) => (
              <button key={s.email} type="button" className="small" onClick={() => setTo(s.email)}>
                {s.email}
              </button>
            ))}
        </div>
      ) : null}

      {suggestions.length === 0 ? (
        <div className="send-none">
          <p>
            <strong>Aucune adresse publique trouvée pour {companyName}.</strong> Beaucoup d’entreprises reçoivent les
            candidatures par un formulaire plutôt que par courriel : le plus sûr est de postuler sur l’offre. Tu peux
            aussi taper une adresse ci-dessus si tu en as une.
          </p>
          <div className="form-actions">
            <a className="btn" href={postingUrl} target="_blank" rel="noopener noreferrer">
              Ouvrir l’offre pour postuler
            </a>
            <form action={findRecipientAction}>
              <input type="hidden" name="applicationId" value={applicationId} />
              <SubmitButton pendingLabel="Recherche…">Chercher à nouveau</SubmitButton>
            </form>
          </div>
        </div>
      ) : null}

      <div className="send-gmail">
        <h3 className="send-gmail-title">Brouillon Gmail</h3>
        {gmailConnected ? (
          <>
            <p className="send-gmail-lede">
              {attachmentNames.length
                ? `Le CV et la lettre sont joints automatiquement (${attachmentNames.join(", ")}). Rien n’est envoyé : tu relis et tu cliques sur Envoyer dans Gmail.`
                : "Rien n’est envoyé : tu relis et tu cliques sur Envoyer dans Gmail."}
            </p>
            <div className="form-actions">
              <form action={saveDraftAction}>
                <input type="hidden" name="applicationId" value={applicationId} />
                <input type="hidden" name="to" value={invalid ? "" : address} />
                <SubmitButton className="primary" pendingLabel="Création du brouillon…">
                  {draft ? "Mettre à jour le brouillon Gmail" : "Créer le brouillon Gmail (CV et lettre joints)"}
                </SubmitButton>
              </form>
              {draft ? (
                <a className="btn" href={draft.link} target="_blank" rel="noopener noreferrer">
                  Ouvrir le brouillon dans Gmail
                </a>
              ) : null}
            </div>
            {draft ? <p className="send-gmail-meta">Brouillon prêt · {draft.when}</p> : null}
          </>
        ) : (
          <p className="send-gmail-lede">
            Gmail n’est pas connecté. Lance <code>npm run gmail:auth</code> une seule fois : ensuite, le CV et la
            lettre seront joints automatiquement au brouillon. En attendant, utilise les boutons ci-dessous.
          </p>
        )}
      </div>

      <details className="apply-more" open={!gmailConnected}>
        <summary>Sans pièces jointes automatiques</summary>
        <div className="apply-more-body">
          <div className="form-actions">
            <a className="btn" href={gmailComposeUrl(message)} target="_blank" rel="noopener noreferrer">
              Ouvrir dans Gmail
            </a>
            <a className="btn" href={mailtoUrl(message)}>
              Ouvrir dans l’app de messagerie
            </a>
            <CopyButton value={body} label="Copier le texte" className="btn" />
          </div>
          <p className="send-files-title">Ces ouvertures ne joignent pas les fichiers : télécharge-les puis glisse-les dans le message.</p>
          <ul className="send-files-list">
            {files.map((f) => (
              <li key={f.href}>
                <a className="btn small" href={f.href} download>
                  {f.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
