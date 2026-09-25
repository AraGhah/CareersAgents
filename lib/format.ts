const TZ = "America/Montreal";
const SHORT_DAY = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", timeZone: TZ });
const SHORT_DAY_YEAR = new Intl.DateTimeFormat("fr-CA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
const YEAR = new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: TZ });
const ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});
const LONG_DAY = new Intl.DateTimeFormat("fr-CA", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});

export const WORKPLACE_LABEL_FR: Record<string, string> = {
  onsite: "Sur place",
  hybrid: "Hybride",
  remote: "À distance",
};

/** "Jeudi 24 septembre" — today's date as a heading reads it. */
export function today(): string {
  const s = LONG_DAY.format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Calendar day in America/Montreal as YYYY-MM-DD (not UTC). */
export function todayIso(): string {
  // en-CA with timeZone yields YYYY-MM-DD.
  return ISO_DAY.format(new Date());
}

/** "23 sept.", with the year only when it isn't the current one. The zone is
 *  pinned so server and browser always agree, and a date-only string
 *  ("2026-09-22") is a calendar day, not a UTC instant. */
export function day(value: Date | string | null): string {
  if (!value) return "n/d";
  const d =
    typeof value === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00Z`)
        : new Date(value)
      : value;
  if (Number.isNaN(d.getTime())) return "n/d";
  return (YEAR.format(d) === YEAR.format(new Date()) ? SHORT_DAY : SHORT_DAY_YEAR).format(d);
}

export function place(location: string | null, workplaceType: string | null): string {
  const workplace = workplaceType ? (WORKPLACE_LABEL_FR[workplaceType] ?? workplaceType) : null;
  const parts = [location, workplace].filter(Boolean);
  return parts.length ? parts.join(" \u00b7 ") : "\u2014";
}

export function percent(value: string | number | null): string {
  if (value == null) return "\u2014";
  return String(Math.round(Number(value) * 100));
}
