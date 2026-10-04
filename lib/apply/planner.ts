// Fields in, decisions out. No browser and no database here, so the whole
// decision layer can be tested against fixture forms offline.

import { usableCompanyFact } from "../letter";
import type { CompanyDossier } from "../research";
import { answerQuestion, type AnswerContext } from "./answers/engine";
import { blockingFailures, type LintCheck } from "./answers/humanize";
import { classifyField } from "./classify";
import { applyMemory, memoryKey, rememberable, type RememberedAnswer } from "./memory";
import { resolveField, type FileContext, type JobContext } from "./resolve";
import type { CandidateProfile } from "./candidate";
import type { FieldDecision, FormField, Lang } from "./types";

export type PlanContext = {
  candidate: CandidateProfile;
  job: JobContext;
  files: FileContext;
  answers: AnswerContext;
  autoApprove: boolean;
  /** PORTAL_AUTO_CONFIRM_PERSONAL=true: personal answers from the bank and the application's own consent box need no click. */
  autoConfirm?: boolean;
  /** Which page of a multi-step form the fields are on (1 = the first). */
  step?: number;
  /** Answers you gave on earlier forms, by question key (lib/apply/memory-store.ts loadAnswerMemory). */
  memory?: Map<string, RememberedAnswer>;
};

export async function planField(field: FormField, ctx: PlanContext): Promise<FieldDecision> {
  const intent = classifyField(field);
  const common = { signature: field.signature, label: field.label, kind: field.kind, required: field.required, options: field.options, intent, step: ctx.step ?? 1 };
  if (intent === "open_question") {
    const a = await answerQuestion(field, ctx.answers);
    const passes = a.status === "generated" && blockingFailures(a.checks as LintCheck[]).length === 0;
    if (ctx.autoApprove && passes) {
      return { ...common, ...a, status: "approved", reason: `${a.reason} Auto-approved (PORTAL_AUTO_APPROVE_ANSWERS=true).` };
    }
    return { ...common, ...a };
  }
  const r = resolveField(field, intent, ctx.candidate, ctx.job, ctx.files, { autoConfirm: ctx.autoConfirm });
  // A question the desk cannot answer from your data, but that you answered on an earlier form: the same answer again.
  if ((r.status === "manual" || (r.status === "skipped" && field.required)) && ctx.memory && rememberable(intent, field.kind)) {
    const key = memoryKey(field.label, ctx.job.companyName);
    const remembered = ctx.memory.get(key);
    const value = remembered ? applyMemory(field, remembered) : null;
    if (remembered && value) {
      const when = remembered.updatedAt.toISOString().slice(0, 10);
      return {
        ...common,
        value,
        source: "user",
        status: "resolved",
        reason: `Your own answer to this question on an earlier form (${when}), used again.`,
        checks: [],
        memoryKey: key,
      };
    }
  }
  return { ...common, ...r, checks: [] };
}

export async function planFields(fields: FormField[], ctx: PlanContext): Promise<FieldDecision[]> {
  const out: FieldDecision[] = [];
  // Sequential on purpose: written answers go to the model one at a time, each with full context.
  for (const f of fields) out.push(await planField(f, ctx));
  return out;
}

/** What a person approved on an earlier plan of the same form is kept, field by field. */
export function mergeApprovals(
  decisions: FieldDecision[],
  previous: Array<{ signature: string; status: string; value: string | null; source: string }>,
): FieldDecision[] {
  const approved = new Map(previous.filter((p) => p.status === "approved").map((p) => [p.signature, p]));
  return decisions.map((d) => {
    const prev = approved.get(d.signature);
    if (!prev) return d;
    return { ...d, value: prev.value, status: "approved", source: prev.source as FieldDecision["source"], reason: "Approved by you on an earlier plan." };
  });
}

/** Company facts for the answer engine, best first, each only if it is a real statement about the company. */
export function companyNotes(dossier: CompanyDossier | null, companyName: string, lang: Lang): string[] {
  if (!dossier) return [];
  const notes: string[] = [];
  const fact = usableCompanyFact(dossier.company_fact, { lang, companyName }) ?? usableCompanyFact(dossier.company_fact, { lang: lang === "en" ? "fr" : "en", companyName });
  if (fact) notes.push(`Fact (source ${dossier.company_fact_source}): ${fact}`);
  if (dossier.model && dossier.model !== "heuristic" && dossier.summary) notes.push(`Research summary: ${dossier.summary}`);
  for (const s of dossier.signals ?? []) {
    if (!/^Actively hiring for/i.test(s.signal)) notes.push(`Signal (${s.source}): ${s.signal}`);
  }
  return notes;
}
