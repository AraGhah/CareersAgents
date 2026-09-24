"use client";

import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSwitch from "@radix-ui/react-switch";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { IconCheck, IconChevronDown } from "./icons";
import { useToast, type ToastTone } from "./toaster";

/* --------------------------------------------------------------------------
   Submit button — every server action now reports that it is working.
   -------------------------------------------------------------------------- */

export function SubmitButton({
  children,
  className = "",
  pendingLabel,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      {...rest}
      type="submit"
      className={className}
      data-pending={pending ? "true" : undefined}
      aria-disabled={pending || undefined}
      aria-live="polite"
    >
      {pending ? (pendingLabel ?? children) : children}
      {pending ? <span className="visually-hidden">En cours…</span> : null}
    </button>
  );
}

/* --------------------------------------------------------------------------
   Flash — a dismissible result banner that also clears its own query string
   (so a refresh does not replay a stale "done" message) and echoes itself
   into a toast, so a result that happened after a redirect still feels like
   something just happened instead of merely being some text on the page.
   -------------------------------------------------------------------------- */

export type FlashTone = "success" | "info" | "warn" | "error";

const TONE_CLASS: Record<FlashTone, string> = {
  success: "",
  info: "flash-info",
  warn: "flash-warn",
  error: "flash-error",
};

/**
 * One feedback channel per message: a confirmation ("success") becomes a
 * toast and clears the query string that triggered it, so a reload doesn't
 * repeat it; anything else is a standing notice and stays as a banner.
 */
export function Flash({
  children,
  tone = "success",
}: {
  children: React.ReactNode;
  tone?: FlashTone;
}) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();
  const announced = useRef(false);
  const asToast = tone === "success";

  // The ref guards StrictMode's dev double-invoke so the toast fires once.
  useEffect(() => {
    if (!asToast || announced.current) return;
    announced.current = true;
    push(children, tone as ToastTone);
    if (pathname) router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (asToast || !open) return null;

  return (
    <div className={`flash ${TONE_CLASS[tone]}`} role="status" aria-live="polite">
      <div className="flash-body">{children}</div>
      <button
        type="button"
        aria-label="Fermer ce message"
        onClick={() => {
          setOpen(false);
          if (pathname) router.replace(pathname, { scroll: false });
        }}
      >
        ×
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Copy button — for the CLI snippets and the generated email bodies.
   -------------------------------------------------------------------------- */

export function CopyButton({
  value,
  label = "Copier",
  className = "small",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      className={className}
      data-success={copied ? "true" : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copié ✓" : label}</span>
    </button>
  );
}

/* --------------------------------------------------------------------------
   Theme toggle — paired with the no-flash script in the layout head. Dark is
   the product's native identity: absent a stored choice, only an explicit
   OS preference for light shows light — everything else defaults dark.
   -------------------------------------------------------------------------- */

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const applied = document.documentElement.dataset.theme;
    if (applied === "light" || applied === "dark") {
      setTheme(applied);
      return;
    }
    setTheme(window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("desk-theme", next);
    } catch {
      /* private mode — the choice simply does not persist */
    }
  }

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
      title={theme === "dark" ? "Thème clair" : "Thème sombre"}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}

/* --------------------------------------------------------------------------
   Select — Radix-backed, styled to match the native inputs, but never shows
   browser chrome. Submits through a plain server-action <form> exactly like
   a native <select> would, via a hidden input kept in sync with the value.
   -------------------------------------------------------------------------- */

const EMPTY_VALUE = "__none__";

export function Select({
  name,
  defaultValue = "",
  placeholder = "Choisir…",
  options,
  ariaLabel,
  onValueChange,
  compact = false,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
  ariaLabel?: string;
  onValueChange?: (value: string) => void;
  /** Shrinks the trigger to its content instead of filling the row — for a
   *  select that shares a line with a button (e.g. a status changer). */
  compact?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const selected = options.find((o) => o.value === value);

  return (
    <RadixSelect.Root
      value={value === "" ? EMPTY_VALUE : value}
      onValueChange={(v) => {
        const next = v === EMPTY_VALUE ? "" : v;
        setValue(next);
        onValueChange?.(next);
      }}
    >
      <input type="hidden" name={name} value={value} />
      <RadixSelect.Trigger
        className={`ctl-trigger${compact ? " compact" : ""}`}
        aria-label={ariaLabel}
      >
        <span className="ctl-trigger-value">
          {selected ? selected.label : <span className="placeholder">{placeholder}</span>}
        </span>
        <RadixSelect.Icon asChild>
          <IconChevronDown className="ctl-chevron" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="ctl-content" position="popper" sideOffset={6} align="start">
          <RadixSelect.Viewport className="ctl-viewport">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value || EMPTY_VALUE}
                value={o.value === "" ? EMPTY_VALUE : o.value}
                className="ctl-item"
              >
                <RadixSelect.ItemIndicator className="ctl-item-check">
                  <IconCheck />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/* --------------------------------------------------------------------------
   Switch — Radix-backed toggle, same hidden-input-for-forms trick as Select.
   -------------------------------------------------------------------------- */

export function Switch({
  name,
  id,
  defaultChecked = false,
  label,
  hint,
}: {
  name: string;
  id?: string;
  defaultChecked?: boolean;
  label: React.ReactNode;
  hint?: React.ReactNode;
}) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div className="switch-row">
      <div>
        <label className="switch-text" htmlFor={id} style={{ display: "block", cursor: "pointer" }}>
          {label}
        </label>
        {hint ? (
          <span className="field-hint" style={{ marginTop: "0.2rem" }}>
            {hint}
          </span>
        ) : null}
      </div>
      <RadixSwitch.Root
        id={id}
        className="switch-root"
        checked={checked}
        onCheckedChange={setChecked}
      >
        <RadixSwitch.Thumb className="switch-thumb" />
      </RadixSwitch.Root>
      <input type="hidden" name={name} value={checked ? "1" : ""} />
    </div>
  );
}

/* --------------------------------------------------------------------------
   Tooltip — wraps a single focusable child (icon buttons mainly).
   -------------------------------------------------------------------------- */

export function Tooltip({
  children,
  content,
  side = "bottom",
}: {
  children: React.ReactElement;
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <RadixTooltip.Root delayDuration={350}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tooltip-content" side={side} sideOffset={8}>
          {content}
          <RadixTooltip.Arrow className="tooltip-arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <RadixTooltip.Provider delayDuration={350}>{children}</RadixTooltip.Provider>;
}
