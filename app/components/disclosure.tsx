"use client";

import { useId, useState } from "react";
import { IconChevronDown } from "./icons";

/**
 * Smooth height animation without a guessed max-height, via the
 * grid-template-rows 0fr -> 1fr technique — works for arbitrary/changing
 * content length. The reusable primitive behind both the Offers table's
 * expandable rows and the CV page's raw-data disclosure.
 */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`collapse${open ? " is-open" : ""}`}>
      <div className="collapse-inner">{children}</div>
    </div>
  );
}

export function Disclosure({
  label,
  openLabel,
  defaultOpen = false,
  children,
}: {
  label: string;
  openLabel?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <IconChevronDown className={`disclosure-chevron${open ? " is-open" : ""}`} />
        {open ? (openLabel ?? label) : label}
      </button>
      <div id={panelId}>
        <Collapse open={open}>{children}</Collapse>
      </div>
    </div>
  );
}
