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
    pattern: /\bmachine learning\b|\bdeep learning\b|\bllm\b|\bml\b|\bdata science\b|\bnlp\b/i,
  },
  {
    category: "fullstack",
    pattern: /\bfull[ -]?stack\b|\bfullstack\b|\breact\b.+\bnode\b|\bfront.?end\b.+\bback.?end\b/i,
  },
  {
    category: "backend",
    pattern:
      /\bbackend\b|\bback-end\b|\bapi\b|\bserver(?:-side)?\b|\b\.net\b|\bnode\.?js\b|\bpostgres\b|\bsql\b|\bc#\b/i,
  },
];

export function detectCategories(title: string, description: string | null): RoleCategory[] {
  const text = `${title}\n${description ?? ""}`;
  const found = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.category);
  if (found.length === 0) return ["backend", "fullstack"];
  return [...new Set(found)];
}
