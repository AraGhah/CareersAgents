// Small text helpers shared by the matcher, the classifier and the answer checks.

/** Lowercase, strip accents and punctuation, collapse spaces: "Québec (QC)" → "quebec qc". */
export function norm(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9+#.' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(value: string): string[] {
  return norm(value)
    .split(" ")
    .map((w) => w.replace(/^[.']+|[.']+$/g, ""))
    .filter(Boolean);
}

export function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export function sentences(value: string): string[] {
  return value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A form label cleaned of the required-marker and trailing noise. */
export function cleanLabel(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .replace(/\s*\*+\s*$/g, "")
    .replace(/\s*\((required|obligatoire|optional|facultatif)\)\s*$/i, "")
    .replace(/\s*[:：]\s*$/, "")
    .trim();
}

/** Stable key for a field across page loads: same label and kind → same signature. */
export function fieldSignature(label: string, kind: string, name: string | null): string {
  const base = norm(cleanLabel(label)).slice(0, 120) || norm(name ?? "") || "field";
  return `${kind}:${base}`;
}
