/** Chrome identity for the desk owner — overridable via env so the UI
 *  is not hard-wired to a single person. Falls back to GMAIL_USER_EMAIL
 *  for the address when DESK_OWNER_EMAIL is unset. */

export type DeskOwner = {
  fullName: string;
  shortName: string;
  email: string;
  initials: string;
};

export function getDeskOwner(): DeskOwner {
  const fullName = process.env.DESK_OWNER_NAME?.trim() || "Ara Ghahramanyan";
  const email =
    process.env.DESK_OWNER_EMAIL?.trim() ||
    process.env.GMAIL_USER_EMAIL?.trim() ||
    "ara.ghahramanyan07@gmail.com";
  const shortName =
    process.env.DESK_OWNER_SHORT?.trim() ||
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .map((part, i, parts) => (i === parts.length - 1 ? `${part[0]}.` : part))
      .join(" ");
  const initials =
    process.env.DESK_OWNER_INITIALS?.trim() ||
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");

  return { fullName, shortName, email, initials };
}
