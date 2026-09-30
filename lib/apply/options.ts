// Picks the option of a dropdown / radio group / checkbox group that means the
// same thing as a value from the candidate profile. Cascade, first hit wins:
// exact → synonym → yes/no → containment → word overlap. The idea comes from
// JobMatchAI's deterministicMatcher, with one change that matters here: a tie is
// "no match", never "the first one". A wrong option on a form is worse than a
// field left for review.

import { norm, words } from "./text";

export type OptionMatch = { option: string; index: number; strategy: string };

// Punctuation-led placeholders ("-- No answer --", "— Select —") are matched without a word boundary:
// there is none between "--" and a space, which let "-- No answer --" pass as a real "No".
const PLACEHOLDER =
  /^(?:(?:select|please select|choose|choisir|s[eé]lectionner|select an option|none selected|no answer|aucune r[eé]ponse|faites un choix)\b|--+|—|–|\.\.\.)/i;

export function realOptions(options: string[]): Array<{ text: string; index: number }> {
  return options
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((o) => o.text && !PLACEHOLDER.test(o.text));
}

/** Groups of values that mean the same thing on a form. All entries are pre-normalized. */
const SYNONYMS: string[][] = [
  ["canada", "ca", "can", "canada ca"],
  ["quebec", "qc", "que", "province of quebec", "quebec qc"],
  ["montreal", "mtl", "montreal qc", "montreal quebec"],
  ["laval", "laval qc"],
  ["english", "anglais", "en"],
  ["french", "francais", "fr"],
  ["linkedin", "linked in", "linkedin com"],
  ["indeed", "indeed com"],
  [
    "company website",
    "company site",
    "careers page",
    "career site",
    "careers website",
    "company careers page",
    "site web de l'entreprise",
    "site de l'entreprise",
    "site carriere",
  ],
  ["job board", "online job board", "job posting site", "site d'emploi"],
];

function synonymsOf(value: string): string[] {
  const v = norm(value);
  const group = SYNONYMS.find((g) => g.includes(v));
  return group ? group : [v];
}

const YES_OPTION = /^(yes|oui|y|true)\b|^i (am|do|have|will|can|agree)\b(?! not)|^je (suis|peux|ai|vais)\b(?! pas)/;
const NO_OPTION = /^(no|non|n|false)\b|^i (am|do|have|will|can) not\b|^i don't\b|^i do not\b|^je ne\b/;

export function isYes(value: string): boolean {
  return /^(yes|oui|y|true|1)$/.test(norm(value));
}

export function isNo(value: string): boolean {
  return /^(no|non|n|false|0)$/.test(norm(value));
}

function unique<T>(hits: T[]): T | null {
  return hits.length === 1 ? hits[0] : null;
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return (` ${haystack} `).includes(` ${needle} `);
}

export function matchOption(value: string | null, options: string[]): OptionMatch | null {
  if (!value || !value.trim()) return null;
  const opts = realOptions(options);
  if (opts.length === 0) return null;
  const v = norm(value);
  const normed = opts.map((o) => ({ ...o, n: norm(o.text) }));
  const hit = (o: { text: string; index: number }, strategy: string): OptionMatch => ({
    option: o.text,
    index: o.index,
    strategy,
  });

  // 1. Exact.
  const exact = unique(normed.filter((o) => o.n === v));
  if (exact) return hit(exact, "exact");

  // 2. Synonym group (Québec ↔ QC, LinkedIn ↔ linkedin.com, Company website ↔ Careers page).
  const syn = synonymsOf(v);
  if (syn.length > 1) {
    const bySyn = unique(normed.filter((o) => syn.includes(o.n)));
    if (bySyn) return hit(bySyn, "synonym");
    const bySynPhrase = unique(normed.filter((o) => syn.some((s) => s.length >= 3 && containsPhrase(o.n, s))));
    if (bySynPhrase) return hit(bySynPhrase, "synonym-phrase");
  }

  // 3. Yes / No, including "Yes, I am legally…" / "No, I will not require…".
  if (isYes(v) || isNo(v)) {
    const want = isYes(v) ? YES_OPTION : NO_OPTION;
    const other = isYes(v) ? NO_OPTION : YES_OPTION;
    const yn = unique(normed.filter((o) => want.test(o.n) && !other.test(o.n)));
    return yn ? hit(yn, "yes-no") : null;
  }

  // 4. Containment, as whole words, and only when a single option qualifies.
  if (v.length >= 3) {
    const inOption = normed.filter((o) => containsPhrase(o.n, v));
    const one = unique(inOption);
    if (one) return hit(one, "option-contains-value");
    if (inOption.length === 0) {
      const inValue = unique(normed.filter((o) => o.n.length >= 3 && containsPhrase(v, o.n)));
      if (inValue) return hit(inValue, "value-contains-option");
    }
  }

  // 5. Word overlap (Jaccard), with a clear winner.
  const vw = new Set(words(v).filter((w) => w.length > 1));
  if (vw.size === 0) return null;
  const scored = normed
    .map((o) => {
      const ow = new Set(words(o.n).filter((w) => w.length > 1));
      const inter = [...vw].filter((w) => ow.has(w)).length;
      const union = new Set([...vw, ...ow]).size;
      return { o, score: union ? inter / union : 0 };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best && best.score >= 0.6 && (!second || best.score - second.score >= 0.15)) {
    return hit(best.o, "word-overlap");
  }
  return null;
}

/** A two- or three-choice question whose options are a yes and a no (also bilingual "Oui/Yes", "Non/No"). */
export function isYesNoOptionSet(options: string[]): boolean {
  const opts = realOptions(options).map((o) => o.text);
  return opts.length >= 2 && opts.length <= 3 && !!matchOption("yes", opts) && !!matchOption("no", opts);
}
