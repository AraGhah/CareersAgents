// Shared shapes of the CV ↔ posting match. lib/score.ts re-exports what the rest of the app already imports from it.

import type { WorkplaceType } from "../types";
import type { RoleBucket } from "./lexicon";

/**
 * What a percent is made of. Each component is 0 to 1 and the total is the weighted sum, so the stored components
 * (job_scores) reproduce the percent exactly. Location, timing and role at 0 skip the posting whatever the total is.
 */
export const COMPONENT_NAMES = ["skills", "concepts", "role", "level", "timing", "location", "language"] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

/** A posting is skipped, not just ranked low, when any of these is 0. */
export const GATING_COMPONENTS: readonly ComponentName[] = ["location", "timing", "role"];

export type Components = Record<ComponentName, number>;
export type Weights = Record<ComponentName, number>;

export type Band = "high" | "mid" | "ok" | "low" | "skip";

export type ScoreInput = {
  title: string;
  location: string | null;
  workplaceType: WorkplaceType | null;
  description: string | null;
  companyCity: string | null;
};

/** The technologies a posting names, and whether the CV has them (kept for the pages that list keywords). */
export type SkillHit = { name: string; have: boolean };

/** Where in the posting something was said: it decides how much it weighs. */
export type Section = "title" | "required" | "responsibility" | "mentioned" | "nice" | "about";

export type MatchedSkill = { name: string; credit: number; section: Section; evidence: string };
export type RelatedSkill = { name: string; via: string; credit: number; section: Section };
export type MissingSkill = { name: string; section: Section };

export type Criterion = {
  id: ComponentName;
  label: string;
  score: number;
  weight: number;
  /** One line: what this component found. */
  verdict: string;
  /** What it is based on, one line each. */
  details: string[];
};

export type Confidence = "high" | "medium" | "low";

export type MatchReport = {
  percent: number;
  /** One decimal: the number the breakdown adds up to. */
  percentPrecise: number;
  gated: boolean;
  gateReasons: string[];
  band: Band;
  confidence: Confidence;
  criteria: Criterion[];
  skills: { matched: MatchedSkill[]; related: RelatedSkill[]; missing: MissingSkill[] };
  concepts: { matched: string[]; missing: string[] };
  role: { bucket: RoleBucket; label: string; score: number };
  cybersecurity: boolean;
  hasDescription: boolean;
  /** Things worth knowing that are not a score: a graduate degree asked, a term that does not fit... */
  notes: string[];
};
