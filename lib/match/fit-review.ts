// A reviewer's read of one posting against the candidate (career-ops' rubric idea): a grade from 1 to 5 with a reason
// per dimension, and the red flags quoted from the posting itself. The match score (lib/score.ts) counts skills and
// places; this reads what a score cannot, such as "open to university students only" for a college student, a term
// that does not fit, or a role that is an internship in name only. The batch skips a posting graded under
// AUTO_APPLY_MIN_GRADE (default 3; 0 turns it off). One cheap model call per posting, kept in job_reviews.

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createMessage, pickModel, tokenLimit } from "../claude";
import { pool } from "../db";
import type { CandidateProfile } from "../apply/candidate";
import { norm } from "../apply/text";

export type FitDimension = { name: string; score: number; note: string };
export type RedFlag = { flag: string; quote: string };
export type FitReview = { grade: number; verdict: string; dimensions: FitDimension[]; redFlags: RedFlag[]; model: string | null };

export type ReviewJob = { id: string; title: string; companyName: string; location: string | null; description: string | null };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grade", "verdict", "dimensions", "red_flags"],
  properties: {
    grade: { type: "number", description: "1 (do not apply) to 5 (excellent fit)" },
    verdict: { type: "string", description: "One sentence, in plain words." },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "score", "note"],
        properties: { name: { type: "string" }, score: { type: "number" }, note: { type: "string" } },
      },
    },
    red_flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["flag", "quote"],
        properties: { flag: { type: "string" }, quote: { type: "string", description: "The posting's own words, copied exactly." } },
      },
    },
  },
} as const;

const SYSTEM = [
  "You review one internship posting for one candidate and say whether applying is worth it.",
  "Score each dimension 1-5 with a short note:",
  "- skills: the posting's core requirements against the candidate's skills and projects",
  "- level: is it really an internship / co-op the candidate can hold? Enrollment rules (university only, a specific co-op program, year of study, graduation window) against the candidate's school and program",
  "- place: location and on-site rules against where the candidate can work",
  "- timing: the term or start date against the candidate's availability",
  "- language: language requirements against the candidate's languages",
  "Then a global grade 1-5 (below 3 = do not apply) and red flags. A red flag needs the posting's exact words as its quote.",
  "A red flag is something that makes the candidate ineligible or clearly mismatched. A requirement the candidate meets (one of two options they have, a skill listed in their skills) is never a red flag.",
  "Quebec schooling: a DEC from a CEGEP or college (e.g. Techniques de l'informatique) is a college diploma, not a university degree and not equivalent to a bachelor's. Only an explicit requirement is a level mismatch for a DEC student: the words bachelor's / baccalauréat / undergraduate degree / university (student, program, co-op), or a named university program. Vague wording ('a degree in a related field', 'nearing the end of a degree in Computer Science or a related discipline', 'final stages of their program', 'S3 or equivalent', 'programme en informatique', 'students') is NOT a mismatch: score level 3 and do not flag it. A posting open to college/CEGEP students, or naming no level, is a fit.",
  "Grade below 3 only for a clear reason quoted from the posting: when in doubt, 3.",
  "Judge only from the text given. Missing information is not a red flag.",
].join("\n");

function candidateBrief(c: CandidateProfile): string {
  return [
    `School: ${c.education.school ?? "?"}; program: ${c.education.program ?? "?"} (${c.education.credential ?? "credential ?"}); graduation: ${c.education.graduation ?? "?"}`,
    `Available from: ${c.availableFrom ?? "?"}; location rule: ${c.locationRule ?? "?"}; city: ${c.city ?? "?"}, ${c.region ?? ""}`,
    `Languages: ${c.languagesText ?? c.languages.join(", ")}`,
    `Work authorization (Canada): ${c.personal.work_authorization ?? "?"}`,
    `Skills: ${c.skills.join(", ")}`,
    `Projects: ${c.projects.map((p) => `${p.name} (${p.tech.join(", ")})`).join("; ")}`,
    `Experience: ${c.experience.map((e) => `${e.title}${e.organization ? ` at ${e.organization}` : ""}`).join("; ") || "none listed"}`,
  ].join("\n");
}

const hashOf = (job: ReviewJob) => createHash("sha256").update(`${job.title}\n${job.description ?? ""}`).digest("hex").slice(0, 32);

function missing(err: unknown): boolean {
  return (err as { code?: string }).code === "42P01";
}

/** The stored review of a job, when its posting text has not changed since. */
export async function storedReview(jobId: string, hash?: string): Promise<FitReview | null> {
  try {
    const { rows } = await pool.query<{ grade: string; verdict: string; dimensions: FitDimension[]; red_flags: RedFlag[]; model: string | null; description_hash: string }>(
      `SELECT grade::text, verdict, dimensions, red_flags, model, description_hash FROM job_reviews WHERE job_id = $1`,
      [jobId],
    );
    const r = rows[0];
    if (!r || (hash && r.description_hash !== hash)) return null;
    return { grade: Number(r.grade), verdict: r.verdict, dimensions: r.dimensions, redFlags: r.red_flags, model: r.model };
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

/** AUTO_APPLY_MIN_GRADE: the batch skips postings graded below it (default 3; 0 = no review). */
export function minGrade(): number {
  const raw = process.env.AUTO_APPLY_MIN_GRADE?.trim();
  const n = raw ? Number(raw) : 3;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 3;
}

/**
 * The review of this posting for this candidate: stored when the posting is unchanged, else asked of the cheap model
 * and stored. Null without an API key or when the model cannot be reached (the batch then goes on without it).
 */
export async function reviewJobFit(job: ReviewJob, candidate: CandidateProfile, opts: { client?: Pick<Anthropic, "messages"> } = {}): Promise<FitReview | null> {
  const hash = hashOf(job);
  const stored = await storedReview(job.id, hash);
  if (stored) return stored;
  if (!opts.client && !process.env.ANTHROPIC_API_KEY?.trim()) return null;
  if (!job.description || job.description.length < 80) return null;

  const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const pick = pickModel("easy", process.env.ANTHROPIC_REVIEW_MODEL);
  let parsed: { grade: number; verdict: string; dimensions: FitDimension[]; red_flags: RedFlag[] };
  try {
    const response = await createMessage(client as Anthropic, pick, {
      max_tokens: tokenLimit(1200, pick.tier),
      // The same posting should get the same grade every time it is read.
      temperature: 0,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `CANDIDATE\n${candidateBrief(candidate)}\n\nPOSTING\n${job.title} at ${job.companyName}${job.location ? ` (${job.location})` : ""}\n${job.description.slice(0, 9000)}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    if (!text) return null;
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  // A red flag stands only on the posting's own words: a quote that is not in the text is dropped, never shown.
  const posting = norm(job.description);
  const redFlags = (parsed.red_flags ?? []).filter((f) => f.quote && posting.includes(norm(f.quote)));
  const review: FitReview = {
    grade: Math.min(5, Math.max(1, Math.round(Number(parsed.grade) * 2) / 2)),
    verdict: String(parsed.verdict ?? "").slice(0, 400),
    dimensions: (parsed.dimensions ?? []).slice(0, 6).map((d) => ({ name: String(d.name), score: Math.min(5, Math.max(1, Number(d.score))), note: String(d.note).slice(0, 300) })),
    redFlags,
    model: pick.model,
  };
  try {
    await pool.query(
      `INSERT INTO job_reviews (job_id, grade, verdict, dimensions, red_flags, description_hash, model)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       ON CONFLICT (job_id) DO UPDATE SET grade = EXCLUDED.grade, verdict = EXCLUDED.verdict, dimensions = EXCLUDED.dimensions,
         red_flags = EXCLUDED.red_flags, description_hash = EXCLUDED.description_hash, model = EXCLUDED.model, reviewed_at = now()`,
      [job.id, review.grade, review.verdict, JSON.stringify(review.dimensions), JSON.stringify(review.redFlags), hash, review.model],
    );
  } catch (err) {
    if (!missing(err)) throw err;
  }
  return review;
}
