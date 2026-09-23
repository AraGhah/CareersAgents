import Link from "next/link";
import { bandOf, type Band } from "../../lib/score";
import { APPLICATION_STATUS_FR, BAND_LABEL_FR } from "../../lib/status-labels";
import type { ApplicationStatus } from "../../lib/types";

/* --------------------------------------------------------------------------
   Page + section scaffolding
   -------------------------------------------------------------------------- */

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </header>
  );
}

export function Section({
  n,
  title,
  note,
  children,
  id,
}: {
  /** Two-digit ordinal shown in the rule, e.g. "01". */
  n: string;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="section" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="section-head">
        <h2 data-n={n} id={id ? `${id}-h` : undefined}>
          {title}
        </h2>
        <span className="rule" aria-hidden="true" />
        {note ? <span className="section-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Rendered in place of a page's data when its Postgres query rejects, instead
 * of throwing. Next's App Router would normally route a thrown error to
 * app/error.tsx, but in dev mode this rejection shape trips a Turbopack bug
 * that corrupts the response stream before error.tsx ever reaches the
 * browser (a blank page, not a crash — see lib/db.ts and instrumentation.ts
 * for the rest of that story). Catching it here, per page, sidesteps that
 * path entirely and is also just a better result on a real transient outage:
 * the rest of the shell (nav, other sections) stays interactive.
 */
export function DbUnavailable({ detail }: { detail?: string }) {
  return (
    <EmptyState mark="Hors ligne" title="La base de données ne répond pas">
      Démarre Postgres (<code>docker compose up -d db</code>), puis recharge cette page.
      {detail ? <span className="field-hint">{detail}</span> : null}
    </EmptyState>
  );
}

export function EmptyState({
  mark,
  title,
  children,
  actions,
}: {
  mark?: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark">{mark ?? "Vide"}</span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="cluster">{actions}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Stats
   -------------------------------------------------------------------------- */

export function Stat({
  value,
  label,
  href,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  href?: string;
  tone?: "good" | "alert";
}) {
  const className = `stat${tone === "good" ? " stat-good" : ""}${tone === "alert" ? " stat-alert" : ""}`;
  const body = (
    <>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <article className={className}>{body}</article>;
}

/* --------------------------------------------------------------------------
   Score meter — the number plus the bar it earned. Used everywhere a score
   appears so the same value always reads the same way.
   -------------------------------------------------------------------------- */

export function ScoreMeter({
  score,
  gated,
  compact = false,
}: {
  score: string | number | null;
  gated?: boolean | null;
  compact?: boolean;
}) {
  if (score == null) {
    return (
      <span className="empty" title="Pas encore scoré">
        —
      </span>
    );
  }

  const pct = Math.max(0, Math.min(100, Math.round(Number(score) * 100)));
  const band: Band = bandOf(pct, Boolean(gated));
  const label = BAND_LABEL_FR[band];

  if (compact) {
    return (
      <span className={`badge ${band}`} title={label}>
        {gated ? "skip" : pct}
      </span>
    );
  }

  return (
    <span className={`meter meter-${band}`} title={`${label} : ${pct}/100`}>
      <span className="meter-num">{gated ? "—" : pct}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${gated ? 100 : pct}%` }} />
      </span>
      <span className="visually-hidden">
        {label}, {pct} sur 100
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------------
   Status pill
   -------------------------------------------------------------------------- */

export function StatusPill({ status }: { status: ApplicationStatus | string | null }) {
  if (!status) return <span className="empty">—</span>;
  const label = APPLICATION_STATUS_FR[status as ApplicationStatus] ?? status;
  return <span className={`badge status status-${status}`}>{label}</span>;
}

/* --------------------------------------------------------------------------
   Table shell — gives every table a rounded frame, horizontal scroll on
   narrow screens, and (when `stackable`) a card layout under 760px.
   -------------------------------------------------------------------------- */

export function TableWrap({
  children,
  stackable = true,
}: {
  children: React.ReactNode;
  stackable?: boolean;
}) {
  return <div className={`table-wrap${stackable ? " stackable" : ""}`}>{children}</div>;
}
