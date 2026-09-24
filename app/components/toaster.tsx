"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastTone = "success" | "info" | "warn" | "error";

type ToastRecord = {
  id: number;
  tone: ToastTone;
  message: React.ReactNode;
  leaving: boolean;
};

type ToastContextValue = {
  push: (message: React.ReactNode, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Fire a toast from any client component under <ToastProvider>. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const TONE_CLASS: Record<ToastTone, string> = {
  success: "",
  info: "info",
  warn: "warn",
  error: "error",
};

const LIFETIME_MS = 5000;
const EXIT_MS = 220;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const exitTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, EXIT_MS);
    timers.current.set(id, exitTimer);
  }, []);

  const push = useCallback(
    (message: React.ReactNode, tone: ToastTone = "success") => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, tone, message, leaving: false }]);
      const timer = setTimeout(() => dismiss(id), LIFETIME_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${TONE_CLASS[t.tone]}`.trim()}
            data-leaving={t.leaving ? "true" : undefined}
            role="status"
          >
            <div className="toast-body">{t.message}</div>
            <button
              type="button"
              className="toast-close"
              aria-label="Fermer cette notification"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
