// Prompts for written application answers. Two jobs, in this order: say only
// what is true, then say it the way the candidate would. The material is passed as labelled
// blocks so the model can tell the candidate's own facts from the posting and from company
// notes of uneven quality.

import type { CandidateProfile } from "../candidate";
import type { Lang, QuestionType } from "../types";
import type { LengthTarget } from "./humanize";
import type { StyleProfile } from "./style";

const QUESTION_GUIDE: Record<QuestionType, string> = {
  why_company:
    "Pick one or two concrete things about THIS company from the posting or company notes (what it builds, for whom, a technical problem it has, the stack, how the team works) and connect each to something the candidate actually built or cares about. Name the company. If the notes and posting give nothing concrete about the company, say what draws the candidate to the work described in the posting instead, and do not pretend to know the company.",
  why_fit:
    "Pick two or three requirements that the posting actually lists. For each, give the concrete evidence from the candidate's material: the project, what the candidate did in it, the tool, the honest outcome. Do not list every skill; choose the ones that match. No claims of mastery.",
  about_you:
    "Short and human, like the candidate introducing themself to a person: where the candidate is now (program, school, when available), what kind of work the candidate likes and why, and one concrete project as proof. Not a résumé summary, not a list of adjectives.",
  why_role:
    "Say what in this role's actual work (from the posting) matches what the candidate likes doing, with one concrete example of the candidate doing that kind of work.",
  project:
    "Tell it like a story told to an engineer: the problem, what the candidate built and how, one decision or difficulty, and the honest status (live, in development, academic). Choose the project from the material that best fits the posting.",
  technical:
    "Answer the technical question directly and specifically, using only tools and experience in the candidate's material. If the question asks about a tool the candidate has not used, say so plainly and mention the closest thing the candidate has done, without pretending.",
  strengths:
    "One or two strengths, each shown through something specific the candidate did. No self-praise words.",
  weakness:
    "A real, specific weakness with what the candidate does about it. The answer bank has the candidate's own version; stay close to its substance.",
  teamwork:
    "A specific situation from the candidate's material (e.g. a team project), what the friction was, what the candidate did, and how it turned out.",
  challenge:
    "A specific difficulty from the candidate's material, what the candidate did, and what changed. If the material has no such story, set missing_info.",
  career_goal:
    "Plain and near-term: the internship the candidate wants now and the kind of work the candidate wants to keep doing after graduating. No grand vision.",
  generic:
    "Answer exactly what is asked, specifically, from the material. If the material cannot answer it, set missing_info.",
};

export function systemPrompt(lang: Lang, candidateName: string): string {
  const french =
    lang === "fr"
      ? `
- Write in natural Québec-friendly French. Avoid gendered forms for the first person: no "passionné(e)", "motivé(e)", "ravi(e)", "prêt(e)", "intéressé(e)"; rephrase instead ("ce qui m'intéresse", "j'aimerais").`
      : "";
  return `You write the answer ${candidateName} would type into one question of an internship application form. First person, as ${candidateName}, from ${candidateName}'s real material only.

TRUTH (most important)
- Every fact about ${candidateName} must come from CANDIDATE MATERIAL. Do not invent experience, employers, courses, numbers, tools, dates, awards, hobbies or personal details. Do not upgrade a fact ("in development" stays "in development", "academic" stays "academic").
- A tool that appears in the posting but not in the material is not ${candidateName}'s experience. Never claim it.
- Facts about the company come only from the POSTING or COMPANY NOTES. Notes can be vague or wrong; use a detail only when it is concrete and clearly about this company. Never invent news, products, values, customers or numbers.
- If the question needs information the material does not contain, return an empty answer and explain what is missing in "missing_info". Do not guess, do not write around it.

VOICE
- Sound like a thoughtful third-year student writing to a person, not like a cover-letter template. Plain words, specific nouns, sentences of different lengths.
- Start with the substance. No warm-up ("I am writing to…", "Thank you for…"), no restating the question, no closing summary, no sign-off.
- Professional but relaxed. Confident through specifics, not adjectives. No "passionate", "perfect fit", "dream", superlatives about yourself, or buzzwords (leverage, synergy, cutting-edge, fast-paced, robust, seamless, spearheaded, honed, delve, foster, empower, journey, thrive).
- Avoid the usual generated-text tics: no "Moreover/Furthermore/Additionally", no "not only… but also", no neat groups of three adjectives, no em dashes, no exclamation marks, no bullet points or markdown.
- Never mention AI, prompts, templates, or that the text was prepared for ${candidateName}.
- Follow the STYLE NOTES and the tone of the EXAMPLES, but do not copy their sentences.${french}

Return JSON only, matching the schema.`;
}

function block(title: string, body: string): string {
  return `<${title}>\n${body.trim() || "(none)"}\n</${title}>`;
}

export function candidateMaterial(c: CandidateProfile): string {
  const lang = c.lang;
  const bank = Object.entries(c.bank)
    .filter(([key, b]) => b.category !== "red" && key !== "why_this_company")
    .map(([key, b]) => `${key}: ${(lang === "fr" ? b.fr ?? b.en : b.en ?? b.fr) ?? ""}`)
    .filter((l) => !l.endsWith(": "));
  const projects = c.projects.map((p) => {
    const f = p.facts;
    const facts = f
      ? [f.built[lang], f.contribution[lang], f.outcome[lang], f.action[lang]].join(" ")
      : "";
    return `- ${p.name} (${p.tech.join(", ")})${p.url ? ` ${p.url}` : ""}: ${p.summary} ${facts}`.trim();
  });
  const experience = c.experience.map(
    (e) => `- ${e.title}${e.organization ? `, ${e.organization}` : ""}${e.years ? ` (${e.years})` : ""}: ${e.bullets.join(" ")}`,
  );
  return [
    `Name: ${c.fullName ?? ""}`,
    `Education: ${[c.education.program, c.education.credential, c.education.school].filter(Boolean).join(", ")}; graduating ${c.education.graduation ?? "?"}`,
    `Available from: ${c.availableFrom ?? "?"}. Location: ${c.locationRule ?? c.city ?? "?"}. Languages: ${c.languagesText ?? "?"}`,
    `Skills: ${c.skills.join(", ")}`,
    "",
    "Answer bank (the candidate's own words):",
    ...bank,
    "",
    "Projects:",
    ...projects,
    ...(experience.length ? ["", "Experience (from CV):", ...experience] : []),
    ...(c.resumeText ? ["", "CV text:", c.resumeText.slice(0, 5000)] : []),
  ].join("\n");
}

export function userPrompt(opts: {
  question: string;
  questionType: QuestionType;
  hint: string | null;
  lang: Lang;
  target: LengthTarget;
  candidate: CandidateProfile;
  companyName: string;
  roleTitle: string;
  posting: string | null;
  companyNotes: string[];
  style: StyleProfile;
  feedback?: string[];
}): string {
  const length =
    `${opts.target.min}–${opts.target.max} words` + (opts.target.hardMaxChars ? `, and under ${opts.target.hardMaxChars} characters (hard limit)` : "");
  const examples = opts.style.examples.length
    ? opts.style.examples.map((e, i) => `Example ${i + 1}\nQ: ${e.question}\nA: ${e.answer}`).join("\n\n")
    : "(none yet)";
  return [
    block("CANDIDATE MATERIAL", candidateMaterial(opts.candidate)),
    block("POSTING", `${opts.companyName}: ${opts.roleTitle}\n\n${(opts.posting ?? "").slice(0, 6000)}`),
    block("COMPANY NOTES", opts.companyNotes.join("\n")),
    block("STYLE NOTES", opts.style.descriptor),
    block("EXAMPLES OF THE CANDIDATE'S OWN ANSWERS", examples),
    block(
      "TASK",
      [
        `Question on ${opts.companyName}'s form: "${opts.question}"`,
        opts.hint ? `Helper text under the question: "${opts.hint}"` : "",
        `Language: ${opts.lang === "fr" ? "French" : "English"}. Length: ${length}.`,
        `How to approach it: ${QUESTION_GUIDE[opts.questionType]}`,
        opts.feedback?.length
          ? `Your previous draft was rejected for these reasons; fix them:\n- ${opts.feedback.join("\n- ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}

export const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "facts_used", "missing_info", "confidence"],
  properties: {
    answer: { type: "string", description: "The answer text exactly as it goes into the form. Empty if missing_info is set." },
    facts_used: {
      type: "array",
      items: { type: "string" },
      description: "Each fact the answer relies on, quoted or paraphrased from the material, with where it came from.",
    },
    missing_info: {
      type: ["string", "null"],
      description: "What the material lacks to answer honestly, or null.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
} as const;
