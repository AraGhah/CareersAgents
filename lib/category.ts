export const ROLE_CATEGORIES = ["backend", "fullstack", "cloud", "ai", "gamedev"] as const;
export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

const RULES: Array<{ category: RoleCategory; pattern: RegExp }> = [
  { category: "gamedev", pattern: /\bgame\b|\bunity\b|\bunreal\b|\bgamedev\b/i },
  {
    category: "cloud",
    pattern: /\bcloud\b|\baws\b|\bazure\b|\bgcp\b|\bdevops\b|\binfrastructure\b|\bkubernetes\b|\bdocker\b/i,
  },
  {
    category: "ai",
    pattern:
      /\bmachine learning\b|\bdeep learning\b|\bllm\b|\bml\b|\bdata science\b|\bnlp\b|\bai\b|\bia\b|\bartificial intelligence\b|\bintelligence artificielle\b/i,
  },
  {
    category: "fullstack",
    pattern: /\bfull[ -]?stack\b|\bfullstack\b|\breact\b.+\bnode\b|\bfront.?end\b.+\bback.?end\b/i,
  },
  {
    category: "backend",
    pattern:
      /\bbackend\b|\bback-end\b|\bapi\b|\bserver(?:-side)?\b|\b\.net\b|\bnode\.?js\b|\bpostgres\b|\bsql\b|\bc#\b|\bjava\b/i,
  },
];

export function detectCategories(title: string, description: string | null): RoleCategory[] {
  const text = `${title}\n${description ?? ""}`;
  const found = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.category);
  if (found.length === 0) return ["backend", "fullstack"];
  return [...new Set(found)];
}

/** Order the focus areas are named in a sentence: the kind of development first, cloud last. */
const FOCUS_ORDER: RoleCategory[] = ["backend", "fullstack", "gamedev", "ai", "cloud"];

/**
 * Up to two categories the posting actually names, or none when it names none —
 * detectCategories falls back to backend/fullstack in that case, which is a fine
 * project filter but not something to claim the role "involves". Matches in the
 * title win over ones that only appear in the description. Full-stack subsumes
 * backend, so the two are never listed together.
 */
export function detectRoleFocuses(title: string, description: string | null, max = 2): RoleCategory[] {
  for (const text of [title, `${title}\n${description ?? ""}`]) {
    const hits = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.category);
    if (hits.length === 0) continue;
    const wanted = hits.includes("fullstack") ? hits.filter((c) => c !== "backend") : hits;
    return FOCUS_ORDER.filter((c) => wanted.includes(c)).slice(0, max);
  }
  return [];
}
