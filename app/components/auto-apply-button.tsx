"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "./client-ui";

const MAX_COUNT = 50;

/**
 * The "Postuler automatiquement" button: opens a small dialog that asks how many internships, says plainly what will
 * and will not happen, and starts the batch in the background (the page it lands on shows the progress).
 */
export function AutoApplyButton({
  action,
  eligible,
  minScore,
  gmailConnected,
  submitEnabled,
  runningId,
}: {
  action: (form: FormData) => void | Promise<void>;
  /** Postings the batch could go after right now. */
  eligible: number;
  minScore: number;
  gmailConnected: boolean;
  /** PORTAL_ALLOW_SUBMIT=true: online forms are submitted. Otherwise they are skipped. */
  submitEnabled: boolean;
  /** Set while a batch is running: a second one cannot start. */
  runningId: string | null;
}) {
  const max = Math.max(1, Math.min(MAX_COUNT, eligible));
  const [count, setCount] = useState(String(Math.min(5, max)));
  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_COUNT;
  const blocked = !gmailConnected || eligible === 0 || runningId !== null;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button">Postuler automatiquement</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content auto-apply-dialog">
          <Dialog.Title className="auto-apply-title">Postuler automatiquement</Dialog.Title>
          <Dialog.Description className="auto-apply-lede">
            Le bureau passe les offres une par une, de la meilleure à la moins bonne (score {minScore} et plus).
          </Dialog.Description>

          {runningId ? (
            <p className="flash flash-info" role="status">
              Un lot est déjà en cours. <Link href={`/auto-apply?run=${runningId}`}>Voir la progression</Link>
            </p>
          ) : null}
          {!gmailConnected ? (
            <p className="flash flash-warn" role="status">
              Gmail n’est pas connecté : lance <code>npm run gmail:auth</code> une fois, puis reviens ici.
            </p>
          ) : null}

          <form action={action} className="auto-apply-form">
            <div className="field">
              <label htmlFor="auto-apply-count">À combien de stages veux-tu postuler ?</label>
              <input
                id="auto-apply-count"
                name="count"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_COUNT}
                step={1}
                required
                value={count}
                onChange={(e) => setCount(e.target.value)}
                disabled={blocked}
                autoFocus
              />
              <span className="field-hint">
                {eligible === 0
                  ? "Aucune offre admissible pour le moment."
                  : `${eligible} offre${eligible > 1 ? "s" : ""} admissible${eligible > 1 ? "s" : ""} en ce moment.${
                      valid && n > eligible ? " Le bureau s’arrêtera quand il n’y en aura plus." : ""
                    }`}
              </span>
            </div>

            <ul className="auto-apply-facts">
              <li>
                <strong>Adresse publiée par l’entreprise :</strong> un brouillon est créé dans Gmail, avec ton CV et la lettre
                joints. Tu cliques sur Envoyer toi-même ; la candidature passe à « Envoyé » dès que l’envoi est détecté.
              </li>
              <li>
                <strong>Formulaire en ligne :</strong>{" "}
                {submitEnabled
                  ? "il est rempli page par page puis envoyé si toutes les vérifications passent ; sinon il t’attend, avec ce qui bloque, la page où il s’est arrêté et un bouton pour continuer à la main."
                  : "ignoré pour l’instant, l’envoi automatique est désactivé (PORTAL_ALLOW_SUBMIT=true dans .env.local pour l’activer)."}
              </li>
              <li>
                Les offres que le bureau ne peut pas traiter (portails avec compte, doublons) sont sautées et ne comptent pas
                dans ton nombre.
              </li>
            </ul>

            <div className="form-actions">
              <SubmitButton className="primary" pendingLabel="Lancement…" disabled={blocked || !valid}>
                Lancer
              </SubmitButton>
              <Dialog.Close asChild>
                <button type="button">Annuler</button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
