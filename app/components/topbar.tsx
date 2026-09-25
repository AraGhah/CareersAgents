"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ThemeToggle } from "./client-ui";
import { useCommandPalette } from "./command-palette";
import { IconBrand, IconSearch } from "./icons";
import type { DeskOwner } from "../../lib/desk-owner";

const noopSubscribe = () => () => {};

/** "⌘K" on Apple devices, "Ctrl K" everywhere else. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

export function TopBar({
  assistedMode,
  owner,
}: {
  assistedMode: boolean;
  owner: DeskOwner;
}) {
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

      <button
        type="button"
        className="topbar-search"
        onClick={palette.open}
        aria-label={`Rechercher (${shortcut})`}
      >
        <IconSearch />
        <span className="topbar-search-label" aria-hidden="true">
          Rechercher
        </span>
        <kbd aria-hidden="true">{shortcut}</kbd>
      </button>

      <span className="topbar-spacer" />

      <div className="topbar-actions">
        <span className="topbar-env" data-mode={assistedMode ? "assisted" : "manual"}>
          {assistedMode ? "Mode assisté" : "Mode manuel"}
        </span>
        <ThemeToggle />
        <AccountMenu owner={owner} />
      </div>
    </header>
  );
}

function AccountMenu({ owner }: { owner: DeskOwner }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="account-trigger" aria-label="Compte">
          <span className="avatar" aria-hidden="true">
            {owner.initials}
          </span>
          <span className="account-trigger-name">{owner.shortName}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ctl-content" align="end" sideOffset={8}>
          <div className="ctl-viewport">
            <div className="account-menu-identity">
              <div className="account-menu-name">{owner.fullName}</div>
              <div className="account-menu-email">{owner.email}</div>
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
