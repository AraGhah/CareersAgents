"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";
import { IconChevronDown, IconPlus, IconSearch } from "./icons";

export type ComboboxOption = { value: string; label: string; hint?: string };

/**
 * A searchable single-select popover — the "browser-default <select>"
 * replacement for lists worth typing to filter (companies, long enums).
 * Purely client-side state: the caller owns the value and renders whatever
 * hidden form inputs it needs from it, so this has no opinion on how the
 * value gets submitted.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Rechercher…",
  emptyLabel = "Aucun résultat",
  allowCreate = false,
  createLabel,
  onCreate,
  renderTrigger,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  allowCreate?: boolean;
  createLabel?: (query: string) => string;
  onCreate?: (query: string) => void;
  renderTrigger?: (selected: ComboboxOption | undefined) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className="ctl-trigger" data-state={open ? "open" : "closed"}>
          <span className="ctl-trigger-value">
            {selected ? (
              (renderTrigger?.(selected) ?? selected.label)
            ) : (
              <span className="placeholder">{placeholder}</span>
            )}
          </span>
          <IconChevronDown className="ctl-chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ctl-content"
          align="start"
          sideOffset={6}
          style={{ width: "var(--radix-popover-trigger-width)" }}
          onOpenAutoFocus={(e) => {
            // Let cmdk's own input take focus instead of the popover shell.
            e.preventDefault();
          }}
        >
          <Command shouldFilter loop>
            <div className="combobox-search">
              <IconSearch />
              <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder={placeholder} />
            </div>
            <Command.List>
              <Command.Empty className="combobox-empty">{emptyLabel}</Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span style={{ width: 13, display: "inline-flex", flex: "none" }}>
                    {o.value === value ? (
                      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                          d="M3.5 8.5l3 3 6-7"
                          stroke="var(--accent)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  {o.label}
                  {o.hint ? (
                    <span className="cmdk-hint" style={{ marginLeft: "auto" }}>
                      {o.hint}
                    </span>
                  ) : null}
                </Command.Item>
              ))}
              {allowCreate && query.trim() && !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()) ? (
                <Command.Item
                  value={`__create__${query}`}
                  className="combobox-create"
                  onSelect={() => {
                    onCreate?.(query.trim());
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <IconPlus />
                  {createLabel ? createLabel(query.trim()) : `Ajouter « ${query.trim()} »`}
                </Command.Item>
              ) : null}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
