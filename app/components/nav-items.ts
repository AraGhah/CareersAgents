/** Shared route list — the sidebar, the top-bar search trigger's label, and
 * the ⌘K command palette all read from this single source. */
export const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Offres" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/board", label: "Board" },
  { href: "/followups", label: "Relances" },
  { href: "/resumes", label: "CV" },
  { href: "/answers", label: "Banque" },
  { href: "/jobs/new", label: "Ajouter une offre" },
];
