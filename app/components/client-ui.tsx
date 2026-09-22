"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

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
   Flash — a dismissible result banner that also clears its own query string,
   so a refresh does not replay a stale "done" message.
   -------------------------------------------------------------------------- */

export type FlashTone = "success" | "info" | "warn" | "error";

const TONE_CLASS: Record<FlashTone, string> = {
  success: "",
  info: "flash-info",
  warn: "flash-warn",
  error: "flash-error",
};

const TONE_MARK: Record<FlashTone, string> = {
  success: "✓",
  info: "→",
  warn: "!",
  error: "×",
};

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

  if (!open) return null;

  return (
    <div className={`flash ${TONE_CLASS[tone]}`} role="status" aria-live="polite">
      <span aria-hidden="true" className="mono">
        {TONE_MARK[tone]}
      </span>
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
   Theme toggle — paired with the no-flash script in the layout head.
   -------------------------------------------------------------------------- */

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Reads the choice the inline layout script already applied to <html>, so
  // this button starts in sync with the paint the visitor actually saw. This
  // is browser-only state (DOM attribute set pre-hydration, or matchMedia)
  // that cannot be derived during render, so the effect — and its setState —
  // is the correct tool here, not a workaround.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const applied = document.documentElement.dataset.theme;
    if (applied === "light" || applied === "dark") {
      setTheme(applied);
      return;
    }
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
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
      className="ghost small"
      onClick={toggle}
      aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
      title={theme === "dark" ? "Thème clair" : "Thème sombre"}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
