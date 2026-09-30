// Reads the questions off a live form. The scan runs inside the page: it finds
// every control a person could answer, resolves the question text the way a
// screen reader would (aria-labelledby, <label for>, wrapping label, fieldset
// legend, the question container), groups radios and checkboxes into one
// question, and stamps each control with data-desk-field so the fill step can
// find it again without re-guessing selectors.

import type { Page } from "playwright";
import { cleanLabel, fieldSignature } from "../text";
import { ensureEvalShim } from "./shim";
import type { FieldKind, FormField } from "../types";

type RawField = Omit<FormField, "signature" | "label"> & { label: string };

/** Runs in the browser. Must stay self-contained: no imports, no closures over Node values. */
function scanForm(scopeSelector: string | null): RawField[] {
  const root: Element = (scopeSelector && document.querySelector(scopeSelector)) || document.body;
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const textOf = (el: Element | null | undefined) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const SKIP_NAME = /csrf|authenticity|_token\b|^token$|utm_|honeypot|g-recaptcha-response|h-captcha-response|cf-turnstile-response|__RequestVerification/i;

  const isShown = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (h.closest("[aria-hidden='true']")) return false;
    const style = getComputedStyle(h);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // File inputs are usually hidden behind an "Attach" button: judge their container instead.
  const containerShown = (el: Element): boolean => {
    let node: Element | null = el.parentElement;
    for (let i = 0; node && i < 4; i++, node = node.parentElement) if (isShown(node)) return true;
    return false;
  };

  const QUESTION_BOX =
    ".field, .form-field, .form-group, .application-question, .question, [class*='question'], [class*='Field'], [class*='field'], li, fieldset, [role='group'], [role='radiogroup']";

  const byIds = (ids: string | null) =>
    clean(
      (ids ?? "")
        .split(/\s+/)
        .map((id) => (id ? textOf(document.getElementById(id)) : ""))
        .join(" "),
    );

  const ownLabel = (el: Element): string => {
    const labelled = byIds(el.getAttribute("aria-labelledby"));
    if (labelled) return labelled;
    const id = el.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab && textOf(lab)) return textOf(lab);
    }
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return textOf(wrap);
    return clean(el.getAttribute("aria-label"));
  };

  const questionText = (el: Element, exclude: string[]): string => {
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend && textOf(legend)) return textOf(legend);
    const group = el.closest("[role='radiogroup'], [role='group']");
    const gl = group ? byIds(group.getAttribute("aria-labelledby")) || clean(group.getAttribute("aria-label")) : "";
    if (gl) return gl;
    const box = el.closest(QUESTION_BOX);
    if (box) {
      const lab = Array.from(box.querySelectorAll("label, .label, [class*='label'], .application-label, h3, h4, p, span"))
        .map((n) => textOf(n))
        .find((t) => t && t.length > 1 && !exclude.includes(t));
      if (lab) return lab;
    }
    return "";
  };

  const hintOf = (el: Element): string | null => {
    const described = byIds(el.getAttribute("aria-describedby"));
    if (described) return described.slice(0, 240);
    const box = el.closest(QUESTION_BOX);
    const help = box?.querySelector(".help, .hint, .description, [class*='help'], [class*='hint'], [class*='description'], small");
    const t = textOf(help);
    return t ? t.slice(0, 240) : null;
  };

  const isRequired = (el: Element, label: string): boolean => {
    const h = el as HTMLInputElement;
    if (h.required || el.getAttribute("aria-required") === "true") return true;
    if (/\*\s*$|\*\s*\(|\(required\)|\(obligatoire\)/i.test(label)) return true;
    const box = el.closest(QUESTION_BOX);
    return !!box && (/\brequired\b/.test(box.className?.toString() ?? "") || !!box.querySelector(".required, .asterisk, [class*='required']"));
  };

  const out: RawField[] = [];
  let index = 0;
  const done = new Set<Element>();
  const groups = new Map<string, HTMLInputElement[]>();

  const controls = Array.from(
    root.querySelectorAll("input, textarea, select, [role='combobox']:not(input)"),
  ) as HTMLElement[];

  for (const el of controls) {
    if (done.has(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? (tag === "input" ? "text" : tag)).toLowerCase();
    const name = el.getAttribute("name");
    if (["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;
    if (name && SKIP_NAME.test(name)) continue;
    if (el.closest("[class*='captcha'], [id*='captcha']")) continue;
    if ((el as HTMLInputElement).disabled || el.getAttribute("readonly") !== null) continue;

    if (type === "radio" || type === "checkbox") {
      const key = name ? `${type}:${name}` : `${type}:${index}:${Math.random()}`;
      const list = groups.get(key) ?? [];
      list.push(el as HTMLInputElement);
      groups.set(key, list);
      done.add(el);
      continue;
    }

    const visible = type === "file" ? containerShown(el) : isShown(el);
    if (!visible) continue;

    let kind: FieldKind = "text";
    const role = el.getAttribute("role");
    if (type === "file") kind = "file";
    else if (tag === "textarea") kind = "textarea";
    else if (tag === "select") kind = "select";
    else if (role === "combobox" || el.getAttribute("aria-autocomplete") || /react-select/.test(el.id)) kind = "combobox";
    else if (type === "email") kind = "email";
    else if (type === "tel") kind = "tel";
    else if (type === "url") kind = "url";
    else if (type === "number") kind = "number";
    else if (type === "date") kind = "date";
    else if (type === "month") kind = "month";

    const label = ownLabel(el) || questionText(el, []) || clean(el.getAttribute("placeholder")) || clean(name);
    el.setAttribute("data-desk-field", String(index));
    done.add(el);
    out.push({
      index,
      label,
      kind,
      required: isRequired(el, label),
      options: tag === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => clean(o.text)) : [],
      name,
      placeholder: clean(el.getAttribute("placeholder")) || null,
      maxLength: (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : null,
      rows: tag === "textarea" ? (el as HTMLTextAreaElement).rows || null : null,
      hint: hintOf(el),
      accept: el.getAttribute("accept"),
    });
    index++;
  }

  for (const [key, inputs] of groups) {
    const shown = inputs.filter((i) => isShown(i) || containerShown(i));
    if (shown.length === 0) continue;
    const type = key.split(":")[0];
    const optionLabels = shown.map((i) => ownLabel(i) || clean(i.value));
    const question = questionText(shown[0], optionLabels);
    const single = type === "checkbox" && shown.length === 1;
    const kind: FieldKind = type === "radio" ? "radio" : single ? "checkbox" : "checkbox-group";
    const label = single ? question && question !== optionLabels[0] ? `${question} ${optionLabels[0]}` : optionLabels[0] : question || optionLabels.join(" / ");
    shown.forEach((input, i) => {
      input.setAttribute("data-desk-field", String(index));
      input.setAttribute("data-desk-option", String(i));
    });
    out.push({
      index,
      label,
      kind,
      required: shown.some((i) => isRequired(i, question || label)),
      options: optionLabels,
      name: shown[0].getAttribute("name"),
      placeholder: null,
      maxLength: null,
      rows: null,
      hint: hintOf(shown[0]),
      accept: null,
    });
    index++;
  }

  return out;
}

export async function extractFields(page: Page, scopeSelector: string | null = null): Promise<FormField[]> {
  await ensureEvalShim(page);
  const raw = await page.evaluate(scanForm, scopeSelector);
  const seen = new Map<string, number>();
  return raw.map((f) => {
    const label = cleanLabel(f.label);
    let signature = fieldSignature(label, f.kind, f.name);
    const n = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, n);
    if (n > 1) signature = `${signature}#${n}`;
    return { ...f, label: label || f.name || `field ${f.index}`, signature };
  });
}

/** Comboboxes load their options on open: open, read, close. Nothing is selected. */
export async function readComboboxOptions(page: Page, field: FormField): Promise<string[]> {
  const control = page.locator(`[data-desk-field="${field.index}"]`).first();
  try {
    await control.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    const options = await page.locator("[role='option']:visible").allInnerTexts();
    await page.keyboard.press("Escape");
    return options.map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 300);
  } catch {
    return [];
  }
}

/**
 * The fields plus the options of every custom dropdown, which only exist in the DOM
 * once it is opened (idea from ApplyAI: open every dropdown before deciding anything).
 */
export async function extractFieldsWithOptions(page: Page, scopeSelector: string | null = null): Promise<FormField[]> {
  const fields = await extractFields(page, scopeSelector);
  for (const f of fields) {
    if (f.kind === "combobox" && f.options.length === 0) f.options = await readComboboxOptions(page, f);
  }
  return fields;
}
