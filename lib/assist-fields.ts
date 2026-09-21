import type { Answer, AnswerCategory } from "./types";

export type FieldKind = "text" | "file" | "skip";

export type FieldPlan = {
  label: string;
  key: string | null;
  category: AnswerCategory | "unknown";
  kind: FieldKind;
  value: string | null;
  action: "fill-green" | "fill-yellow" | "leave-empty-red" | "leave-empty-unknown" | "set-file";
};

type Rule = {
  key: string;
  pattern: RegExp;
  kind?: FieldKind;
  /** Split full_name into first / last when the form asks for one side only. */
  part?: "first" | "last" | "portfolio" | "github" | "linkedin";
};

const RULES: Rule[] = [
  { key: "full_name", pattern: /^(first\s*name|pr[eé]nom)$/i, part: "first" },
  { key: "full_name", pattern: /^(last\s*name|family\s*name|surname|nom( de famille)?)$/i, part: "last" },
  { key: "full_name", pattern: /^(full\s*name|legal\s*name|name|nom complet)$/i },
  { key: "email", pattern: /^(e-?mail|courriel|email address)$/i },
  { key: "phone", pattern: /^(phone|telephone|t[eé]l[eé]phone|mobile|cell)$/i },
  { key: "links", pattern: /linkedin/i, part: "linkedin" },
  { key: "links", pattern: /github/i, part: "github" },
  { key: "links", pattern: /^(website|portfolio|site web|personal website)$/i, part: "portfolio" },
  { key: "school_program", pattern: /(school|university|college|programme|program|degree|dipl[oô]me|c[eé]gep)/i },
  { key: "graduation_date", pattern: /(graduat|dipl[oô]m|fin d['’]etudes|graduation)/i },
  { key: "available_from", pattern: /(availab|start date|date de d[eé]but|disponible)/i },
  { key: "location_rule", pattern: /(location|city|ville|where.*work|relocat)/i },
  { key: "languages", pattern: /(language|langue|bilingual|bilingue)/i },
  { key: "why_this_company", pattern: /(why.*(company|us|coveo|genetec)|pourquoi.*(entreprise|compagnie))/i },
  { key: "why_backend", pattern: /(why.*(role|position|backend)|pourquoi.*(poste|r[oô]le))/i },
  { key: "biggest_project", pattern: /(project|projet|experience|exp[eé]rience)/i },
  { key: "work_authorization", pattern: /(work auth|legally auth|permis de travail|autorisation|eligible to work)/i },
  { key: "salary_expectation", pattern: /(salary|compensation|r[eé]mun[eé]ration|salaire)/i },
  { key: "criminal_record_check", pattern: /(criminal|background check|casier)/i },
  { key: "security_clearance", pattern: /(security clearance|cote de s[eé]curit[eé])/i },
  { key: "self_identification", pattern: /(self[- ]identif|equity|diversity|[eé]quit[eé]|diversit[eé]|gender|race)/i },
  { key: "resume", pattern: /^(resume|cv|curriculum|attach.*resume|t[eé]l[eé]verser.*cv)$/i, kind: "file" },
  { key: "cover_letter", pattern: /(cover\s*letter|lettre de motivation)/i, kind: "file" },
];

function answerText(answers: Answer[], key: string, lang: "en" | "fr"): string | null {
  const row = answers.find((a) => a.key === key);
  if (!row) return null;
  return lang === "fr" ? row.answer_fr ?? row.answer_en : row.answer_en ?? row.answer_fr;
}

function categoryOf(answers: Answer[], key: string): AnswerCategory | "unknown" {
  return answers.find((a) => a.key === key)?.category ?? "unknown";
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function linkFrom(raw: string | null, which: "portfolio" | "github" | "linkedin"): string | null {
  if (!raw) return null;
  const urls = [...raw.matchAll(/https?:\/\/[^\s]+/gi)].map((m) => m[0].replace(/[.,;)]+$/, ""));
  if (which === "github") return urls.find((u) => /github\.com/i.test(u)) ?? null;
  if (which === "linkedin") return urls.find((u) => /linkedin\.com/i.test(u)) ?? null;
  return urls.find((u) => !/github\.com|linkedin\.com/i.test(u)) ?? urls[0] ?? null;
}

export function planField(
  label: string,
  answers: Answer[],
  opts: { lang: "en" | "fr"; resumePath: string | null; coverLetterPath: string | null },
): FieldPlan {
  const rule = RULES.find((r) => r.pattern.test(label.trim()));
  if (!rule) {
    return {
      label,
      key: null,
      category: "unknown",
      kind: "text",
      value: null,
      action: "leave-empty-unknown",
    };
  }

  if (rule.kind === "file" || rule.key === "resume" || rule.key === "cover_letter") {
    const path = rule.key === "cover_letter" ? opts.coverLetterPath : opts.resumePath;
    return {
      label,
      key: rule.key,
      category: "green",
      kind: "file",
      value: path,
      action: path ? "set-file" : "leave-empty-unknown",
    };
  }

  const category = categoryOf(answers, rule.key);
  let value = answerText(answers, rule.key, opts.lang);

  if (rule.part === "first" || rule.part === "last") {
    const split = splitName(answerText(answers, "full_name", opts.lang));
    value = rule.part === "first" ? split.first : split.last;
  } else if (rule.part === "portfolio" || rule.part === "github" || rule.part === "linkedin") {
    value = linkFrom(answerText(answers, "links", opts.lang), rule.part);
  }

  if (category === "red") {
    return { label, key: rule.key, category, kind: "text", value, action: "leave-empty-red" };
  }
  if (category === "yellow") {
    return { label, key: rule.key, category, kind: "text", value, action: "fill-yellow" };
  }
  return { label, key: rule.key, category: "green", kind: "text", value, action: "fill-green" };
}

export function planFields(
  labels: string[],
  answers: Answer[],
  opts: { lang: "en" | "fr"; resumePath: string | null; coverLetterPath: string | null },
): FieldPlan[] {
  return labels.map((label) => planField(label, answers, opts));
}

/** Labels that look like a final submit control — we never click these. */
export function looksLikeSubmit(label: string): boolean {
  const t = label.trim();
  // Bare "Apply" / "Postuler" often only opens the Greenhouse form. Leave those clickable.
  // Block the final send actions.
  return /^(submit|submit application|send application|send|soumettre|envoyer|envoyer la candidature)$/i.test(
    t,
  );
}
