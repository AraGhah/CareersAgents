/** Shared route list: the sidebar and the Ctrl/⌘K palette both read from it.
 *  `group` sets the sidebar section; `action` items render as a button above
 *  the sections instead of as a link inside one. */
export type NavIconKey = "offers" | "pipeline" | "board" | "bell" | "file" | "quote" | "plus";

export type NavEntry = {
  href: string;
  label: string;
  icon: NavIconKey;
  group?: "Recherche" | "Profil";
  action?: boolean;
};

export const NAV_ITEMS: NavEntry[] = [
  { href: "/", label: "Offres", icon: "offers", group: "Recherche" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline", group: "Recherche" },
  { href: "/board", label: "Board", icon: "board", group: "Recherche" },
  { href: "/followups", label: "Relances", icon: "bell", group: "Recherche" },
  { href: "/resumes", label: "CV", icon: "file", group: "Profil" },
  { href: "/answers", label: "Banque de réponses", icon: "quote", group: "Profil" },
  { href: "/jobs/new", label: "Ajouter une offre", icon: "plus", action: true },
];
