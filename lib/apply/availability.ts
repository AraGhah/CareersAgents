// "When can you start?", in every shape a form asks it, answered from two facts you gave (candidate.availability):
//   - full time: from your preferred start (January 1, 2027), while you finish your studies until then
//   - earlier: only part time alongside school, and only when you said you can (work_while_studying)
//
// The rule that keeps every answer true: the full-time date is always true (you ARE available then), so it is the default.
// An earlier start ("Available immediately") is given only when the posting itself says the work fits around school
// (part time, a few hours a week, during the school year). A question none of this answers clearly goes to you.
// No browser, no database: posting text and the field in, a value or a reason out.

import type { CandidateProfile } from "./candidate";
import { isYesNoOptionSet, matchOption, realOptions } from "./options";
import { cleanLabel, norm } from "./text";
import type { FormField } from "./types";

export type ScheduleFit = "fits_studies" | "full_time" | "unknown";

const FITS_STUDIES =
  /part.?time|temps partiel|while (you are |you're )?(studying|in school|completing your (studies|degree))|pendant (vos|tes|les) (etudes|sessions?)|during the (school|academic) (year|term|session)|concurrent(ly)? with (your )?studies|conciliation (etudes|travail.etudes)|flexible (hours|schedule)|horaire flexible|\b(8|10|12|15|16|20)\s*(-|to|a)?\s*(\d{1,2}\s*)?(hours|heures|h)\s*(per|par|\/|a la|by)\s*(week|semaine)/;
const FULL_TIME = /full.?time|temps plein|temps complet|\b(35|37[.,]5|40)\s*(hours|heures|h)\s*(per|par|\/|a la)\s*(week|semaine)/;

/** What the posting says about its schedule. */
export function scheduleFit(posting: string | null, title = ""): ScheduleFit {
  const t = norm(`${title} ${posting ?? ""}`);
  if (FITS_STUDIES.test(t)) return "fits_studies";
  if (FULL_TIME.test(t)) return "full_time";
  return "unknown";
}

const DAY_MS = 86_400_000;

function weeksUntil(iso: string, now: Date): number {
  return Math.max(0, (Date.parse(`${iso}T00:00:00Z`) - now.getTime()) / (7 * DAY_MS));
}

/** "2-4 weeks" → [2, 4]; "8+ weeks" → [8, ∞]; "Available immediately" → [0, 0]; "1-3 months" → [4.3, 13]. Null when unreadable. */
export function noticeRange(option: string): [number, number] | null {
  const t = norm(option);
  if (/immediat|right away|now\b|asap|tout de suite|des maintenant|sans delai|no notice|aucun preavis/.test(t)) return [0, 0];
  const unit = /month|mois/.test(t) ? 4.345 : /week|semaine|sem\b/.test(t) ? 1 : /day|jour/.test(t) ? 1 / 7 : null;
  if (unit === null) return null;
  const nums = [...t.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1].replace(",", ".")));
  if (nums.length === 0) return /less than|moins d/.test(t) ? [0, unit] : null;
  if (/\+|more than|over|plus de|or more|ou plus|beyond|au.dela/.test(t)) return [nums[0] * unit, Infinity];
  if (/less than|under|within|moins de|en dedans/.test(t)) return [0, nums[0] * unit];
  return nums.length >= 2 ? [nums[0] * unit, nums[1] * unit] : [nums[0] * unit, nums[0] * unit];
}

export type AvailabilityAnswer = { value: string; reason: string } | { manual: string };

/** The option set reads as notice periods ("Immediately / 2-4 weeks / 8+ weeks"). */
export function isNoticeOptionSet(options: string[]): boolean {
  const opts = realOptions(options).map((o) => o.text);
  return opts.length >= 2 && opts.filter((o) => noticeRange(o)).length >= Math.max(2, opts.length - 1);
}

/**
 * The answer to a start-availability question with options (a notice-period selector, or a yes/no "available from …?"),
 * or a text answer, or the reason it is left to you. Date fields are not here: they take the full-time date (resolve.ts).
 */
export function availabilityAnswer(
  field: FormField,
  candidate: CandidateProfile,
  job: { title: string; description: string | null },
  now: Date = new Date(),
): AvailabilityAnswer | null {
  const start = candidate.availability.fullTimeStart;
  const fit = scheduleFit(job.description, job.title);
  const early = fit === "fits_studies" && candidate.availability.canWorkWhileStudying;
  const opts = realOptions(field.options).map((o) => o.text);
  const l = norm(cleanLabel(field.label));

  if (opts.length && isNoticeOptionSet(field.options)) {
    if (early) {
      const now0 = opts.find((o) => noticeRange(o)?.[1] === 0) ?? opts.find((o) => (noticeRange(o)?.[0] ?? 1) === 0);
      if (now0) return { value: now0, reason: `"${now0}": the posting's schedule fits around school, and you can work while studying.` };
    }
    if (!start) return { manual: "Start availability: your full-time start date is not in your answer bank." };
    const weeks = weeksUntil(start, now);
    const hits = opts.filter((o) => {
      const r = noticeRange(o);
      return r && weeks >= r[0] - 0.01 && weeks <= r[1] + 0.01;
    });
    if (hits.length === 1) return { value: hits[0], reason: `"${hits[0]}": full time from ${start} (${Math.round(weeks)} weeks from now)${fit === "full_time" ? ", and the role is full time" : ""}.` };
    return { manual: `Start availability: full time from ${start} (${Math.round(weeks)} weeks), and no option clearly matches it.` };
  }

  if (opts.length && isYesNoOptionSet(field.options)) {
    // "Are you available to start in January 2027?" / "... on May 4, 2026?": compared with the full-time date.
    const asked = l.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b[^0-9]{0,6}(\d{1,2})?[^0-9]{0,4}(20\d{2})/);
    if (!asked || !start) return { manual: "A yes/no availability question your data does not clearly answer: pick it yourself." };
    const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const FR = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
    const month = (MONTHS.indexOf(asked[1]) + 1 || FR.indexOf(asked[1]) + 1) as number;
    const askedIso = `${asked[3]}-${String(month).padStart(2, "0")}-${String(asked[2] ? Number(asked[2]) : 31).padStart(2, "0")}`;
    if (askedIso >= start) {
      const m = matchOption("Yes", field.options);
      return m ? { value: m.option, reason: `Yes: you are available full time from ${start}.` } : null;
    }
    return { manual: `The question asks about a start before ${start}: only true part time alongside school, if the role allows it. Answer it yourself.` };
  }

  if (field.kind === "text" || field.kind === "textarea") {
    if (!start) return null;
    const fr = candidate.lang === "fr";
    const date = new Date(`${start}T00:00:00Z`).toLocaleDateString(fr ? "fr-CA" : "en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    if (early) {
      return {
        value: fr ? `Dès maintenant à temps partiel, en parallèle de mes études; à temps plein à partir du ${date}.` : `Immediately, part time alongside my studies; full time from ${date}.`,
        reason: "The posting's schedule fits around school, and you can work while studying; full-time date from your answer bank.",
      };
    }
    return { value: date, reason: `Full time from ${start} (answer bank).` };
  }
  return null;
}
