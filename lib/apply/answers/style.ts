// The candidate's writing style, learned from text Ara actually wrote: the yellow
// answers in the bank (hand-written, on purpose) and every generated answer Ara
// later approved or rewrote. Edits weigh most: when Ara rewrites an answer, the
// rewrite is the clearest signal of how Ara writes. The profile is two things the
// prompt uses: a few measured traits, and the closest real examples.

import { pool } from "../../db";
import type { CandidateProfile } from "../candidate";
import { norm, sentences, wordCount, words } from "../text";
import type { Lang, QuestionType } from "../types";

export type WritingSample = {
  question: string;
  question_type: QuestionType;
  answer: string;
  lang: Lang;
  source: "approved" | "edited" | "bank";
};

export type StyleProfile = {
  descriptor: string;
  examples: Array<{ question: string; answer: string }>;
  sampleCount: number;
};

/** Which hand-written bank answer is the closest voice reference for a question type. */
const BANK_KEY_FOR: Partial<Record<QuestionType, string[]>> = {
  strengths: ["strengths"],
  weakness: ["weakness"],
  teamwork: ["teamwork_example"],
  career_goal: ["career_goal"],
  project: ["biggest_project"],
  technical: ["biggest_project", "why_backend"],
  why_role: ["why_backend"],
  why_fit: ["strengths", "biggest_project"],
  about_you: ["why_backend", "career_goal"],
  challenge: ["strengths", "teamwork_example"],
  why_company: ["why_backend"],
  generic: ["why_backend"],
};

const BANK_QUESTION: Record<string, string> = {
  strengths: "What are your strengths?",
  weakness: "What is a weakness you are working on?",
  teamwork_example: "Tell us about working in a team.",
  career_goal: "What are your career goals?",
  biggest_project: "What is the project you are most proud of?",
  why_backend: "Why this kind of role?",
};

function overlap(a: string, b: string): number {
  const A = new Set(words(a).filter((w) => w.length > 3));
  const B = new Set(words(b).filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  return [...A].filter((w) => B.has(w)).length / Math.min(A.size, B.size);
}

function describe(texts: string[], lang: Lang): string {
  if (texts.length === 0) return "No samples yet: write plainly, in short, specific sentences.";
  const sents = texts.flatMap(sentences);
  const totalWords = texts.reduce((n, t) => n + wordCount(t), 0);
  const avgSentence = sents.length ? totalWords / sents.length : 16;
  const avgAnswer = totalWords / texts.length;
  const joined = texts.join(" ");
  const contractions = (joined.match(/\b\w+['’](m|re|ve|ll|d|t)\b/gi) ?? []).length / Math.max(1, sents.length);
  const colons = ((joined.match(/[:;]/g) ?? []).length / Math.max(1, totalWords)) * 100;
  const iOpeners = sents.filter((s) => /^(i|je|j['’])\b/i.test(s)).length / Math.max(1, sents.length);
  const dashes = (joined.match(/—/g) ?? []).length;

  const lines = [
    `Sentences average about ${Math.round(avgSentence)} words; answers run about ${Math.round(avgAnswer)} words. Mix a short sentence in with the longer ones.`,
    lang === "en"
      ? contractions < 0.15
        ? "Almost never uses contractions (writes \"I am\", \"it is\")."
        : "Uses contractions naturally (I'm, it's, didn't)."
      : "Écrit un français simple et direct, sans tournures de lettre officielle.",
    colons > 0.8
      ? "Often uses a colon or semicolon to get to the specific thing (\"REST APIs, authentication, databases: …\")."
      : "Rarely uses colons or semicolons.",
    iOpeners > 0.5
      ? "Many sentences start with \"I\"; vary a few by opening with the project or the problem."
      : "Often opens a sentence with the project, the problem or the tool rather than with \"I\".",
    dashes === 0 ? "Never uses em dashes." : "Uses em dashes rarely.",
    "States the concrete thing first (what was built, what went wrong, what changed), with honest status like \"in development\" or \"academic\".",
    "Does not praise itself; lets the specific detail carry the point.",
  ];
  return lines.map((l) => `- ${l}`).join("\n");
}

export function buildStyleProfile(opts: {
  samples: WritingSample[];
  candidate: CandidateProfile;
  questionType: QuestionType;
  question: string;
  lang: Lang;
  maxExamples?: number;
}): StyleProfile {
  const lang = opts.lang;
  const bankSamples: Array<WritingSample & { key?: string }> = Object.entries(opts.candidate.bank)
    .filter(([, b]) => b.category === "yellow")
    .map(([key, b]) => ({
      question: BANK_QUESTION[key] ?? key,
      question_type: (Object.entries(BANK_KEY_FOR).find(([, keys]) => keys?.[0] === key)?.[0] ?? "generic") as QuestionType,
      answer: (lang === "fr" ? b.fr ?? b.en : b.en ?? b.fr) ?? "",
      lang,
      source: "bank" as const,
      key,
    }))
    // The why_this_company bank entry is an instruction to self, not an answer.
    .filter((s) => s.answer && !/do not send|ne pas envoyer|rewrite this|r[ée][ée]cri/i.test(s.answer));

  const own = opts.samples.filter((s) => s.lang === lang);
  const candidates: Array<WritingSample & { key?: string }> = [...own, ...bankSamples];

  const preferredKeys = new Set(BANK_KEY_FOR[opts.questionType] ?? []);
  const score = (s: WritingSample & { key?: string }) =>
    (s.question_type === opts.questionType ? 3 : 0) +
    (s.source === "edited" ? 2 : s.source === "approved" ? 1 : 0) +
    (s.key && preferredKeys.has(s.key) ? 2 : 0) +
    overlap(s.question, opts.question) * 2;

  const seen = new Set<string>();
  const examples = [...candidates]
    .sort((a, b) => score(b) - score(a))
    .filter((s) => {
      const k = norm(s.answer).slice(0, 80);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, opts.maxExamples ?? 3)
    .map((s) => ({ question: s.question, answer: s.answer.slice(0, 900) }));

  return {
    descriptor: describe(candidates.map((s) => s.answer), lang),
    examples,
    sampleCount: own.length,
  };
}

export async function loadWritingSamples(lang: Lang, limit = 60): Promise<WritingSample[]> {
  const { rows } = await pool.query<WritingSample>(
    `SELECT question, question_type, answer, lang, source
       FROM writing_samples
      WHERE lang = $1
      ORDER BY CASE source WHEN 'edited' THEN 0 ELSE 1 END, created_at DESC
      LIMIT $2`,
    [lang, limit],
  );
  return rows;
}

/** Called when Ara approves (as-is) or rewrites a written answer. */
export async function recordWritingSample(opts: {
  question: string;
  questionType: QuestionType;
  answer: string;
  lang: Lang;
  edited: boolean;
  applicationId: string | null;
}): Promise<void> {
  const answer = opts.answer.trim();
  if (wordCount(answer) < 8) return;
  await pool.query(
    `INSERT INTO writing_samples (question, question_type, answer, lang, source, application_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [opts.question, opts.questionType, answer, opts.lang, opts.edited ? "edited" : "approved", opts.applicationId],
  );
}
