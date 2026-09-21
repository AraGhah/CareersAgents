export const MESSAGE_CLASSIFICATIONS = [
  "confirmation",
  "rejection",
  "interview",
  "assessment",
  "offer",
  "other",
] as const;

export type MessageClassification = (typeof MESSAGE_CLASSIFICATIONS)[number];

export type ClassifyInput = {
  subject: string;
  snippet: string;
  from: string;
  submittedAt: Date | null;
  occurredAt: Date;
};

export function classifyMessage(input: ClassifyInput): MessageClassification | null {
  const subject = input.subject.toLowerCase();
  const snippet = input.snippet.toLowerCase();
  const text = `${subject}\n${snippet}`;
  const from = input.from.toLowerCase();

  if (
    /\bunfortunately\b|\bnot moving forward\b|\bother candidates\b|\bregrettably\b|\bwill not be progressing\b|\bne (donnons|donnera) pas suite\b|\bcandidature (n['’]a|n a) pas [eé]t[eé] retenue\b/.test(
      text,
    )
  ) {
    return "rejection";
  }

  if (
    /\boffer of employment\b|\bjob offer\b|\bwe are (pleased|happy) to offer\b|\boffre d['’]emploi\b/.test(
      text,
    )
  ) {
    return "offer";
  }

  if (
    /\b(hackerrank|codility|hirevue|take[- ]home|assessment|coding challenge|test technique)\b/.test(
      text,
    )
  ) {
    return "assessment";
  }

  if (
    (/\bschedule\b/.test(text) && /\binterview\b/.test(text)) ||
    /\binterview invitation\b|\binvite you to (an )?interview\b|\bentretien\b/.test(text) ||
    (/\bavailability\b/.test(text) && /\b(call|meeting|interview)\b/.test(text))
  ) {
    return "interview";
  }

  const noReply = /no[-_]?reply|donotreply|do-not-reply|notifications?@|mailer-daemon/.test(from);
  const thanksApplying =
    /\bthank you for (your )?appl/.test(text) ||
    /\bwe (have )?received your appl/.test(text) ||
    /\bmerci (pour|d['’]avoir (soumis|envoy))/.test(text) ||
    /\bnous (avons bien )?(re[cç]u|bien re[cç]u) (votre )?candidature\b/.test(text);

  if (thanksApplying) return "confirmation";

  if (noReply && input.submittedAt) {
    const deltaMs = input.occurredAt.getTime() - input.submittedAt.getTime();
    if (deltaMs >= 0 && deltaMs <= 60 * 60 * 1000) return "confirmation";
  }

  return null;
}

/** Prefer not to move an application backwards. */
const RANK: Record<string, number> = {
  draft: 0,
  ready: 1,
  submitted: 2,
  replied: 3,
  assessment: 4,
  interview: 5,
  offer: 6,
  rejected: 7,
  withdrawn: 7,
};

export function statusFromClassification(
  classification: MessageClassification,
): "replied" | "rejected" | "interview" | "assessment" | "offer" | null {
  switch (classification) {
    case "confirmation":
      return "replied";
    case "rejection":
      return "rejected";
    case "interview":
      return "interview";
    case "assessment":
      return "assessment";
    case "offer":
      return "offer";
    default:
      return null;
  }
}

export function shouldApplyStatus(current: string, next: string): boolean {
  if (current === next) return false;
  if (current === "withdrawn") return false;
  if (current === "rejected" && next !== "offer") return false;
  if (current === "offer") return false;
  return (RANK[next] ?? 0) >= (RANK[current] ?? 0);
}
