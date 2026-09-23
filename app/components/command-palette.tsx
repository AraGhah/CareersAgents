"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { IconArrowRight, IconPlus, IconSearch } from "./icons";
import { NAV_ITEMS } from "./nav-items";

type CommandPaletteContextValue = { open: () => void };

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

/** Lets the top bar's search button open the same palette the ⌘K shortcut does. */
export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within <CommandPaletteProvider>");
  return ctx;
}

/**
 * Global ⌘K / Ctrl+K palette. Fuzzy-searches the same routes as the
 * sidebar, plus a couple of quick actions — mounted once in the root layout
 * so the shortcut works from anywhere in the app.
 */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandPaletteContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Palette de commandes"
        overlayClassName="dialog-overlay"
        contentClassName="dialog-content"
        shouldFilter
        loop
      >
        <div className="cmdk-input-row cmdk-input-wrap">
          <IconSearch />
          <Command.Input autoFocus placeholder="Aller à… ou chercher une action" />
        </div>
        <Command.List>
          <Command.Empty>Aucun résultat.</Command.Empty>
          <Command.Group heading="Aller à">
            {NAV_ITEMS.map((item) => (
              <Command.Item key={item.href} value={item.label} onSelect={() => go(item.href)}>
                <IconArrowRight />
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Actions rapides">
            <Command.Item value="Ajouter une offre" onSelect={() => go("/jobs/new")}>
              <IconPlus />
              Ajouter une offre
            </Command.Item>
            <Command.Item value="Lancer une recherche" onSelect={() => go("/pipeline#recherche")}>
              <IconArrowRight />
              Lancer une recherche de stages
            </Command.Item>
          </Command.Group>
        </Command.List>
        <div className="cmdk-foot">
          <span className="cluster">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            naviguer
          </span>
          <span className="cluster">
            <kbd>↵</kbd>
            ouvrir
          </span>
          <span className="cluster">
            <kbd>esc</kbd>
            fermer
          </span>
        </div>
      </Command.Dialog>
    </CommandPaletteContext.Provider>
  );
}
