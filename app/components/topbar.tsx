"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ThemeToggle } from "./client-ui";
import { useCommandPalette } from "./command-palette";
import { IconBrand, IconSearch } from "./icons";

const noopSubscribe = () => () => {};

/** "⌘K" on Apple devices, "Ctrl K" everywhere else. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

export function TopBar({ assistedMode }: { assistedMode: boolean }) {
  const palette = useCommandPalette();
  const shortcut = useShortcutLabel();

  return (
    <header className="topbar">
      <Link href="/" className="topbar-brand">
        <span className="brand-logo">
          <IconBrand />
        </span>
        <span className="topbar-brand-mark">Internship Desk</span>
      </Link>

      <button type="button" className="topbar-search" onClick={palette.open}>
        <IconSearch />
        <span className="topbar-search-label">Rechercher</span>
        <kbd>{shortcut}</kbd>
      </button>

      <span className="topbar-spacer" />

      <div className="topbar-actions">
        <span className="topbar-env" data-mode={assistedMode ? "assisted" : "manual"}>
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
          <span className="account-trigger-name">Ara G.</span>
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
              <Link href="/resumes">CV</Link>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
