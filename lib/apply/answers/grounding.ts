// Does the answer claim anything that is not in the material? Three things are
// checked against the corpus, mechanically, after every generation:
//   numbers      — "9.6%", "100 prospects", "2027" must appear in the material
//   proper nouns — names of projects, schools, products, companies, tools
//   technologies — a tool the answer names must be in Ara's own skills/projects;
//                  one that only appears in the posting is flagged, because
//                  "I used Kafka" would be invented experience.
// It cannot read meaning, so it is a floor, not a proof: you still review.

import { extractSkillsFromText } from "../../profile";
import type { CandidateProfile } from "../candidate";
import { norm } from "../text";
import type { LintCheck } from "./humanize";

export type GroundingCorpus = {
  /** Everything Ara wrote or uploaded. */
  candidate: string;
  /** The posting and the company notes. */
  context: string;
  candidateSkills: string[];
};

const ALWAYS_OK = new Set(
  [
    "i", "i'm", "i've", "i'd", "i'll", "je", "j'ai", "english", "french", "anglais", "francais", "canada", "montreal",
    "quebec", "laval", "winter", "summer", "fall", "spring", "hiver", "ete", "automne", "printemps", "january",
    "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre",
    "decembre", "monday", "tuesday", "wednesday", "thursday", "friday", "api", "apis", "ui", "ux", "it", "ok",
  ].map(norm),
);

export function buildCorpus(opts: {
  candidate: CandidateProfile;
  job: { companyName: string; title: string; description: string | null; location: string | null };
  companyNotes: string[];
  samples: string[];
}): GroundingCorpus {
  const c = opts.candidate;
  const bankText = Object.values(c.bank).flatMap((b) => [b.en, b.fr]).filter(Boolean);
  const projectText = c.projects.flatMap((p) => [
    p.name,
    p.summary,
    p.url ?? "",
    ...p.tech,
    ...(p.facts ? Object.values(p.facts).flatMap((v) => (Array.isArray(v) ? v : [v.en, v.fr])) : []),
  ]);
  const expText = c.experience.flatMap((e) => [e.title, e.organization ?? "", e.years ?? "", ...e.bullets]);
  const candidate = [
    c.fullName, c.email, c.city, c.regionName, c.country, c.education.school, c.education.program,
    c.education.credential, c.education.graduation, c.availableFrom, c.locationRule, c.languagesText,
    ...c.links.all, ...c.skills, ...bankText, ...projectText, ...expText, c.resumeText ?? "", ...opts.samples,
  ]
    .filter(Boolean)
    .join("\n");
  const context = [opts.job.companyName, opts.job.title, opts.job.location ?? "", opts.job.description ?? "", ...opts.companyNotes].join("\n");
  return { candidate, context, candidateSkills: c.skills };
}

function numberKey(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/,(?=\d)/g, ".").replace(/%$/, "");
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/(?<![\p{L}\d])\d+(?:[.,]\d+)?\s?%?(?![\p{L}\d])/gu)].map((m) => numberKey(m[0]));
}

function tokenSet(text: string): Set<string> {
  return new Set(norm(text).split(" ").map((w) => w.replace(/^[.']+|[.']+$/g, "")).filter(Boolean));
}

/** Capitalized tokens that are not the first word of a sentence, plus tokens with inner capitals/digits anywhere. */
function properNouns(text: string): string[] {
  const out: string[] = [];
  const sents = text.split(/(?<=[.!?:;])\s+|\n+/);
  for (const s of sents) {
    const toks = s.split(/\s+/).map((t) => t.replace(/^[("“'‘]+|[)"”'’.,;:!?]+$/g, ""));
    toks.forEach((t, i) => {
      if (!t || !/^[A-ZÀ-Ý]/.test(t)) return;
      const inner = /[A-Z0-9].*[A-Z]|[a-z][A-Z]|\d/.test(t.slice(1));
      if (i === 0 && !inner) return;
      out.push(t);
    });
  }
  return out;
}

export function checkGrounding(answer: string, corpus: GroundingCorpus): { checks: LintCheck[]; unverified: string[] } {
  const all = `${corpus.candidate}\n${corpus.context}`;
  const allNumbers = new Set(numbersIn(all));
  const words = tokenSet(all);
  const unverified: string[] = [];

  const badNumbers = [...new Set(numbersIn(answer))].filter((n) => !allNumbers.has(n));

  const badNames = [...new Set(properNouns(answer))].filter((tok) => {
    const parts = norm(tok).split(" ").filter(Boolean);
    return parts.length > 0 && !parts.every((p) => ALWAYS_OK.has(p) || words.has(p) || words.has(p.replace(/'s$/, "")));
  });

  const mine = new Set(corpus.candidateSkills.map((s) => s.toLowerCase()));
  const mentioned = extractSkillsFromText(answer);
  const inPostingOnly: string[] = [];
  const nowhere: string[] = [];
  const candidateSkillsInText = new Set(extractSkillsFromText(corpus.candidate).map((s) => s.toLowerCase()));
  const contextSkills = new Set(extractSkillsFromText(corpus.context).map((s) => s.toLowerCase()));
  for (const skill of mentioned) {
    const k = skill.toLowerCase();
    if (mine.has(k) || candidateSkillsInText.has(k)) continue;
    if (contextSkills.has(k)) inPostingOnly.push(skill);
    else nowhere.push(skill);
  }

  unverified.push(...badNumbers, ...badNames, ...nowhere);
  const checks: LintCheck[] = [
    {
      id: "grounded_numbers",
      ok: badNumbers.length === 0,
      label: "Every number comes from your material or the posting",
      severity: "block",
      detail: badNumbers.length ? badNumbers.join(", ") : undefined,
    },
    {
      id: "grounded_names",
      ok: badNames.length === 0,
      label: "Every name (project, school, company, product) is in the material",
      severity: "block",
      detail: badNames.length ? badNames.join(", ") : undefined,
    },
    {
      id: "grounded_skills",
      ok: nowhere.length === 0,
      label: "Every technology named is one you have used",
      severity: "block",
      detail: nowhere.length ? nowhere.join(", ") : undefined,
    },
    {
      id: "posting_only_skills",
      ok: inPostingOnly.length === 0,
      label: "Tools only in the posting are not claimed as experience",
      severity: "warn",
      detail: inPostingOnly.length ? `${inPostingOnly.join(", ")}: in the posting, not in your CV. Check the wording.` : undefined,
    },
  ];
  return { checks, unverified };
}
