// Writes one decided value into the live form and reads it back. Playwright
// drives real input events (typing, clicking, choosing), which React/Vue forms
// handle the same way they handle a person, so no synthetic event dispatch is
// needed. Every write is verified by reading the control's state afterwards; a
// value that does not read back is a failed field, not a filled one.

import path from "node:path";
import type { Locator, Page } from "playwright";
import { matchOption } from "../options";
import { norm } from "../text";
import type { FieldDecision, FormField } from "../types";
import { ensureEvalShim } from "./shim";
import { safeDeskPath } from "../../safe-path";

export type FillResult = { ok: boolean; detail: string; readBack: string | null };

const loc = (page: Page, field: FormField, option?: number): Locator =>
  page.locator(
    option === undefined ? `[data-desk-field="${field.index}"]` : `[data-desk-field="${field.index}"][data-desk-option="${option}"]`,
  );

async function mark(target: Locator, color: string) {
  await target
    .first()
    .evaluate((el, c) => {
      const h = (el.closest("label") ?? el) as HTMLElement;
      h.style.outline = `3px solid ${c}`;
      h.style.outlineOffset = "2px";
    }, color)
    .catch(() => undefined);
}

export const COLORS = { filled: "#27ae60", review: "#f1c40f", manual: "#c0392b", skipped: "#95a5a6" } as const;

async function fillText(page: Page, field: FormField, value: string): Promise<FillResult> {
  const el = loc(page, field).first();
  await el.scrollIntoViewIfNeeded().catch(() => undefined);
  await el.fill(value);
  await el.blur().catch(() => undefined);
  const back = await el.inputValue();
  const ok = back === value || back.replace(/\s+/g, " ").trim() === value.replace(/\s+/g, " ").trim();
  return { ok, detail: ok ? "typed and read back" : `read back "${back.slice(0, 60)}"`, readBack: back };
}

async function fillSelect(page: Page, field: FormField, value: string): Promise<FillResult> {
  const el = loc(page, field).first();
  const m = matchOption(value, field.options);
  if (!m) return { ok: false, detail: `no option matches "${value}"`, readBack: null };
  await el.selectOption({ index: m.index });
  const back = await el.evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.text.trim() ?? "");
  return { ok: back === m.option, detail: `selected "${back}"`, readBack: back };
}

async function fillCombobox(page: Page, field: FormField, value: string): Promise<FillResult> {
  const el = loc(page, field).first();
  await el.scrollIntoViewIfNeeded().catch(() => undefined);
  await el.click();
  // Type the most distinctive part (the city for "Montréal, Québec, Canada") so async search lists load it.
  const query = value.split(",")[0].trim();
  if (await el.evaluate((n) => n.tagName === "INPUT")) await el.fill(query);
  else await page.keyboard.type(query, { delay: 20 });
  const listbox = page.locator("[role='option']:visible");
  await listbox.first().waitFor({ timeout: 5000 }).catch(() => undefined);
  const texts = (await listbox.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const m = matchOption(value, texts) ?? matchOption(query, texts);
  if (!m) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return { ok: false, detail: `no listed option matches "${value}" (${texts.slice(0, 5).join(" | ") || "no options"})`, readBack: null };
  }
  await listbox.nth(m.index).click();
  await page.waitForTimeout(250);
  // react-select shows the choice in a sibling container, native-ish comboboxes keep it in the input.
  const back = await el.evaluate((n) => {
    const box = n.closest("[class*='container'], [class*='select'], [class*='combobox']") ?? n.parentElement;
    return ((n as HTMLInputElement).value || (box as HTMLElement | null)?.innerText || "").replace(/\s+/g, " ").trim();
  });
  const ok = norm(back).includes(norm(m.option)) || norm(m.option).includes(norm(back) || "\u0000");
  return { ok, detail: `chose "${m.option}"`, readBack: back };
}

async function fillChoice(page: Page, field: FormField, value: string): Promise<FillResult> {
  const wanted = field.kind === "checkbox-group" ? value.split("|") : [value];
  const picked: string[] = [];
  for (const w of wanted) {
    const m = matchOption(w, field.options);
    if (!m) return { ok: false, detail: `no option matches "${w}"`, readBack: null };
    const input = loc(page, field, m.index).first();
    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    // A choice drawn as buttons (Ashby's Yes / No) is pressed; a real radio or box is checked.
    if (await input.evaluate((n) => n.tagName === "BUTTON")) await input.click();
    else await input.check({ force: true });
    picked.push(m.option);
  }
  await page.waitForTimeout(150);
  const back = await page
    .locator(`[data-desk-field="${field.index}"]`)
    .evaluateAll((els) =>
      els
        .filter((e) =>
          e.tagName === "BUTTON"
            ? e.getAttribute("aria-pressed") === "true" || e.getAttribute("aria-checked") === "true" || /\b(selected|active|checked|pressed)\b/i.test(e.className.toString())
            : (e as HTMLInputElement).checked,
        )
        .map((e) => Number(e.getAttribute("data-desk-option") ?? -1))
        .filter((i) => i >= 0),
    );
  const backLabels = back.map((i) => field.options[i]);
  const ok = picked.every((p) => backLabels.includes(p));
  return { ok, detail: `checked ${picked.join(", ")}`, readBack: backLabels.join("|") };
}

async function fillCheckbox(page: Page, field: FormField, value: string): Promise<FillResult> {
  const el = loc(page, field).first();
  const want = /^(yes|oui|true|1|checked)$/i.test(value.trim()) || value === field.options[0];
  if (want) await el.check({ force: true });
  else await el.uncheck({ force: true });
  const back = await el.isChecked();
  return { ok: back === want, detail: back ? "checked" : "unchecked", readBack: back ? "checked" : "unchecked" };
}

async function fillFile(page: Page, field: FormField, value: string): Promise<FillResult> {
  // Only a CV or letter the desk stored (resumes/, applications/) is ever uploaded to an employer, whatever the plan says.
  const filePath = safeDeskPath(value);
  if (!filePath) return { ok: false, detail: "refused: the file is not one the desk stored (resumes/ or applications/)", readBack: "" };
  const el = loc(page, field).first();
  await el.setInputFiles(filePath);
  await page.waitForTimeout(500);
  const back = await el.evaluate((n) => (n as HTMLInputElement).files?.[0]?.name ?? "");
  const expected = path.basename(filePath);
  // Some ATSs upload immediately and clear the input, showing the name next to it instead.
  const shown = back
    ? back
    : await el.evaluate((n) => (n.closest("[class*='field'], [class*='upload'], [class*='attach'], div") as HTMLElement | null)?.innerText ?? "");
  const ok = back === expected || shown.includes(expected);
  return { ok, detail: ok ? `attached ${expected}` : `could not confirm ${expected} is attached`, readBack: back || shown.slice(0, 120) };
}

export async function fillField(page: Page, field: FormField, decision: FieldDecision): Promise<FillResult> {
  const value = decision.value;
  if (!value) return { ok: false, detail: "no value", readBack: null };
  await ensureEvalShim(page);
  try {
    let result: FillResult;
    switch (field.kind) {
      case "file":
        result = await fillFile(page, field, value);
        break;
      case "select":
        result = await fillSelect(page, field, value);
        break;
      case "combobox":
        result = await fillCombobox(page, field, value);
        break;
      case "radio":
      case "checkbox-group":
        result = await fillChoice(page, field, value);
        break;
      case "checkbox":
        result = await fillCheckbox(page, field, value);
        break;
      default:
        result = await fillText(page, field, value);
    }
    await mark(loc(page, field), result.ok ? (decision.source === "generated" ? COLORS.review : COLORS.filled) : COLORS.manual);
    return result;
  } catch (err) {
    await mark(loc(page, field), COLORS.manual);
    return { ok: false, detail: err instanceof Error ? err.message.split("\n")[0] : String(err), readBack: null };
  }
}

export async function markField(page: Page, field: FormField, color: string) {
  await mark(loc(page, field), color);
}

/** True when the control holds something a person (or the form) already typed. */
export async function currentValue(page: Page, field: FormField): Promise<string> {
  return loc(page, field)
    .evaluateAll((els) =>
      els
        .map((e) => {
          const i = e as HTMLInputElement;
          if (e.tagName === "BUTTON") {
            const on = e.getAttribute("aria-pressed") === "true" || e.getAttribute("aria-checked") === "true" || /\b(selected|active|checked|pressed)\b/i.test(e.className.toString());
            return on ? (e as HTMLElement).innerText.trim() || "checked" : "";
          }
          if (i.type === "checkbox" || i.type === "radio") return i.checked ? "checked" : "";
          if (i.type === "file") return i.files?.[0]?.name ?? "";
          if (e.tagName === "SELECT") {
            const s = e as HTMLSelectElement;
            return s.selectedIndex > 0 ? s.selectedOptions[0]?.text ?? "" : "";
          }
          return i.value ?? (e as HTMLElement).innerText ?? "";
        })
        .filter(Boolean)
        .join("|"),
    )
    .catch(() => "");
}
