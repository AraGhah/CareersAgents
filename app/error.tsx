"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Most failures here are "Postgres is not running", so the recovery copy
 *  names that first instead of showing a bare stack trace. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const looksLikeDb =
    /ECONNREFUSED|connect|pool|postgres|database|relation .* does not exist/i.test(error.message);

  return (
    <>
      <header className="page-head">
        <div className="page-head-text">
          <span className="eyebrow">Erreur</span>
          <h1>Cette page n&apos;a pas pu se charger</h1>
          <p className="lede">
            {looksLikeDb
              ? "La base de données ne répond pas. Démarre Postgres, puis réessaie."
              : "Quelque chose a échoué pendant le rendu. Réessaie, ou consulte la console."}
          </p>
        </div>
      </header>

      {looksLikeDb ? (
        <div className="panel">
          <p className="small muted" style={{ marginBottom: "0.5rem" }}>
            Démarrer la base :
          </p>
          <pre className="code-block">docker compose up -d db</pre>
        </div>
      ) : null}

      <details className="panel panel-quiet">
        <summary className="small muted" style={{ cursor: "pointer" }}>
          Détail technique
        </summary>
        <pre className="code-block" style={{ marginTop: "0.75rem" }}>
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
      </details>

      <div className="cluster">
        <button type="button" className="primary" onClick={reset}>
          Réessayer
        </button>
        <Link className="btn" href="/">
          Retour aux offres
        </Link>
      </div>
    </>
  );
}
