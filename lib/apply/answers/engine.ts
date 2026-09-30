// Written answers for open questions. For each question:
//   1. work out what kind of question it is and how long the answer should be
//   2. draft it from the candidate's material in the candidate's voice (Claude,
//      when ANTHROPIC_API_KEY is set; otherwise the candidate's own bank text
//      where one fits, else manual)
//   3. check the draft mechanically: humanize lint + grounding
//   4. one retry with the failures as feedback; still failing → you decide
// The result is never "approved" here: approval is a person's step (or an
// explicit PORTAL_AUTO_APPROVE_ANSWERS=true, and only for drafts that passed).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createMessage, modelLabel, pickModel, tokenLimit, type Tier } from "../../claude";
import { questionTypeOf } from "../classify";
import type { CandidateProfile } from "../candidate";
import { norm, words } from "../text";
import type { FieldDecision, FormField, Lang, QuestionType } from "../types";
import { checkGrounding, type GroundingCorpus } from "./grounding";
import { blockingFailures, lengthTarget, lintAnswer, type LintCheck } from "./humanize";
import { ANSWER_SCHEMA, systemPrompt, userPrompt } from "./prompts";
import { buildStyleProfile, type WritingSample } from "./style";

const Draft = z.object({
  answer: z.string(),
  facts_used: z.array(z.string()).default([]),
  missing_info: z.string().nullable().default(null),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});
export type DraftAnswer = z.infer<typeof Draft>;

/** The model call, injectable so the checks can run offline. `tier` is the strength the question calls for. */
export type AnswerLLM = (system: string, user: string, opts?: { tier?: Tier }) => Promise<DraftAnswer & { model?: string }>;

export function anthropicLLM(): AnswerLLM | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  const client = new Anthropic({ apiKey: key });
  return async (system, user, opts) => {
    const pick = pickModel(opts?.tier ?? "hard", process.env.ANTHROPIC_ANSWER_MODEL);
    const response = await createMessage(client, pick, {
      max_tokens: tokenLimit(2000, pick.tier),
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA as unknown as Record<string, unknown> } },
    });
    const text = response.content.find((c) => c.type === "text");
    if (!text || text.type !== "text") throw new Error("answer model returned no text");
    // A reply cut off by the token limit is broken JSON: say so, rather than a parse error nobody can act on.
    if (response.stop_reason === "max_tokens") throw new Error("answer model ran out of tokens before finishing the answer");
    return { ...Draft.parse(JSON.parse(text.text)), model: pick.model };
  };
}

/**
 * Questions that have to reason across the posting, the company and the candidate's projects without inventing
 * anything, or that are open-ended, go to the strong model. The rest reword material the desk already holds
 * (strengths, weakness, teamwork, career goal, a short answer) and start on the cheap one.
 */
const HARD_TYPES: ReadonlySet<QuestionType> = new Set(["why_company", "why_fit", "why_role", "about_you", "challenge", "technical"]);
const LONG_ANSWER_WORDS = 200;

export function answerTier(questionType: QuestionType, maxWords: number): Tier {
  return HARD_TYPES.has(questionType) || maxWords > LONG_ANSWER_WORDS ? "hard" : "easy";
}

export type AnswerContext = {
  candidate: CandidateProfile;
  companyName: string;
  roleTitle: string;
  posting: string | null;
  companyNotes: string[];
  corpus: GroundingCorpus;
  samples: WritingSample[];
  llm: AnswerLLM | null;
  applicationId?: string | null;
};

type Answered = Pick<FieldDecision, "value" | "status" | "source" | "reason" | "checks" | "questionType">;

/** Bank keys that are the candidate's own answer to a question type (used as-is only without a model). */
const OWN_ANSWER: Partial<Record<QuestionType, string>> = {
  strengths: "strengths",
  weakness: "weakness",
  teamwork: "teamwork_example",
  career_goal: "career_goal",
  project: "biggest_project",
};

/** Questions whose answer depends on the company, so an old answer cannot be reused. */
const COMPANY_SPECIFIC: ReadonlySet<QuestionType> = new Set(["why_company", "why_fit", "why_role"]);

const OPTIONAL_FILLER = /anything else|additional (information|comments|details)|other (information|comments)|autre chose|commentaires?|informations? suppl[eé]mentaires?/;

function tidy(text: string): string {
  return text
    .trim()
    .replace(/^["“]([\s\S]*)["”]$/, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function similar(a: string, b: string): number {
  const A = new Set(words(a).filter((w) => w.length > 3));
  const B = new Set(words(b).filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  return [...A].filter((w) => B.has(w)).length / Math.max(A.size, B.size);
}

export function checkAnswer(
  text: string,
  opts: { field: FormField; lang: Lang; companyName: string; questionType: QuestionType; corpus: GroundingCorpus },
): LintCheck[] {
  const target = lengthTarget(opts.field);
  const lint = lintAnswer(text, {
    lang: opts.lang,
    target,
    companyName: opts.companyName,
    mustNameCompany: opts.questionType === "why_company",
    question: opts.field.label,
  });
  return [...lint, ...checkGrounding(text, opts.corpus).checks];
}

function verdict(value: string, checks: LintCheck[], source: FieldDecision["source"], okReason: string, qt: QuestionType): Answered {
  const blocking = blockingFailures(checks);
  if (blocking.length) {
    return {
      value,
      status: "manual",
      source,
      reason: `Draft failed: ${blocking.map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ""}`).join("; ")}. Rewrite or fix it.`,
      checks,
      questionType: qt,
    };
  }
  return { value, status: "generated", source, reason: okReason, checks, questionType: qt };
}

export async function answerQuestion(field: FormField, ctx: AnswerContext): Promise<Answered> {
  const qt = questionTypeOf(field.label);
  const lang = ctx.candidate.lang;
  const label = norm(field.label);
  const check = (text: string) =>
    checkAnswer(text, { field, lang, companyName: ctx.companyName, questionType: qt, corpus: ctx.corpus });

  if (!field.required && OPTIONAL_FILLER.test(label)) {
    return { value: null, status: "skipped", source: "none", reason: "Optional \"anything else\" question, left blank rather than filled.", checks: [], questionType: qt };
  }

  // An answer the candidate already approved for the same question is the best source there is, as long as the
  // question does not depend on the company.
  if (!COMPANY_SPECIFIC.has(qt)) {
    const reuse = ctx.samples.find((s) => s.lang === lang && s.question_type === qt && similar(s.question, field.label) >= 0.8);
    if (reuse) {
      return verdict(tidy(reuse.answer), check(reuse.answer), "bank", "Your previously approved answer to the same question.", qt);
    }
  }

  if (!ctx.llm) {
    const key = OWN_ANSWER[qt];
    const row = key ? ctx.candidate.bank[key] : undefined;
    const own = row ? (lang === "fr" ? row.fr ?? row.en : row.en ?? row.fr) : null;
    if (own) {
      return verdict(tidy(own), check(own), "bank", "Your own answer-bank text, unchanged (no ANTHROPIC_API_KEY to tailor it). Read it before approving.", qt);
    }
    return {
      value: null,
      status: "manual",
      source: "none",
      reason: "Written answer needed. Set ANTHROPIC_API_KEY to draft it from your material, or write it yourself.",
      checks: [],
      questionType: qt,
    };
  }

  const style = buildStyleProfile({ samples: ctx.samples, candidate: ctx.candidate, questionType: qt, question: field.label, lang });
  const system = systemPrompt(lang, ctx.candidate.fullName ?? "the candidate");
  let feedback: string[] | undefined;
  let last: { text: string; checks: LintCheck[]; by: string } | null = null;

  // Start with the strength the question calls for. A quick first pass that comes back unusable is redone, once,
  // by the strong model (with what went wrong): that second attempt is the only place the strong model is paid for
  // on a question that looked easy.
  const startTier = answerTier(qt, lengthTarget(field).max);

  for (let attempt = 0; attempt < 2; attempt++) {
    const tier: Tier = attempt === 0 ? startTier : "hard";
    const quickFirstPass = attempt === 0 && tier === "easy";
    const draft = await ctx.llm(
      system,
      userPrompt({
        question: field.label,
        questionType: qt,
        hint: field.hint,
        lang,
        target: lengthTarget(field),
        candidate: ctx.candidate,
        companyName: ctx.companyName,
        roleTitle: ctx.roleTitle,
        posting: ctx.posting,
        companyNotes: ctx.companyNotes,
        style,
        feedback,
      }),
      { tier },
    );
    const by = draft.model ? ` by ${modelLabel(draft.model)}` : "";
    if (draft.missing_info || !draft.answer.trim()) {
      if (quickFirstPass) {
        feedback = [
          `A quicker first pass said the material lacks something (${draft.missing_info ?? "no answer"}). Read the material again: answer only if it truly supports one, otherwise say exactly what is missing.`,
        ];
        continue;
      }
      return {
        value: null,
        status: "manual",
        source: "none",
        reason: `Your material does not cover this${by}: ${draft.missing_info ?? "no answer possible"}. Answer it yourself.`,
        checks: [],
        questionType: qt,
      };
    }
    const text = tidy(draft.answer);
    const checks = check(text);
    last = { text, checks, by };
    const failing = checks.filter((c) => !c.ok && (c.severity === "block" || ["length", "no_stock_phrases", "names_company"].includes(c.id)));
    if (failing.length === 0) {
      if (draft.confidence === "low") {
        if (quickFirstPass) {
          feedback = ["The first pass had low confidence. Verify every claim against the material and keep only what it supports."];
          continue;
        }
        return { value: text, status: "manual", source: "generated", reason: `Drafted${by} with low confidence: check every claim, then approve.`, checks, questionType: qt };
      }
      return verdict(text, checks, "generated", `Drafted${by} from your material (${draft.facts_used.length} facts used). Review, edit if needed, approve.`, qt);
    }
    feedback = failing.map((c) => `${c.label}${c.detail ? `: ${c.detail}` : ""}`);
  }
  return verdict(last!.text, last!.checks, "generated", `Drafted${last!.by} from your material after one revision. Review, edit if needed, approve.`, qt);
}
