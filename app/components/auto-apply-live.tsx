"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { checkSentAction, type SentCheck } from "../auto-apply-actions";

const REFRESH_MS = 3000;
const GMAIL_CHECK_MS = 45000;

/**
 * Keeps the progress page current without a reload:
 *   - while a batch runs, the page refreshes every few seconds;
 *   - while drafts wait to be sent, Gmail is checked now and then (and when you come back to this tab after pressing
 *     Send), and an application whose draft went out moves to "Envoyé".
 * It renders only a small status line and a "Vérifier maintenant" button.
 */
export function AutoApplyLive({ running, waiting }: { running: boolean; waiting: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [last, setLast] = useState<SentCheck | null>(null);
  const busy = useRef(false);

  const check = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await checkSentAction();
        setLast(result);
        if (result.sent > 0) router.refresh();
      } finally {
        busy.current = false;
      }
    });
  }, [router]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [running, router]);

  useEffect(() => {
    if (waiting === 0) return;
    const tick = () => {
      if (document.visibilityState === "visible") check();
    };
    const t = setInterval(tick, GMAIL_CHECK_MS);
    // Coming back from Gmail after pressing Send: look right away.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [waiting, check]);

  if (waiting === 0 && !running) return null;

  return (
    <div className="auto-apply-live" aria-live="polite">
      {waiting > 0 ? (
        <>
          <button type="button" className="small" onClick={check} disabled={pending}>
            {pending ? "Vérification…" : "Vérifier les envois dans Gmail"}
          </button>
          <span className="field-hint">
            {last?.error
              ? `Gmail : ${last.error}`
              : last
                ? last.sent > 0
                  ? `${last.sent} candidature${last.sent > 1 ? "s" : ""} passée${last.sent > 1 ? "s" : ""} à « Envoyé ».`
                  : "Aucun nouvel envoi détecté."
                : "Vérifié automatiquement pendant que cette page est ouverte."}
          </span>
        </>
      ) : null}
    </div>
  );
}
