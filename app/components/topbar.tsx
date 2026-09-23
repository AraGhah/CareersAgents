"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { ThemeToggle } from "./client-ui";
import { useCommandPalette } from "./command-palette";
import { IconSearch } from "./icons";

export function TopBar({ assistedMode }: { assistedMode: boolean }) {
  const palette = useCommandPalette();

  return (
    <header className="topbar">
      <Link href="/" className="topbar-brand">
        <span className="topbar-brand-mark">Internship Desk</span>
      </Link>

      <button type="button" className="topbar-search" onClick={palette.open}>
        <IconSearch />
        <span className="topbar-search-label">Rechercher ou aller à…</span>
        <kbd>⌘K</kbd>
      </button>

      <span className="topbar-spacer" />

      <div className="topbar-actions">
        <span className="topbar-env">
          <span className="dot" aria-hidden="true" />
          {assistedMode ? "Mode assisté" : "Mode manuel"}
        </span>
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}

function AccountMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="account-trigger" aria-label="Compte">
          <span className="avatar" aria-hidden="true">
            AG
          </span>
          <span className="account-trigger-name">
            <strong>Ara G.</strong>
            <span>Compte</span>
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ctl-content" align="end" sideOffset={8}>
          <div className="ctl-viewport">
            <div style={{ padding: "var(--s-2) var(--s-3) var(--s-3)" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--ink-0)" }}>
                Ara Ghahramanyan
              </div>
              <div style={{ fontSize: "0.76rem", color: "var(--ink-3)" }}>
                ara.ghahramanyan07@gmail.com
              </div>
            </div>
            <div className="ctl-sep" />
            <DropdownMenu.Item className="ctl-item plain" asChild>
              <Link href="/answers">Banque de réponses</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="ctl-item plain" asChild>
              <Link href="/resumes">CV actifs</Link>
            </DropdownMenu.Item>
            <div className="ctl-sep" />
            <div
              className="ctl-item plain"
              style={{ cursor: "default", color: "var(--ink-3)", fontSize: "0.76rem" }}
              aria-hidden="true"
            >
              Rien n&apos;est envoyé sans ton approbation.
            </div>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
