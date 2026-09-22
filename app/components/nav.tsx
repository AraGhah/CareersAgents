"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
  /** Optional live count shown as a pill (follow-ups due, etc.). */
  count?: number;
};

/** Marks the deepest matching route so nested pages keep their section lit. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/jobs/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="rail-nav" aria-label="Sections">
      {items.map((item, i) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="nav-link"
            data-n={String(i + 1).padStart(2, "0")}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
            {item.count ? (
              <span className="nav-count" aria-label={`${item.count} en attente`}>
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
