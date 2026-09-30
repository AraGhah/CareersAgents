// The match between a posting and the CV. The work is in lib/match/ (the CV profile, the lexicon, the analyzer); this
// module keeps the API the rest of the app already uses: scoreJob() gives the components that are stored in
// job_scores plus the full report, and the pages read the same report the number came from.

import Decimal from "decimal.js";
import skillsFile from "../skills.json";
import weightsFile from "../weights.json";
import { fallbackHaveSkills, skillDictionary } from "./profile";
import { analyzePosting, bandOf as bandFor } from "./match/analyze";
import { buildCvProfile, cvFromSkillNames, type CvProfile, type CvSource } from "./match/cv";
import {
  COMPONENT_NAMES,
  GATING_COMPONENTS,
  type Band,
  type ComponentName,
  type Components,
  type MatchReport,
  type ScoreInput,
  type SkillHit,
  type Weights,
} from "./match/types";

export { COMPONENT_NAMES, GATING_COMPONENTS };
export type { Band, ComponentName, Components, MatchReport, ScoreInput, SkillHit, Weights };
export const bandOf = bandFor;

export type ScoreResult = {
  components: Components;
  weights: Weights;
  found: SkillHit[];
  total: Decimal;
  percent: number;
  /** One decimal: the number the breakdown adds up to. */
  percentPrecise: number;
  gated: boolean;
  band: Band;
  explanation: string;
  report: MatchReport;
};

// ---------------------------------------------------------------------------
// The CV being matched against
// ---------------------------------------------------------------------------

let cv: CvProfile = cvFromSkillNames(skillsFile.have as string[]);

/** The CV the next scores are computed against: what the active CVs say, level by level. */
export function setCvProfile(profile: CvProfile) {
  cv = profile;
}

export function setCvFromSources(sources: CvSource[]) {
  cv = buildCvProfile(sources);
}

export function getCvProfile(): CvProfile {
  return cv;
}

/** A plain list of skills, when nothing richer is known (each counts as "listed"). */
export function setHaveSkills(skills: string[] | null | undefined) {
  cv = cvFromSkillNames(skills && skills.length > 0 ? skills : fallbackHaveSkills());
}

export function getHaveSkills(): string[] {
  return [...cv.skills.keys()];
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

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

/**
 * SQL for "this posting is skipped, whatever its total": one of the gating components is 0. `alias` is the job_scores
 * alias in the query. Shared by every query that lists postings, so a new gate cannot be added in one place only.
 */
export function gatedSql(alias = "s"): string {
  return GATING_COMPONENTS.map((c) => `BOOL_OR(${alias}.component = '${c}' AND ${alias}.raw_value = 0)`).join("\n             OR ");
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The technologies a text names, and whether the CV has them. */
export function findSkills(text: string): SkillHit[] {
  return skillDictionary
    .filter((entry) => entry.regexes.some((re) => re.test(text)))
    .map((entry) => ({ name: entry.name, have: cv.skills.has(entry.name) }));
}

function fmt(value: number): string {
  if (value === 0 || value === 1) return String(value);
  return new Decimal(value).toDecimalPlaces(2).toString();
}

export function explain(components: Components, percent: number): string {
  const parts = COMPONENT_NAMES.map((name) => `${name} ${fmt(components[name])}`);
  const first = `The components are ${parts.join(", ")}.`;
  const gate = GATING_COMPONENTS.filter((name) => components[name] === 0);
  if (gate.length > 0) return `${first} ${gate.join(" and ")} ${gate.length > 1 ? "are" : "is"} 0, so it is skipped no matter what the total is.`;
  if (percent >= 85) return `${first} Total ${percent}, first band.`;
  if (percent >= 70) return `${first} Total ${percent}, second band.`;
  if (percent >= 60) return `${first} Total ${percent}, on the board but behind the first two bands.`;
  return `${first} Total ${percent}, under 60, so it stays hidden by default and is not deleted.`;
}

const LABEL_FR: Record<ComponentName, string> = {
  skills: "compétences",
  concepts: "pratiques",
  role: "poste",
  level: "niveau",
  timing: "période",
  location: "lieu",
  language: "langue",
};

export function explainFr(components: Components, percent: number): string {
  const parts = COMPONENT_NAMES.map((name) => `${LABEL_FR[name]} ${fmt(components[name])}`);
  const first = `Les composantes : ${parts.join(", ")}.`;
  const gate = GATING_COMPONENTS.filter((name) => components[name] === 0);
  if (gate.length > 0) return `${first} ${gate.map((g) => LABEL_FR[g]).join(" et ")} à 0 : offre rejetée, peu importe le total.`;
  if (percent >= 85) return `${first} Total ${percent} : priorité.`;
  if (percent >= 70) return `${first} Total ${percent} : postuler.`;
  if (percent >= 60) return `${first} Total ${percent} : à revoir.`;
  return `${first} Total ${percent} : sous 60, masqué par défaut (non supprimé).`;
}

export function scoreJob(input: ScoreInput, weights: Weights = defaultWeights): ScoreResult {
  const report = analyzePosting(input, cv, weights);
  const components = {} as Components;
  for (const c of report.criteria) components[c.id] = c.score;

  let total = new Decimal(0);
  for (const name of COMPONENT_NAMES) total = total.plus(new Decimal(components[name]).times(weights[name]));

  const found: SkillHit[] = [
    ...report.skills.matched.map((s) => ({ name: s.name, have: true })),
    ...report.skills.related.map((s) => ({ name: s.name, have: false })),
    ...report.skills.missing.map((s) => ({ name: s.name, have: false })),
  ];

  return {
    components,
    weights,
    found,
    total,
    percent: report.percent,
    percentPrecise: report.percentPrecise,
    gated: report.gated,
    band: report.band,
    explanation: explain(components, report.percent),
    report,
  };
}

// ---------------------------------------------------------------------------
// Invariants (npm run score:check: no database)
// ---------------------------------------------------------------------------

export function checkScoring(): string[] {
  const lines: string[] = [];
  const sample: ScoreInput = {
    title: "Software intern",
    location: "Montréal",
    workplaceType: "hybrid",
    companyCity: "Montréal",
    description: "TypeScript, React and PostgreSQL. Winter 2027. English and French. Internship.",
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
  lines.push(`default weights: skills-heavy ${defaultOrder[0].percent} > location-heavy ${defaultOrder[1].percent}`);

  const swapped: Weights = { skills: 0.05, concepts: 0.05, role: 0.1, level: 0.05, timing: 0.1, location: 0.6, language: 0.05 };
  const swappedOrder = [scoreJob(skillsHeavy, swapped), scoreJob(locationHeavy, swapped)];
  if (!swappedOrder[1].total.greaterThan(swappedOrder[0].total)) {
    throw new Error("expected the location-heavy posting to rank first after swapping weights");
  }
  lines.push(`location-weighted: location-heavy ${swappedOrder[1].percent} > skills-heavy ${swappedOrder[0].percent}`);

  return lines;
}
