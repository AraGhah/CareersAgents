/** Shared route list: the sidebar and the Ctrl/⌘K palette both read from it.
 *  `group` sets the sidebar section; `action` items render as a button above
 *  the sections instead of as a link inside one. */
export type NavIconKey = "offers" | "pipeline" | "board" | "bell" | "file" | "form" | "quote" | "plus";

export type NavEntry = {
  href: string;
  label: string;
  icon: NavIconKey;
  group?: "Search" | "Profile";
  action?: boolean;
};

export const NAV_ITEMS: NavEntry[] = [
  { href: "/", label: "Jobs", icon: "offers", group: "Search" },
  { href: "/pipeline", label: "Tracker", icon: "pipeline", group: "Search" },
  { href: "/board", label: "Board", icon: "board", group: "Search" },
  { href: "/approvals", label: "To approve", icon: "form", group: "Search" },
  { href: "/blocked", label: "Blocked", icon: "form", group: "Search" },
  { href: "/auto-apply", label: "Auto-apply", icon: "plus", group: "Search" },
  { href: "/followups", label: "Follow-ups", icon: "bell", group: "Search" },
  { href: "/portal", label: "Portals", icon: "form", group: "Search" },
  { href: "/resumes", label: "Resume", icon: "file", group: "Profile" },
  { href: "/answers", label: "Answers", icon: "quote", group: "Profile" },
  { href: "/jobs/new", label: "Add a job", icon: "plus", action: true },
];
