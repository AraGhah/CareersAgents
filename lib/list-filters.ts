// The score filter and the ordering on the Offres list and on the Tracker: which choices exist, how a URL parameter becomes
// one of them, and how the Tracker's rows are filtered and ordered. No database here, so it can be tested on its own.

// ---------------------------------------------------------------------------
// Minimum score
// ---------------------------------------------------------------------------

/** The lowest scores worth a shortcut, in percent. "" is the default (60 and over, skipped jobs left alone), "0" shows everything. */
export const MIN_SCORE_CHOICES = [50, 70, 75, 80, 85, 90] as const;

export const MIN_SCORE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Score : 60 et plus (par défaut)" },
  { value: "0", label: "Tous les scores" },
  ...MIN_SCORE_CHOICES.map((n) => ({ value: String(n), label: `Score : ${n} et plus` })),
];

/**
 * The minimum score a URL asks for, or undefined for the default. `low=1` is the old "Sous 60" checkbox: every score.
 * Anything that is not one of the offered choices is ignored, so a hand-edited URL cannot ask for a strange cut.
 */
export function parseMinScore(min: string | undefined, low?: string): number | undefined {
  if (min !== undefined && min !== "") {
    const n = Number(min);
    if (n === 0 || (MIN_SCORE_CHOICES as readonly number[]).includes(n)) return n;
  }
  return low === "1" ? 0 : undefined;
}

export function minScoreLabel(min: number | undefined): string | null {
  if (min === undefined) return null;
  return min === 0 ? "tous les scores" : `score ${min} et plus`;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** "actionable" is the earlier ordering: jobs whose company has a known email first, priority companies next. */
export type JobSort = "best" | "worst" | "recent" | "company";
export type JobListSort = JobSort | "actionable";

export const JOB_SORT_OPTIONS: Array<{ value: JobListSort; label: string }> = [
  { value: "best", label: "Tri : meilleur score d’abord" },
  { value: "worst", label: "Tri : moins bon score d’abord" },
  { value: "recent", label: "Tri : plus récentes d’abord" },
  { value: "company", label: "Tri : entreprise (A → Z)" },
  { value: "actionable", label: "Tri : avec email d’abord" },
];

export function parseJobSort(raw: string | undefined): JobListSort {
  return JOB_SORT_OPTIONS.find((o) => o.value === raw)?.value ?? "best";
}

export const jobSortLabel = (sort: JobListSort) => JOB_SORT_OPTIONS.find((o) => o.value === sort)?.label.replace(/^Tri : /, "") ?? "";

// ---------------------------------------------------------------------------
// The Tracker
// ---------------------------------------------------------------------------

/** On the Tracker the default shows every application (nothing is hidden unless asked), so 60 is a choice like the others. */
export const TRACKER_MIN_CHOICES = [50, 60, 70, 75, 80, 85, 90] as const;

export const TRACKER_MIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tous les scores" },
  ...TRACKER_MIN_CHOICES.map((n) => ({ value: String(n), label: `Score : ${n} et plus` })),
];

export function parseTrackerMin(raw: string | undefined): number | undefined {
  const n = Number(raw);
  return raw && (TRACKER_MIN_CHOICES as readonly number[]).includes(n) ? n : undefined;
}

export type TrackerSort = "status" | "best" | "worst";

export const TRACKER_SORT_OPTIONS: Array<{ value: TrackerSort; label: string }> = [
  { value: "status", label: "Tri : par statut, puis meilleur score" },
  { value: "best", label: "Tri : meilleur score d’abord" },
  { value: "worst", label: "Tri : moins bon score d’abord" },
];

export function parseTrackerSort(raw: string | undefined): TrackerSort {
  return TRACKER_SORT_OPTIONS.find((o) => o.value === raw)?.value ?? "status";
}

/**
 * The Tracker's rows under a minimum score and an ordering. A row not scored yet is kept (its score is pending, not low).
 * "status" is the order the query already gives (by status, then best score), so those rows are returned as they come.
 */
export function viewTrackerRows<T extends { score: string | null }>(rows: T[], opts: { min?: number; sort: TrackerSort }): T[] {
  const cut = opts.min === undefined ? 0 : opts.min / 100;
  const kept = rows.filter((r) => r.score == null || Number(r.score) >= cut);
  if (opts.sort === "status") return kept;
  const value = (r: T) => (r.score == null ? null : Number(r.score));
  const dir = opts.sort === "best" ? -1 : 1;
  // Unscored rows go last whichever way it is sorted; ties keep the order the query gave (stable sort).
  return [...kept].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return dir * (x - y);
  });
}
