const TZ = "America/Montreal";
const SHORT_DAY = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", timeZone: TZ });
const SHORT_DAY_YEAR = new Intl.DateTimeFormat("fr-CA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
const YEAR = new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: TZ });
const LONG_DAY = new Intl.DateTimeFormat("fr-CA", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});

/** "Jeudi 24 septembre" — today's date as a heading reads it. */
export function today(): string {
  const s = LONG_DAY.format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "23 sept.", with the year only when it isn't the current one. The zone is
 *  pinned so server and browser always agree, and a date-only string
 *  ("2026-09-22") is a calendar day, not a UTC instant. */
export function day(value: Date | string | null): string {
  if (!value) return "—";
  const d =
    typeof value === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00Z`)
        : new Date(value)
      : value;
  if (Number.isNaN(d.getTime())) return "—";
  return (YEAR.format(d) === YEAR.format(new Date()) ? SHORT_DAY : SHORT_DAY_YEAR).format(d);
}

export function place(location: string | null, workplaceType: string | null): string {
  const parts = [location, workplaceType].filter(Boolean);
  return parts.length ? parts.join(" \u00b7 ") : "\u2014";
}

export function percent(value: string | number | null): string {
  if (value == null) return "\u2014";
  return String(Math.round(Number(value) * 100));
}
