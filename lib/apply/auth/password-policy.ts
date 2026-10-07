// What a portal asks of a password, read from what it prints: the requirement list beside a sign-up form ("A minimum of 8
// characters", "An uppercase character") or the message it shows after refusing one ("Password must be at least 12
// characters"). No browser and no secrets here: text in, a policy out, so it can be checked offline.
//
// Used two ways (lib/apply/account.ts):
//   - does the configured password already meet this portal's rules? Then it is used as is.
//   - if not, a password that meets them is generated for this one portal and kept in the vault (lib/apply/auth/vault.ts).

import { randomInt } from "node:crypto";

export type PasswordPolicy = {
  minLength: number | null;
  maxLength: number | null;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
  /** Characters the portal says it does not accept. */
  forbidden: string;
  /** "must not contain your email / name": the generated password never does anyway. */
  noPersonalInfo: boolean;
  /** The rule lines the policy was read from, for the reason shown when a password does not fit. */
  rules: string[];
};

const EMPTY: PasswordPolicy = { minLength: null, maxLength: null, upper: false, lower: false, digit: false, special: false, forbidden: "", noPersonalInfo: false, rules: [] };

const n = (s: string | undefined) => (s ? Number(s) : NaN);

/** Lines of the page that talk about the password (one rule each, as most portals print them). */
function ruleLines(text: string): string[] {
  const lines = text
    .split(/\n|•|·|•|;|(?<=\.)\s+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2 && l.length < 200);
  // A requirement list ("Password Requirements:" then one rule per line) counts even when its lines do not say "password".
  const at = lines.findIndex((l) => /password (requirements|rules|must)|mot de passe (doit|exigences)|exigences (du|de) mot de passe/i.test(l));
  const listed = at >= 0 ? lines.slice(at, at + 12) : [];
  const RULE = /character|caract[eè]re|letter|lettre|digit|chiffre|number|num[eé]r|symbol|symbole|special|sp[eé]cial|uppercase|lowercase|majuscule|minuscule|length|longueur|at least|au moins|minimum|maximum|no more than|between \d+ and \d+|entre \d+ et \d+/i;
  return [...new Set([...listed.filter((l) => RULE.test(l)), ...lines.filter((l) => /password|mot de passe/i.test(l) && RULE.test(l))])];
}

/** The policy a portal's text describes. Rules it does not mention are not required. */
export function parsePasswordPolicy(text: string): PasswordPolicy {
  const rules = ruleLines(text);
  if (rules.length === 0) return { ...EMPTY };
  const all = rules.join(" \n ").toLowerCase();
  const p: PasswordPolicy = { ...EMPTY, rules };

  const between = all.match(/between (\d+) and (\d+) characters|entre (\d+) et (\d+) caract/);
  if (between) {
    p.minLength = n(between[1] ?? between[3]);
    p.maxLength = n(between[2] ?? between[4]);
  }
  const min =
    all.match(/(?:at least|minimum(?: of)?|min\.?|a minimum of|au moins|minimum de)\s*(\d+)\s*(?:characters?|caract|chars?)/) ??
    all.match(/(\d+)\s*(?:characters?|caract[eè]res?)\s*(?:minimum|or more|ou plus|au moins|min\b)/) ??
    all.match(/(?:length|longueur)[^0-9]{0,20}(\d+)/);
  if (min && p.minLength === null) p.minLength = n(min[1]);
  const max = all.match(/(?:no more than|at most|maximum(?: of)?|max\.?|au plus|maximum de)\s*(\d+)\s*(?:characters?|caract|chars?)/) ?? all.match(/(\d+)\s*(?:characters?|caract[eè]res?)\s*(?:maximum|or (?:less|fewer)|max\b)/);
  if (max && p.maxLength === null) p.maxLength = n(max[1]);

  p.upper = /upper ?case|capital|majuscule/.test(all);
  p.lower = /lower ?case|minuscule/.test(all);
  p.digit = /\bdigit|\bnumber|numeric|num[eé]rique|chiffre/.test(all);
  p.special = /special|symbol|sp[eé]cial|non.?alphanumeric|punctuation|caract[eè]re sp/.test(all);
  // "An alphabetic character" with nothing about case: one letter of either case does it.
  if (/alphabetic|letter|lettre/.test(all) && !p.upper && !p.lower) p.lower = true;
  p.noPersonalInfo = /(not|ne).{0,30}(contain|include|contenir).{0,30}(email|e-mail|name|nom|username|courriel)/.test(all);

  const forbid = all.match(/(?:cannot|can't|must not|may not|not allowed|ne (?:peut|doit) pas)[^.\n]{0,40}(?:contain|include|use|contenir|utiliser)[^.\n]{0,20}?[:\s]+((?:[^\sa-z0-9]\s*){1,20})/);
  if (forbid) p.forbidden = [...new Set(forbid[1].replace(/\s+/g, "").split(""))].join("");
  if (/no spaces|(cannot|can't|must not|may not|ne (peut|doit) pas)[^.\n]{0,60}\bspaces?\b|sans espace|pas d['’]espace/.test(all) && !p.forbidden.includes(" ")) p.forbidden += " ";
  return p;
}

/** True when the policy asks for anything at all (a page with no rules printed gives an empty policy). */
export function hasRules(p: PasswordPolicy): boolean {
  return p.minLength !== null || p.maxLength !== null || p.upper || p.lower || p.digit || p.special || p.forbidden.length > 0;
}

/** The rules this password breaks, in words (never the password itself). Empty when it fits. */
export function policyViolations(p: PasswordPolicy, password: string): string[] {
  const out: string[] = [];
  if (p.minLength !== null && password.length < p.minLength) out.push(`shorter than ${p.minLength} characters`);
  if (p.maxLength !== null && password.length > p.maxLength) out.push(`longer than ${p.maxLength} characters`);
  if (p.upper && !/[A-Z]/.test(password)) out.push("no uppercase letter");
  if (p.lower && !/[a-z]/.test(password)) out.push("no lowercase letter");
  if (p.digit && !/[0-9]/.test(password)) out.push("no digit");
  if (p.special && !/[^A-Za-z0-9]/.test(password)) out.push("no special character");
  const bad = [...p.forbidden].filter((ch) => password.includes(ch));
  if (bad.length) out.push(`contains a character the portal refuses (${bad.map((c) => (c === " " ? "space" : c)).join(" ")})`);
  return out;
}

const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
// Symbols nearly every portal accepts; quotes, backslash, angle brackets and spaces are left out on purpose.
const SPECIAL = "!#$%*+-=?@^_";

/**
 * A password that meets the policy: 20 characters unless the policy caps it lower, at least one of every class (all four
 * even when the policy names fewer, since many portals check more than they print), from crypto randomness.
 */
export function generatePassword(p: PasswordPolicy): string {
  const strip = (set: string) => [...set].filter((ch) => !p.forbidden.includes(ch)).join("");
  const classes = [strip(LOWER), strip(UPPER), strip(DIGIT), strip(SPECIAL)].filter((s) => s.length > 0);
  if (classes.length === 0) throw new Error("the portal's rules forbid every character the generator uses");
  const target = Math.max(p.minLength ?? 0, Math.min(20, p.maxLength ?? 20));
  const length = Math.max(target, classes.length);
  if (p.maxLength !== null && length > p.maxLength) throw new Error(`the portal's rules cannot be met (at most ${p.maxLength} characters, ${classes.length} kinds required)`);
  const pool = classes.join("");
  const chars = classes.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(pool[randomInt(pool.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const out = chars.join("");
  if (policyViolations(p, out).length) throw new Error("generated password does not meet the policy");
  return out;
}

/** Merges two readings of the same portal (the list before, the error after): the stricter of each rule. */
export function mergePolicies(a: PasswordPolicy, b: PasswordPolicy): PasswordPolicy {
  const maxOf = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.max(x, y));
  const minOf = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.min(x, y));
  return {
    minLength: maxOf(a.minLength, b.minLength),
    maxLength: minOf(a.maxLength, b.maxLength),
    upper: a.upper || b.upper,
    lower: a.lower || b.lower,
    digit: a.digit || b.digit,
    special: a.special || b.special,
    forbidden: [...new Set([...a.forbidden, ...b.forbidden])].join(""),
    noPersonalInfo: a.noPersonalInfo || b.noPersonalInfo,
    rules: [...new Set([...a.rules, ...b.rules])],
  };
}
