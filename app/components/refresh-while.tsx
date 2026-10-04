"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refreshes the page every few seconds while background work it started is still going (a form being read in its own
 * process), and stops once `done` comes back true or `maxMs` after `since` has passed.
 */
export function RefreshWhile({ done, since, everyMs = 4000, maxMs = 5 * 60_000 }: { done: boolean; since: number; everyMs?: number; maxMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (done || !Number.isFinite(since)) return;
    const t = setInterval(() => {
      if (Date.now() - since > maxMs) clearInterval(t);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [done, since, everyMs, maxMs, router]);
  return null;
}
