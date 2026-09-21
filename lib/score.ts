import Decimal from "decimal.js";
import skillsFile from "../skills.json";
import weightsFile from "../weights.json";
import type { WorkplaceType } from "./types";

export const COMPONENT_NAMES = ["skills", "location", "timing", "language", "level"] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

export type ScoreInput = {
  title: string;
  location: string | null;
  workplaceType: WorkplaceType | null;
  description: string | null;
  companyCity: string | null;
};

export type SkillHit = { name: string; have: boolean };

export type Components = Record<ComponentName, number>;
export type Weights = Record<ComponentName, number>;

export type Band = "high" | "mid" | "ok" | "low" | "skip";

export type ScoreResult = {
  components: Components;
  weights: Weights;
  found: SkillHit[];
  total: Decimal;
  percent: number;
  gated: boolean;
  band: Band;
  explanation: string;
};

type DictionaryEntry = { name: string; patterns: string[] };

const dictionary = (skillsFile.dictionary as DictionaryEntry[]).map((entry) => ({
  name: entry.name,
  regexes: entry.patterns.map((pattern) => new RegExp(pattern, "i")),
}));

const have = new Set(skillsFile.have as string[]);

function asWeights(raw: Record<string, number>): Weights {
  const weights = {} as Weights;
  let sum = new Decimal(0);
  for (const name of COMPONENT_NAMES) {
    const value = raw[name];
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
      throw new Error(`weights.json: ${name} must be a number >= 0`);
    }
    weights[name] = value;
    sum = sum.plus(value);
  }
  if (sum.minus(1).abs().greaterThan("0.001")) {
    throw new Error(`weights.json must sum to 1, got ${sum.toString()}`);
  }
  return weights;
}

export const defaultWeights = asWeights(weightsFile);

function haystack(input: ScoreInput): string {
  return [input.title, input.location, input.workplaceType, input.companyCity, input.description]
    .filter(Boolean)
    .join("\n");
}

export function findSkills(text: string): SkillHit[] {
  const found: SkillHit[] = [];
  for (const entry of dictionary) {
    if (entry.regexes.some((re) => re.test(text))) {
      found.push({ name: entry.name, have: have.has(entry.name) });
    }
  }
  return found;
}

function skillsScore(found: SkillHit[]): number {
  if (found.length === 0) return 0.5;
  const matched = found.filter((s) => s.have).length;
  return new Decimal(matched).div(found.length).toDecimalPlaces(4).toNumber();
}

function locationScore(input: ScoreInput, text: string): number {
  const local =
    /montr[eé]al|laval|saint-?laurent|st[ .\-]?laurent|vaudreuil/i.test(text) ||
    (input.companyCity != null &&
      /montr[eé]al|laval|saint-?laurent|st[ .\-]?laurent|vaudreuil/i.test(input.companyCity));

  const elsewhere =
    /toronto|vancouver|calgary|ottawa|mississauga|waterloo|edmonton|winnipeg|quebec city|ville de qu[eé]bec|halifax|victoria|saskatoon|regina|kitchener|hamilton/i.test(
      text,
    );

  const us =
    /\bunited states\b|\busa\b|\bu\.s\.a?\b|new york|san francisco|seattle|austin|boston|chicago|denver|los angeles/i.test(
      text,
    );

  const remote =
    input.workplaceType === "remote" ||
    /\bremote\b|t[eé]l[eé]travail|\bwfh\b|work from home/i.test(text);

  if (local) return 1;
  if (remote && !us) return 1;
  if (remote && us && /canada|qu[eé]bec|ontario/i.test(text)) return 1;
  if (elsewhere || us) return 0;
  if (!input.location && !input.companyCity) return 0.5;
  return 0.5;
}

function yearsNear(text: string, keyword: RegExp): number[] {
  const years: number[] = [];
  const copy = new RegExp(keyword.source, keyword.flags.includes("g") ? keyword.flags : `${keyword.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = copy.exec(text)) !== null) {
    const from = Math.max(0, match.index - 20);
    const to = Math.min(text.length, match.index + match[0].length + 20);
    for (const year of text.slice(from, to).matchAll(/\b(20\d{2})\b/g)) {
      years.push(Number(year[1]));
    }
  }
  return years;
}

function timingScore(input: ScoreInput, text: string): number {
  const winter = /\bwinter\b|\bhiver\b|\bjanuary\b|\bjanvier\b/i;
  const otherTerm =
    /\bsummer\b|\b[eé]t[eé]\b|\bspring\b|\bprintemps\b|\bfall\b|\bautumn\b|\bautomne\b/i.test(text);

  if (winter.test(text)) {
    const years = yearsNear(text, winter);
    const covers2027 = years.includes(2027) || (years.includes(2026) && years.includes(2027));
    if (covers2027) return 1;
    if (years.length > 0 && years.every((y) => y < 2027)) return 0;
    return 1;
  }

  if (otherTerm) return 0;

  if (/\bintern(?:s|ship|ships)?\b|\bstages?\b|\bstagiaires?\b|\bco-?ops?\b/i.test(input.title)) {
    return 1;
  }
  return 0.5;
}

function languageScore(text: string): number {
  const other =
    /\b(?:spanish|espagnol|german|allemand|mandarin|chinese|chinois|japanese|japonais|arabic|arabe|italian|italien|portuguese|portugais|dutch|n[eé]erlandais|russian|russe|korean|cor[eé]en|hindi|cantonese|cantonais)\b/gi;

  let match: RegExpExecArray | null;
  while ((match = other.exec(text)) !== null) {
    const from = Math.max(0, match.index - 48);
    const to = Math.min(text.length, match.index + match[0].length + 48);
    const window = text.slice(from, to);
    if (
      /\b(?:required|obligatoire|must|mandatory|fluent|courant|native|langue maternelle)\b/i.test(
        window,
      )
    ) {
      return 0;
    }
  }
  return 1;
}

function levelScore(input: ScoreInput, text: string): number {
  if (
    /\bintern(?:s|ship|ships)?\b|\bstages?\b|\bstagiaires?\b|\binternes?\b|\bco-?ops?\b|\bjunior\b|\bentry[- ]level\b/i.test(
      input.title,
    )
  ) {
    return 1;
  }

  if (
    /\b(?:senior|staff|principal|director|directeur|manager|gestionnaire|lead|vp|head of)\b/i.test(
      input.title,
    )
  ) {
    return 0;
  }

  const years = [
    ...text.matchAll(
      /(\d+)\s*\+?\s*(?:years?|ans)\s+(?:of\s+)?(?:experience|exp[eé]rience)/gi,
    ),
  ];
  if (years.some((m) => Number(m[1]) >= 3)) return 0;

  return 0.5;
}

export function bandOf(percent: number, gated: boolean): Band {
  if (gated) return "skip";
  if (percent >= 85) return "high";
  if (percent >= 70) return "mid";
  if (percent >= 60) return "ok";
  return "low";
}

function fmt(value: number): string {
  if (value === 0 || value === 1) return String(value);
  return new Decimal(value).toDecimalPlaces(2).toString();
}

export function explain(components: Components, percent: number, gated: boolean): string {
  const parts = COMPONENT_NAMES.map((name) => `${name} ${fmt(components[name])}`);
  const first = `The five inputs are ${parts.join(", ")}.`;

  if (components.location === 0 && components.timing === 0) {
    return `${first} Location and timing are both 0, so it is skipped no matter what the total is.`;
  }
  if (components.location === 0) {
    return `${first} Location is 0, so it is skipped no matter what the total is.`;
  }
  if (components.timing === 0) {
    return `${first} Timing is 0, so it is skipped no matter what the total is.`;
  }
  if (percent >= 85) return `${first} Total ${percent}, first band.`;
  if (percent >= 70) return `${first} Total ${percent}, second band.`;
  if (percent >= 60) {
    return `${first} Total ${percent}, on the board but behind the first two bands.`;
  }
  return `${first} Total ${percent}, under 60, so it stays hidden by default and is not deleted.`;
}

export function scoreJob(input: ScoreInput, weights: Weights = defaultWeights): ScoreResult {
  const text = haystack(input);
  const found = findSkills(text);
  const components: Components = {
    skills: skillsScore(found),
    location: locationScore(input, text),
    timing: timingScore(input, text),
    language: languageScore(text),
    level: levelScore(input, text),
  };

  let total = new Decimal(0);
  for (const name of COMPONENT_NAMES) {
    total = total.plus(new Decimal(components[name]).times(weights[name]));
  }
  const percent = total.times(100).toDecimalPlaces(0).toNumber();
  const gated = components.location === 0 || components.timing === 0;

  return {
    components,
    weights,
    found,
    total,
    percent,
    gated,
    band: bandOf(percent, gated),
    explanation: explain(components, percent, gated),
  };
}

export function checkScoring(): string[] {
  const lines: string[] = [];
  const sample: ScoreInput = {
    title: "Software intern",
    location: "Montréal",
    workplaceType: "hybrid",
    companyCity: "Montréal",
    description:
      "TypeScript, React and PostgreSQL. Winter 2027. English and French. Internship.",
  };

  const a = scoreJob(sample);
  const b = scoreJob(sample);
  if (a.total.toString() !== b.total.toString() || a.explanation !== b.explanation) {
    throw new Error("same posting scored twice and disagreed");
  }
  lines.push(`identical inputs → identical total ${a.percent}`);

  const skillsHeavy: ScoreInput = {
    title: "Software intern",
    location: "Canada",
    workplaceType: "hybrid",
    companyCity: null,
    description: "TypeScript React PostgreSQL. Winter 2027 intern. English French.",
  };
  const locationHeavy: ScoreInput = {
    title: "Software intern",
    location: "Montréal",
    workplaceType: "hybrid",
    companyCity: "Montréal",
    description: "Python Java Vue Angular Docker Kubernetes. Winter 2027 intern. English French.",
  };

  const defaultOrder = [scoreJob(skillsHeavy), scoreJob(locationHeavy)];
  if (!defaultOrder[0].total.greaterThan(defaultOrder[1].total)) {
    throw new Error("expected the skills-heavy posting to rank first with default weights");
  }
  lines.push(
    `default weights: skills-heavy ${defaultOrder[0].percent} > location-heavy ${defaultOrder[1].percent}`,
  );

  const swapped: Weights = {
    skills: 0.1,
    location: 0.55,
    timing: 0.15,
    language: 0.1,
    level: 0.1,
  };
  const swappedOrder = [scoreJob(skillsHeavy, swapped), scoreJob(locationHeavy, swapped)];
  if (!swappedOrder[1].total.greaterThan(swappedOrder[0].total)) {
    throw new Error("expected the location-heavy posting to rank first after swapping weights");
  }
  lines.push(
    `location-weighted: location-heavy ${swappedOrder[1].percent} > skills-heavy ${swappedOrder[0].percent}`,
  );

  return lines;
}
