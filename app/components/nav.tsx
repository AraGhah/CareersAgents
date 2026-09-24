"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

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
  // Several items can match (/jobs/new is under both "/" and "/jobs/new");
  // the longest href is the most specific, and only that one is lit.
  const activeIndex = items.reduce(
    (best, item, i) =>
      isActive(pathname, item.href) && (best < 0 || item.href.length > items[best].href.length)
        ? i
        : best,
    -1,
  );
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ y: number; visible: boolean }>({
    y: 0,
    visible: false,
  });

  // Reads real layout (link offsetTop) to drive the sliding highlight — no
  // way to know that ahead of paint, so this is a legitimate effect, not a
  // workaround. Runs before the browser paints to avoid a visible jump.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || activeIndex < 0) {
      setIndicator((prev) => ({ ...prev, visible: false }));
      return;
    }
    const link = nav.querySelectorAll<HTMLAnchorElement>(".nav-link")[activeIndex];
    if (!link) return;
    setIndicator({ y: link.offsetTop, visible: true });
  }, [activeIndex, pathname]);

  return (
    <nav
      className="rail-nav"
      aria-label="Sections"
      ref={navRef}
      style={
        {
          "--nav-y": `${indicator.y}px`,
          "--nav-o": indicator.visible ? 1 : 0,
        } as React.CSSProperties
      }
    >
      <span className="nav-indicator" aria-hidden="true" />
      {items.map((item, i) => {
        const active = i === activeIndex;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="nav-link"
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
