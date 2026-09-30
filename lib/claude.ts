// Which Claude model the desk calls, and how hard it thinks, chosen by how hard the task is.
//
//   hard  a task that has to reason across several sources and not invent anything: a company-specific answer
//         ("why us", "why are you a good fit"), a long or open one. Sonnet 5.5, at high effort.
//   easy  a task that rewords material the desk already has, or extracts from a page: a short answer, a strengths
//         or teamwork question, the company research. Haiku 4.5, which uses far fewer tokens and costs a fraction.
//
// The caller starts with the tier its task calls for and moves to "hard" only when the first result was not good
// enough (a draft that fails the desk's own checks, a fact nobody can use), so the strong model is paid for
// where it changes the outcome.
//
//   ANTHROPIC_MODEL_HARD    default claude-sonnet-5-5
//   ANTHROPIC_MODEL_EASY    default claude-haiku-4-5-20251001
//   ANTHROPIC_EFFORT        effort of the hard model: low | medium | high | xhigh | max (default high)
//   ANTHROPIC_EFFORT_EASY   effort of the easy model, when it supports one (default: none)
//   ANTHROPIC_ANSWER_MODEL / ANTHROPIC_RESEARCH_MODEL pin one use to one model, whatever the task
// To use one model for everything, set ANTHROPIC_MODEL_EASY to the same value as ANTHROPIC_MODEL_HARD.

import type Anthropic from "@anthropic-ai/sdk";

export type Tier = "easy" | "hard";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const DEFAULT_MODELS: Record<Tier, string> = { hard: "claude-sonnet-5-5", easy: "claude-haiku-4-5-20251001" };

export type ModelPick = { tier: Tier; model: string; effort: Effort | null };

function effortFrom(value: string | undefined): Effort | null {
  const v = value?.trim().toLowerCase();
  return EFFORTS.find((e) => e === v) ?? null;
}

/** The model and effort for a task of this tier. `pinned` (a per-use override) wins over the tiers. */
export function pickModel(tier: Tier, pinned?: string): ModelPick {
  const hardEffort = effortFrom(process.env.ANTHROPIC_EFFORT) ?? "high";
  if (pinned?.trim()) return { tier, model: pinned.trim(), effort: hardEffort };
  if (tier === "hard") return { tier, model: process.env.ANTHROPIC_MODEL_HARD?.trim() || DEFAULT_MODELS.hard, effort: hardEffort };
  return { tier, model: process.env.ANTHROPIC_MODEL_EASY?.trim() || DEFAULT_MODELS.easy, effort: effortFrom(process.env.ANTHROPIC_EFFORT_EASY) };
}

/**
 * At high effort the model thinks before it answers, and that thinking counts against max_tokens: a limit sized
 * for the answer alone can end the reply in the middle of a JSON object. The easy tier does not think.
 */
export function tokenLimit(answerTokens: number, tier: Tier): number {
  return tier === "hard" ? answerTokens + 6000 : answerTokens;
}

/** "claude-haiku-4-5-20251001" → "Haiku 4.5", "claude-sonnet-5-5" → "Sonnet 5.5". */
export function modelLabel(model: string): string {
  const m = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** Models that turned an effort setting down. Haiku 4.5 does, so it is never sent one; any other is learned once. */
const rejectsEffort = new Set<string>();

type Params = Omit<Anthropic.MessageCreateParamsNonStreaming, "model">;

const usage = new Map<string, { calls: number; input: number; output: number }>();

function record(model: string, u: { input_tokens: number; output_tokens: number }) {
  const row = usage.get(model) ?? { calls: 0, input: 0, output: 0 };
  row.calls += 1;
  row.input += u.input_tokens;
  row.output += u.output_tokens;
  usage.set(model, row);
}

/** One line on what this process asked of Claude, by model, or null when it asked nothing. */
export function usageSummary(): string | null {
  if (usage.size === 0) return null;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return `Claude: ${[...usage.entries()]
    .map(([model, u]) => `${modelLabel(model)} ×${u.calls} (${k(u.input)} in, ${k(u.output)} out)`)
    .join(" · ")}`;
}

/** Sends the request to the picked model with its effort, dropping the effort for a model that does not take one. */
export async function createMessage(client: Anthropic, pick: ModelPick, params: Params): Promise<Anthropic.Message> {
  const send = (effort: Effort | null) =>
    client.messages.create({ ...params, model: pick.model, output_config: { ...params.output_config, ...(effort ? { effort } : {}) } });

  const effort = pick.effort && !/haiku/i.test(pick.model) && !rejectsEffort.has(pick.model) ? pick.effort : null;
  try {
    const response = await send(effort);
    record(pick.model, response.usage);
    return response;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (effort && status === 400 && /effort/i.test(String((err as Error).message))) {
      rejectsEffort.add(pick.model);
      const response = await send(null);
      record(pick.model, response.usage);
      return response;
    }
    throw err;
  }
}
