// Reads the questions off a live form. The scan runs inside the page: it finds
// every control a person could answer, resolves the question text the way a
// screen reader would (aria-labelledby, <label for>, wrapping label, fieldset
// legend, the question container), groups radios and checkboxes into one
// question, and stamps each control with data-desk-field so the fill step can
// find it again without re-guessing selectors. Choices drawn as a row of
// buttons (Ashby's Yes / No) are read as one radio question whose options are
// the buttons, not as the hidden checkbox behind them.

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
  // File inputs are usually hidden behind an "Attach" button: judge their container instead. Not when a whole section
  // around it is hidden, though: that is another page of a multi-step form, not a styled control.
  const containerShown = (el: Element): boolean => {
    // A file box whose own question (label + controls) is on screen counts even when a wrapper inside that question is
    // collapsed (JazzHR keeps its resume input in a display:none "upload" wrapper until "Attach" is pressed). A whole hidden
    // step of a wizard hides the question box itself, so it is still left out below.
    if ((el as HTMLInputElement).type === "file") {
      const box = el.closest(".form-group, .field, fieldset, li, [class*='field-'], [class*='-field']");
      if (box && isShown(box) && box.contains(el)) {
        let hiddenAbove = false;
        for (let up: Element | null = box.parentElement; up && up !== document.body; up = up.parentElement) {
          const s = getComputedStyle(up);
          if (s.display === "none" || s.visibility === "hidden") hiddenAbove = true;
        }
        if (!hiddenAbove) return true;
      }
    }
    for (let up: Element | null = el.parentElement; up && up !== document.body; up = up.parentElement) {
      const s = getComputedStyle(up);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    let node: Element | null = el.parentElement;
    for (let i = 0; node && i < 4; i++, node = node.parentElement) if (isShown(node)) return true;
    // A file box drawn as a zero-size input behind a custom "Attach" control (JazzHR's resume field): nothing around it is
    // hidden, so it is part of the page on screen, whatever its size.
    return (el as HTMLInputElement).type === "file";
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

  // A wizard keeps earlier steps in the page, hidden: their old stamps would collide with this read's indices.
  for (const old of Array.from(document.querySelectorAll("[data-desk-field]"))) {
    old.removeAttribute("data-desk-field");
    old.removeAttribute("data-desk-option");
  }

  const out: RawField[] = [];
  let index = 0;
  const done = new Set<Element>();
  const groups = new Map<string, HTMLInputElement[]>();

  // Choices drawn as buttons: a container whose own children are 2 to 8 toggle buttons (aria-pressed, data-option, or a
  // yes/no class), usually with a hidden input holding the answer. One radio question; the buttons are its options.
  const isToggle = (b: Element) =>
    b.tagName === "BUTTON" && (b.hasAttribute("aria-pressed") || b.hasAttribute("data-option") || /yesno|option|toggle/i.test(b.className?.toString() ?? ""));
  for (const box of Array.from(root.querySelectorAll("div, fieldset, [role='radiogroup']"))) {
    const buttons = Array.from(box.children).filter(isToggle) as HTMLElement[];
    if (buttons.length < 2 || buttons.length > 8 || !buttons.every((b) => isShown(b))) continue;
    if (!buttons.some((b) => b.hasAttribute("aria-pressed")) && !/yesno|choice|toggle|option/i.test(box.className?.toString() ?? "")) continue;
    const optionLabels = buttons.map((b) => textOf(b));
    if (optionLabels.some((t) => !t || t.length > 60)) continue;
    const question = questionText(box, optionLabels);
    if (!question) continue;
    for (const hidden of Array.from(box.querySelectorAll("input"))) done.add(hidden);
    buttons.forEach((b, i) => {
      b.setAttribute("data-desk-field", String(index));
      b.setAttribute("data-desk-option", String(i));
    });
    out.push({
      index,
      label: question,
      kind: "radio",
      required: isRequired(box, question),
      options: optionLabels,
      name: box.querySelector("input")?.getAttribute("name") ?? null,
      placeholder: null,
      maxLength: null,
      rows: null,
      hint: hintOf(box),
      accept: null,
    });
    index++;
  }

  // "Select all that apply" lists often give each box its own name: boxes inside one question container are one question.
  const STRICT_QUESTION = "[class*='fieldEntry'], [class*='field-entry'], fieldset, [role='group']";
  const questionBoxes = new Map<Element, number>();
  const checkboxKey = (el: HTMLInputElement, name: string | null): string => {
    const box = el.closest(STRICT_QUESTION);
    if (box && box.querySelectorAll("input[type='checkbox']").length >= 2) {
      if (!questionBoxes.has(box)) questionBoxes.set(box, questionBoxes.size);
      return `checkbox:box:${questionBoxes.get(box)}`;
    }
    return name ? `checkbox:${name}` : `checkbox:${index}:${Math.random()}`;
  };

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
      const key =
        type === "checkbox" ? checkboxKey(el as HTMLInputElement, name) : name ? `${type}:${name}` : `${type}:${index}:${Math.random()}`;
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
    // A text box behind a calendar widget (Ashby's react-datepicker "Pick date...") takes a date, not prose.
    else if (type === "date" || el.closest(".react-datepicker__input-container, .react-datepicker-wrapper") || /\b(datepicker|input-date)\b/i.test(el.className?.toString() ?? ""))
      kind = "date";
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

  // In the order a person reads the page, whichever pass found each question.
  const firstOf = (i: number) => document.querySelector(`[data-desk-field="${i}"]`);
  out.sort((a, b) => {
    const ea = firstOf(a.index);
    const eb = firstOf(b.index);
    if (!ea || !eb || ea === eb) return 0;
    return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
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
