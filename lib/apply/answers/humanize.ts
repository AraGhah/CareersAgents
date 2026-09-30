// Mechanical checks that a written answer reads like a person typed it: no stock
// AI phrasing, no buzzword pile-up, no placeholders, no self-reference to how it
// was written, a length that fits the question, and sentences that do not all
// start or run the same way. "block" failures send the answer back (or to you);
// "warn" failures are shown next to it when you review.

import { norm, sentences, wordCount } from "../text";
import type { Check, Lang } from "../types";

export type LintCheck = Check & { severity: "block" | "warn" };

/** Stock phrases that make a form answer read as generated. Matched on norm() text. */
const STOCK_EN = [
  "i am writing to", "i'm writing to", "express my interest", "express my keen interest", "express my strong interest",
  "i am thrilled", "i'm thrilled", "i am excited to", "i'm excited to", "excited about the opportunity",
  "passionate about", "deeply passionate", "my passion for", "unwavering", "delve", "tapestry", "testament to",
  "fast paced", "fast-paced", "ever evolving", "ever-evolving", "ever changing", "in today's", "cutting edge", "cutting-edge",
  "state of the art", "state-of-the-art", "leverage", "leveraging", "synergy", "synergies", "spearheaded", "honed",
  "seamless", "seamlessly", "dynamic team", "results driven", "results-driven", "detail oriented", "detail-oriented",
  "go getter", "think outside the box", "hit the ground running", "wealth of", "invaluable", "furthermore", "moreover",
  "in conclusion", "to sum up", "align perfectly", "aligns perfectly", "perfect fit", "perfect match", "dream job",
  "proven track record", "strong track record", "unique blend", "at the intersection of", "it's worth noting",
  "navigate the complexities", "embark", "my journey", "foster", "fostering", "empower", "empowering", "elevate",
  "game changer", "game-changer", "i would be honored", "i am confident that", "valuable asset", "meaningful impact",
  "contribute meaningfully", "eager to contribute", "i am eager to", "i'm eager to", "keen eye", "robust solutions",
  "thank you for considering", "thank you for your consideration", "look forward to hearing", "rapidly evolving",
];

const STOCK_FR = [
  "je suis passionne", "passionnee par", "c'est avec enthousiasme", "c'est avec un grand interet", "c'est avec plaisir",
  "je me permets", "n'hesitez pas", "en constante evolution", "au coeur de", "incontournable", "je suis convaincu",
  "je suis convaincue", "atout majeur", "fort de", "forte de", "en outre", "par ailleurs", "en conclusion", "synergie",
  "mettre a profit", "tirer parti", "relever de nouveaux defis", "valeur ajoutee", "je serais ravi", "je serais ravie",
  "je vous remercie de l'attention", "dans l'attente de", "veritable passion", "profil ideal", "adequation parfaite",
];

/** The answer talking about how it was produced. Never allowed. */
const SELF_REFERENCE =
  /\bas an ai\b|\blanguage model\b|\bchatgpt\b|\bopenai\b|\bclaude\b|\bthis (answer|response) (was|is) (generated|written)\b|\bgenerated (by|with|using)\b|\bi was asked to (write|answer)\b|\b(this|the|your) prompt\b|\ben tant qu'ia\b|\bmodele de langage\b|\bgenere par\b/i;

const PLACEHOLDER =
  /\[[^\]]{1,60}\]|\{\{?[^}]{1,60}\}?\}|<[a-z_ ]{2,40}>|\bTODO\b|\bTBD\b|\bXXX+\b|lorem ipsum|\binsert (company|name|role)\b|\b(company|your) name here\b|\[company\]|\bdo not send\b|\bne pas envoyer\b|\brewrite this\b|\br[ée][ée]cri(s|re) cette\b/i;

export type LengthTarget = { min: number; max: number; hardMaxChars: number | null };

/** Expected length: the question's own wording first, then the field's limit, then its size. */
export function lengthTarget(opts: {
  label: string;
  hint: string | null;
  maxLength: number | null;
  rows: number | null;
  kind: string;
}): LengthTarget {
  const text = `${opts.label} ${opts.hint ?? ""}`.toLowerCase();
  const hard = opts.maxLength && opts.maxLength > 0 ? opts.maxLength : null;
  const words = text.match(/(\d{2,4})\s*(?:words?|mots?)/);
  const range = text.match(/(\d{2,4})\s*(?:-|to|à|a)\s*(\d{2,4})\s*(?:words?|mots?)/);
  const sentenceCount = text.match(/(\d)\s*(?:-|to|à)?\s*(\d)?\s*(?:sentences?|phrases?)/);
  const chars = text.match(/(\d{2,5})\s*(?:characters?|caract[eè]res?|chars?)/);

  let min = 70;
  let max = 150;
  if (range) {
    min = Number(range[1]);
    max = Number(range[2]);
  } else if (words) {
    max = Number(words[1]);
    min = Math.round(max * 0.55);
  } else if (sentenceCount) {
    const hi = Number(sentenceCount[2] ?? sentenceCount[1]);
    max = hi * 24;
    min = Math.max(12, Number(sentenceCount[1]) * 12);
  } else if (/\bbrief(ly)?\b|\bshort\b|\bbri[eè]vement\b|\bcourt\b|\bin a (few|couple of) (words|sentences)\b/.test(text)) {
    min = 25;
    max = 70;
  } else if (opts.kind === "text") {
    min = 8;
    max = 40;
  } else if (opts.rows && opts.rows <= 3) {
    min = 35;
    max = 80;
  }
  const charLimit = hard ?? (chars ? Number(chars[1]) : null);
  if (charLimit) {
    // About 6.3 characters per word including the space, with room to spare.
    const fit = Math.floor((charLimit / 6.3) * 0.9);
    max = Math.min(max, fit);
    min = Math.min(min, Math.round(max * 0.5));
  }
  return { min: Math.max(1, min), max: Math.max(min, max), hardMaxChars: charLimit };
}

function stockHits(text: string, lang: Lang): string[] {
  const n = ` ${norm(text)} `;
  const list = lang === "fr" ? [...STOCK_FR, ...STOCK_EN] : STOCK_EN;
  return list.filter((p) => n.includes(` ${norm(p)} `) || n.includes(` ${norm(p)}`));
}

function repeatedOpeners(sents: string[]): string | null {
  if (sents.length < 4) return null;
  const firsts = sents.map((s) => norm(s).split(" ").slice(0, 2).join(" "));
  const counts = new Map<string, number>();
  for (const f of firsts) counts.set(f, (counts.get(f) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / sents.length > 0.5 ? top : null;
}

function repeatedPhrase(text: string): string | null {
  const w = norm(text).split(" ").filter(Boolean);
  const seen = new Map<string, number>();
  for (let i = 0; i + 4 <= w.length; i++) {
    const gram = w.slice(i, i + 4).join(" ");
    seen.set(gram, (seen.get(gram) ?? 0) + 1);
  }
  const hit = [...seen.entries()].find(([, n]) => n >= 2);
  return hit ? hit[0] : null;
}

function monotone(sents: string[]): boolean {
  if (sents.length < 4) return false;
  const lens = sents.map(wordCount);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return sd < 3;
}

export function lintAnswer(
  text: string,
  opts: { lang: Lang; target: LengthTarget; companyName?: string; mustNameCompany?: boolean; question?: string },
): LintCheck[] {
  const out: LintCheck[] = [];
  const add = (id: string, ok: boolean, label: string, severity: "block" | "warn", detail?: string) =>
    out.push({ id, ok, label, severity, detail });
  const trimmed = text.trim();
  const words = wordCount(trimmed);
  const sents = sentences(trimmed);

  add("not_empty", trimmed.length > 0, "Answer is not empty", "block");
  add("no_self_reference", !SELF_REFERENCE.test(trimmed), "Never mentions AI, prompts or how it was written", "block");
  const ph = trimmed.match(PLACEHOLDER)?.[0];
  add("no_placeholder", !ph, "No placeholder text", "block", ph ? `found "${ph}"` : undefined);

  const stock = stockHits(trimmed, opts.lang);
  add("no_stock_phrases", stock.length === 0, "No stock / buzzword phrasing", stock.length >= 2 ? "block" : "warn", stock.length ? stock.join(", ") : undefined);

  const dashes = (trimmed.match(/—/g) ?? []).length;
  add("no_em_dash", dashes <= 1, "At most one em dash", "warn", dashes > 1 ? `${dashes} em dashes` : undefined);
  add("no_exclamation", !/!/.test(trimmed), "No exclamation marks", "warn");
  add("no_markdown", !/^\s*[-*•]\s|\*\*|__|^#+\s/m.test(trimmed), "Plain prose, no bullets or markdown", "block");

  if (opts.target.hardMaxChars) {
    add("fits_limit", trimmed.length <= opts.target.hardMaxChars, "Fits the field's character limit", "block", `${trimmed.length}/${opts.target.hardMaxChars} characters`);
  }
  const lenOk = words >= Math.floor(opts.target.min * 0.8) && words <= Math.ceil(opts.target.max * 1.15);
  add("length", lenOk, "Length fits the question", "warn", `${words} words (aim ${opts.target.min}–${opts.target.max})`);

  const opener = repeatedOpeners(sents);
  add("varied_openers", !opener, "Sentences do not all start the same way", "warn", opener ? `"${opener}…" repeats` : undefined);
  const phrase = repeatedPhrase(trimmed);
  add("no_repeated_phrase", !phrase, "No phrase repeated", "warn", phrase ? `"${phrase}"` : undefined);
  add("varied_rhythm", !monotone(sents), "Sentence lengths vary", "warn");

  if (opts.question) {
    const q = norm(opts.question).split(" ").slice(0, 6).join(" ");
    const restates = q.length > 12 && norm(trimmed).startsWith(q);
    add("no_restating", !restates, "Does not restate the question", "warn");
  }
  if (opts.mustNameCompany && opts.companyName) {
    const named = norm(trimmed).includes(norm(opts.companyName).split(" ")[0]);
    add("names_company", named, "Refers to the company specifically", "warn");
  }
  return out;
}

export function blockingFailures(checks: LintCheck[]): LintCheck[] {
  return checks.filter((c) => !c.ok && c.severity === "block");
}
