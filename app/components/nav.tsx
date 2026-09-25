"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import {
  IconBell,
  IconBoard,
  IconFile,
  IconOffers,
  IconPipeline,
  IconPlus,
  IconQuote,
} from "./icons";
import type { NavEntry, NavIconKey } from "./nav-items";

const ICONS: Record<NavIconKey, React.ComponentType<{ className?: string }>> = {
  offers: IconOffers,
  pipeline: IconPipeline,
  board: IconBoard,
  bell: IconBell,
  file: IconFile,
  quote: IconQuote,
  plus: IconPlus,
};

/** True when `href` is the page (or a parent of it). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/jobs/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav({ items }: { items: Array<NavEntry & { count?: number }> }) {
  const pathname = usePathname() ?? "/";
  const action = items.find((i) => i.action);
  const links = items.filter((i) => !i.action);
  const groups = [...new Set(links.map((i) => i.group ?? ""))];

  // Several items can match (/jobs/new sits under "/"); the longest href is
  // the most specific and the only one lit. The add-offer action counts too,
  // so "/" doesn't light up on /jobs/new.
  const best = items.reduce<NavEntry | null>(
    (acc, item) =>
      isActive(pathname, item.href) && (!acc || item.href.length > acc.href.length) ? item : acc,
    null,
  );
  const activeHref = best && !best.action ? best.href : null;

  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ y: number; visible: boolean }>({ y: 0, visible: false });

  useLayoutEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLAnchorElement>('.nav-link[aria-current="page"]');
    if (!link) {
      setIndicator((prev) => ({ ...prev, visible: false }));
      return;
    }
    setIndicator({ y: link.offsetTop, visible: true });
  }, [activeHref, pathname]);

  const ActionIcon = action ? ICONS[action.icon] : null;

  return (
    <>
      {action && ActionIcon ? (
        <Link
          href={action.href}
          className="rail-action"
          aria-label={action.label}
          aria-current={best?.action ? "page" : undefined}>
          <ActionIcon />
          <span className="rail-action-label">{action.label}</span>
        </Link>
      ) : null}

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
        {groups.map((group) => (
          <div className="nav-group" key={group} role="group" aria-label={group || undefined}>
            {group ? <span className="nav-group-label">{group}</span> : null}
            {links
              .filter((i) => (i.group ?? "") === group)
              .map((item) => {
                const Icon = ICONS[item.icon];
                const active = item.href === activeHref;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-link"
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="nav-icon" />
                    {item.label}
                    {item.count ? (
                      <span className="nav-count" aria-label={`${item.count} en attente`}>
                        {item.count}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
    </>
  );
}
