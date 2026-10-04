// Answers you gave on one form, reused on the next (the idea behind AIHawk's answers.json). A question the desk could
// not answer from your data ("What is your notice period?", "How did you hear about us?", "Are you able to work
// on-site 3 days a week?") stops a run once; the answer you approve is remembered under the question's wording with the
// company's name taken out, and the next form that asks the same thing gets it without a stop.
//
// Never remembered: personal and legal questions (work authorization, self-identification, pay, consent: those are
// lib/apply/personal.ts's, confirmed on the Answers page), written answers (writing samples, lib/apply/answers/style.ts),
// and files. A remembered value is used only when it fits the new form: one of its own options, or a text field.

import { PERSON_ONLY_INTENTS } from "./classify";
import { matchOption, realOptions } from "./options";
import { cleanLabel, norm } from "./text";
import type { FieldIntent, FieldKind, FormField } from "./types";

export type RememberedAnswer = {
  key: string;
  question: string;
  intent: string;
  kind: string;
  value: string;
  updatedAt: Date;
};

const NOT_REMEMBERED = new Set<FieldIntent>([
  ...PERSON_ONLY_INTENTS,
  "open_question",
  "resume",
  "cover_letter_file",
  "cover_letter_text",
  "transcript",
  "other_file",
]);

/** May an answer to this kind of question be remembered and reused? */
export function rememberable(intent: FieldIntent, kind: FieldKind): boolean {
  return kind !== "file" && !NOT_REMEMBERED.has(intent);
}

const LEGAL_SUFFIX = /\b(inc|ltd|ltee|llc|corp|corporation|co|group|groupe|canada|technologies|technology)\b/g;

/** The question as a key: lowercase, accents and punctuation out, the company's name replaced by "{company}". */
export function memoryKey(label: string, companyName: string): string {
  let key = norm(cleanLabel(label));
  const company = norm(companyName).replace(/[^a-z0-9 ]+/g, " ").replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
  if (company.length >= 3) key = key.split(company).join("{company}");
  return key.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** The remembered answer written for this form: its own option(s), a tick, or the text itself. Null when it fits nothing. */
export function applyMemory(field: FormField, remembered: RememberedAnswer): string | null {
  const value = remembered.value.trim();
  if (!value) return null;
  if (field.kind === "checkbox") return /^(yes|oui|true|checked|on)$/i.test(value) ? "Yes" : /^(no|non|false|unchecked|off)$/i.test(value) ? "No" : null;
  if (field.kind === "checkbox-group") {
    const parts = value.split("|").map((p) => matchOption(p, field.options)?.option ?? null);
    return parts.length && parts.every(Boolean) ? parts.join("|") : null;
  }
  if (realOptions(field.options).length > 0) return matchOption(value, field.options)?.option ?? null;
  if (["select", "radio", "combobox"].includes(field.kind)) return null;
  // A remembered choice is not pasted into a text box, nor a long text into a short one.
  if (field.maxLength && value.length > field.maxLength) return null;
  return value;
}
