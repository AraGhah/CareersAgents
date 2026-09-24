import { detectCategories } from "./category";

export const INTERNSHIP_CATEGORIES = [
  "software-developer",
  "software-engineer",
  "full-stack-developer",
  "back-end-developer",
] as const;

export type InternshipCategory = (typeof INTERNSHIP_CATEGORIES)[number];

export const INTERNSHIP_CATEGORY_LABEL_FR: Record<InternshipCategory, string> = {
  "software-developer": "Développeur logiciel",
  "software-engineer": "Ingénieur logiciel",
  "full-stack-developer": "Développeur Full-Stack",
  "back-end-developer": "Développeur Back-End",
};

const RULES: Array<{ category: InternshipCategory; pattern: RegExp }> = [
  { category: "full-stack-developer", pattern: /\bfull[ -]?stack\b/i },
  { category: "back-end-developer", pattern: /\bback[ -]?end\b/i },
  { category: "software-engineer", pattern: /\bsoftware engineer\b|\bingénieur(?:e)?\s+logiciel\b/i },
  { category: "software-developer", pattern: /\bsoftware developer\b|\bdéveloppeur(?:se)?\s+logiciel\b/i },
];

/**
 * Ranked (most specific first) list of candidate categories for a posting.
 * Falls back onto the existing backend/fullstack job-content axis
 * (lib/category.ts) when the posting doesn't literally name a category, so
 * there's always at least one candidate for resume resolution to try.
 */
export function detectInternshipCategories(
  title: string,
  description: string | null,
): InternshipCategory[] {
  const text = `${title}\n${description ?? ""}`;
  const found = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.category);
  if (found.length > 0) return [...new Set(found)];

  const legacy = detectCategories(title, description);
  if (legacy.includes("fullstack")) return ["full-stack-developer"];
  if (legacy.includes("backend")) return ["back-end-developer"];
  return ["software-developer"];
}

export function isInternshipCategory(value: string | null | undefined): value is InternshipCategory {
  return !!value && (INTERNSHIP_CATEGORIES as readonly string[]).includes(value);
}
