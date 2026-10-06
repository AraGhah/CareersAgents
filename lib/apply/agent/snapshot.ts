// What the AI form agent sees of the page: every visible control a person could use, numbered, with the question it
// belongs to, what it holds now and the choices it offers, plus the page's headings, step and error messages. Each
// control is stamped data-desk-agent=<n>; the numbers are valid for this snapshot only.

import type { Page } from "playwright";
import { ensureEvalShim } from "../browser/shim";
import { visibleFormErrors } from "../browser/guards";

export type AgentElement = {
  id: number;
  /** text, email, tel, textarea, select, combobox, radio, checkbox, button, link, file, option, ... */
  kind: string;
  label: string;
  value: string;
  required: boolean;
  checked?: boolean;
  disabled?: boolean;
  options?: string[];
};

export type Snapshot = { url: string; title: string; headings: string[]; step: string | null; errors: string[]; elements: AgentElement[]; text: string };

const MAX_ELEMENTS = 180;

/** Runs in the browser: self-contained, no closures over Node values. */
function scan(max: number): Omit<Snapshot, "errors"> {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const textOf = (el: Element | null | undefined) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const shown = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (h.closest("[aria-hidden='true']")) return false;
    const s = getComputedStyle(h);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const containerShown = (el: Element): boolean => {
    let node: Element | null = el.parentElement;
    for (let i = 0; node && i < 4; i++, node = node.parentElement) if (shown(node)) return true;
    return false;
  };
  const byIds = (ids: string | null) =>
    clean(
      (ids ?? "")
        .split(/\s+/)
        .map((id) => (id ? textOf(document.getElementById(id)) : ""))
        .join(" "),
    );
  const ownLabel = (el: Element): string => {
    const a = byIds(el.getAttribute("aria-labelledby"));
    if (a) return a;
    const id = el.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab && textOf(lab)) return textOf(lab);
    }
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return textOf(wrap);
    return clean(el.getAttribute("aria-label")) || clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title"));
  };
  const BOX = "fieldset, [role='group'], [role='radiogroup'], [data-automation-id*='formField'], [class*='field'], [class*='Field'], [class*='question'], .form-group, li";
  const question = (el: Element, own: string): string => {
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend && textOf(legend)) return textOf(legend);
    const group = el.closest("[role='radiogroup'], [role='group']");
    const gl = group ? byIds(group.getAttribute("aria-labelledby")) || clean(group.getAttribute("aria-label")) : "";
    if (gl) return gl;
    const box = el.closest(BOX);
    if (!box) return "";
    const lab = Array.from(box.querySelectorAll("label, legend, [class*='label'], [data-automation-id*='Label'], h3, h4, p"))
      .map((n) => textOf(n))
      .find((t) => t && t.length > 1 && t.length < 300 && t !== own);
    return lab ?? "";
  };
  const required = (el: Element, label: string): boolean =>
    (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(label);

  for (const old of Array.from(document.querySelectorAll("[data-desk-agent]"))) old.removeAttribute("data-desk-agent");

  const ACTION_LINK = /apply|postuler|next|continue|suivant|add|ajouter|manual|manuel|sign in|connexion|create account|cr[ée]er|upload|attach|joindre|review|v[ée]rifier|save|enregistrer|back|pr[ée]c[ée]dent|edit|modifier/i;
  const candidates = Array.from(
    document.querySelectorAll(
      "input, textarea, select, button, [role='button'], [role='combobox'], [role='listbox'], [role='option'], [role='checkbox'], [role='radio'], [role='switch'], [contenteditable='true'], a[href], [data-automation-id='promptOption']",
    ),
  );
  const out: Snapshot["elements"] = [];
  const seen = new Set<Element>();
  let n = 0;
  for (const el of candidates) {
    if (out.length >= max) break;
    if (seen.has(el)) continue;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const role = el.getAttribute("role") ?? "";
    if (tag === "input" && ["hidden", "image", "reset"].includes(type)) continue;
    if (el.closest("[class*='captcha'], [id*='captcha']")) continue;
    const isFile = tag === "input" && type === "file";
    if (!(isFile ? containerShown(el) : shown(el))) continue;
    // A button inside a button-like wrapper is the same control twice.
    if ((tag === "button" || role === "button") && el.parentElement?.closest("button, [role='button']")) continue;

    let kind = role || tag;
    if (tag === "input") kind = type || "text";
    if (tag === "a") kind = "link";
    if (tag === "select") kind = "select";
    if (tag === "textarea") kind = "textarea";
    if (role === "combobox" || el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("aria-autocomplete")) kind = "combobox";
    if (el.getAttribute("data-automation-id") === "promptOption") kind = "option";

    let label = ownLabel(el);
    let text = "";
    if (["button", "link", "option"].includes(kind) || role === "button") text = textOf(el).slice(0, 120);
    if (kind === "link" && !ACTION_LINK.test(text)) continue;
    if (!label) label = text;
    if (["radio", "checkbox", "switch"].includes(kind)) {
      const q = question(el, label);
      if (q && q !== label) label = `${q} › ${label}`;
    } else if (!["button", "link", "option"].includes(kind)) {
      const q = question(el, label);
      if (q && q !== label && !label) label = q;
      else if (q && q !== label && label.length < 40) label = `${q} › ${label}`;
    }
    if (!label && !text) continue;

    let value = "";
    let checked: boolean | undefined;
    if (tag === "input" && type === "password") value = "(password field: never filled by you)";
    else if (isFile) value = Array.from((el as HTMLInputElement).files ?? []).map((f) => f.name).join(", ");
    else if (tag === "input" && (type === "checkbox" || type === "radio")) checked = (el as HTMLInputElement).checked;
    else if (["checkbox", "radio", "switch"].includes(role)) checked = el.getAttribute("aria-checked") === "true";
    else if (tag === "input" || tag === "textarea") value = clean((el as HTMLInputElement).value).slice(0, 200);
    else if (tag === "select") value = clean((el as HTMLSelectElement).selectedOptions[0]?.text);
    else if (kind === "combobox") value = clean((el as HTMLInputElement).value || textOf(el)).slice(0, 120);
    if (el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true") checked = true;

    const options = tag === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => clean(o.text)).filter(Boolean).slice(0, 40) : undefined;
    el.setAttribute("data-desk-agent", String(n));
    out.push({
      id: n,
      kind,
      label: label.slice(0, 200),
      value,
      required: required(el, label),
      ...(checked !== undefined ? { checked } : {}),
      ...((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true" ? { disabled: true } : {}),
      ...(options ? { options } : {}),
    });
    n++;
  }

  const headings = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
    .filter(shown)
    .map((h) => textOf(h))
    .filter((t) => t && t.length < 160)
    .slice(0, 8);
  const active = document.querySelector("[data-automation-id='progressBarActiveStep']");
  const printed = (document.body?.innerText || "").match(/(?:step|[ée]tape|page)\s*\d+\s*(?:of|sur|de|\/)\s*\d+/i)?.[0] ?? null;
  return {
    url: location.href,
    title: document.title,
    headings,
    step: (active ? textOf(active) : null) || printed,
    elements: out,
    text: clean(document.body?.innerText ?? "").slice(0, 1500),
  };
}

export async function takeSnapshot(page: Page): Promise<Snapshot> {
  await ensureEvalShim(page);
  const base = await page.evaluate(scan, MAX_ELEMENTS);
  // Screen-reader announcements share the error regions' markup ("… page is loaded", "Loading"): they are not errors.
  const errors = (await visibleFormErrors(page).catch(() => [] as string[])).filter((e) => !/\b(page is loaded|is loading|loading|chargement)\b/i.test(e));
  return { ...base, errors };
}

/** The snapshot as the model reads it: one line per control. */
export function renderSnapshot(s: Snapshot): string {
  const lines = [
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    s.step ? `Step: ${s.step}` : null,
    s.headings.length ? `Headings: ${s.headings.join(" | ")}` : null,
    s.errors.length ? `ERRORS SHOWN: ${s.errors.join(" | ")}` : null,
    "Controls ([id] kind \"label\" = value):",
    ...s.elements.map((e) => {
      const flags = [e.required ? "required" : "", e.disabled ? "disabled" : "", e.checked === true ? "checked" : e.checked === false ? "unchecked" : ""].filter(Boolean).join(",");
      const opts = e.options?.length ? ` options: ${e.options.join(" | ")}` : "";
      const value = e.value ? ` = "${e.value}"` : "";
      return `[${e.id}] ${e.kind} "${e.label}"${value}${flags ? ` (${flags})` : ""}${opts}`;
    }),
    `Page text (start): ${s.text}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}
