/* --------------------------------------------------------------------------
   Company tile: a monogram on a tint picked from the company name, so the
   same company always looks the same and rows are easy to scan. Kept in its
   own module (no server-only imports) so client components such as the
   Kanban board can use it without pulling lib/score into the bundle.
   -------------------------------------------------------------------------- */

const TILE_TONES = ["accent", "brass", "slate", "amber", "clay"] as const;

export function CompanyTile({ name, size }: { name: string; size?: "sm" }) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const initials = ((words[0]?.[0] ?? "?") + (size === "sm" ? "" : (words[1]?.[0] ?? ""))).toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className={`tile tile-${TILE_TONES[hash % TILE_TONES.length]}${size ? ` ${size}` : ""}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
