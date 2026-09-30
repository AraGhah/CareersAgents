import type { Page } from "playwright";

/**
 * tsx/esbuild compiles with keepNames, which wraps named inner functions in a
 * `__name(fn, "name")` helper. Functions handed to page.evaluate run in the
 * browser, where that helper does not exist. Defining a no-op there first (as a
 * string, so it is not transformed itself) keeps the in-page scans working.
 */
export async function ensureEvalShim(page: Page): Promise<void> {
  await page.evaluate("globalThis.__name = globalThis.__name || ((f) => f)");
}
