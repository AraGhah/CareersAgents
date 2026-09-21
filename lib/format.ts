export function day(value: Date | string | null): string {
  if (!value) return "\u2014";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}

export function place(location: string | null, workplaceType: string | null): string {
  const parts = [location, workplaceType].filter(Boolean);
  return parts.length ? parts.join(" \u00b7 ") : "\u2014";
}

export function percent(value: string | number | null): string {
  if (value == null) return "\u2014";
  return String(Math.round(Number(value) * 100));
}
