// Where one application run is, as an explicit state, so the desk (and you, on the run's record) know exactly which step it
// reached instead of inferring it from the last log line. The runner and the account step report each state as they enter
// it; every transition is appended to the run's journal (portal_runs.flow_state / flow_log, schema-v18.sql) with the page
// it happened on, so a run that stops can be diagnosed and picked up from the same point.
//
// The coarse RunState (lib/apply/types.ts) stays what lists and queues read; this is the detailed trail under it.

export const FLOW_STATES = [
  "FOUND_JOB",
  "OPENED_APPLICATION",
  "PLATFORM_DETECTED",
  "AUTH_REQUIRED",
  "CHECKING_EXISTING_ACCOUNT",
  "SIGNING_IN",
  "REGISTERING_ACCOUNT",
  "EMAIL_VERIFICATION_REQUIRED",
  "AUTHENTICATED",
  "APPLYING_WITHOUT_ACCOUNT",
  "APPLICATION_FORM",
  "UPLOADING_DOCUMENTS",
  "ANSWERING_QUESTIONS",
  "READY_FOR_REVIEW",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "FAILED",
  "MANUAL_INTERVENTION_REQUIRED",
] as const;

export type FlowState = (typeof FLOW_STATES)[number];

/** States the run can end in: nothing follows them in the same run. */
export const TERMINAL: ReadonlySet<FlowState> = new Set<FlowState>(["SUBMITTED", "FAILED", "MANUAL_INTERVENTION_REQUIRED", "READY_FOR_REVIEW", "READY_FOR_SUBMISSION"]);

const AUTH: FlowState[] = ["CHECKING_EXISTING_ACCOUNT", "SIGNING_IN", "REGISTERING_ACCOUNT", "EMAIL_VERIFICATION_REQUIRED", "AUTHENTICATED", "APPLYING_WITHOUT_ACCOUNT"];
const FORM: FlowState[] = ["APPLICATION_FORM", "UPLOADING_DOCUMENTS", "ANSWERING_QUESTIONS"];
const END: FlowState[] = ["READY_FOR_REVIEW", "READY_FOR_SUBMISSION", "SUBMITTED", "FAILED", "MANUAL_INTERVENTION_REQUIRED"];

/** Which states may follow which. Anything may end the run (FAILED, MANUAL_INTERVENTION_REQUIRED). */
const NEXT: Record<FlowState, FlowState[]> = {
  FOUND_JOB: ["OPENED_APPLICATION"],
  OPENED_APPLICATION: ["PLATFORM_DETECTED"],
  PLATFORM_DETECTED: ["AUTH_REQUIRED", ...FORM, ...END],
  AUTH_REQUIRED: AUTH,
  CHECKING_EXISTING_ACCOUNT: AUTH,
  SIGNING_IN: AUTH,
  REGISTERING_ACCOUNT: AUTH,
  // A verified link or code leads back to the sign-in, then in.
  EMAIL_VERIFICATION_REQUIRED: AUTH,
  AUTHENTICATED: ["AUTH_REQUIRED", ...FORM, ...END],
  APPLYING_WITHOUT_ACCOUNT: ["AUTH_REQUIRED", ...FORM, ...END],
  APPLICATION_FORM: [...FORM, ...END],
  UPLOADING_DOCUMENTS: [...FORM, ...END],
  ANSWERING_QUESTIONS: [...FORM, ...END],
  READY_FOR_REVIEW: ["READY_FOR_SUBMISSION", "SUBMITTED", "FAILED", "MANUAL_INTERVENTION_REQUIRED"],
  READY_FOR_SUBMISSION: ["SUBMITTED", "FAILED", "MANUAL_INTERVENTION_REQUIRED"],
  SUBMITTED: [],
  FAILED: [],
  MANUAL_INTERVENTION_REQUIRED: ["SUBMITTED"],
};

export function canMove(from: FlowState | null, to: FlowState): boolean {
  if (from === null) return to === "FOUND_JOB" || to === "OPENED_APPLICATION";
  if (from === to) return true;
  // Submitted is final: nothing that happens afterwards (a screenshot that fails) changes it.
  if (from === "SUBMITTED") return false;
  if (to === "FAILED" || (to === "MANUAL_INTERVENTION_REQUIRED" && !TERMINAL.has(from))) return true;
  return NEXT[from].includes(to);
}

export type FlowEvent = { state: FlowState; at: string; url: string | null; detail: string | null; unexpected?: true };

/**
 * The run's trail. `to()` records a state (repeating the current one is a no-op unless it carries a new detail); a
 * transition the table does not expect is still recorded, flagged, never thrown: the trail is for diagnosis, and a
 * surprising page is exactly what it should show.
 */
export class FlowTracker {
  private events: FlowEvent[] = [];
  constructor(private readonly sink: (event: FlowEvent, all: FlowEvent[]) => Promise<void> | void = () => undefined) {}

  get state(): FlowState | null {
    return this.events.at(-1)?.state ?? null;
  }

  get history(): readonly FlowEvent[] {
    return this.events;
  }

  async to(state: FlowState, detail: string | null = null, url: string | null = null): Promise<void> {
    const from = this.state;
    if (from === state && !detail) return;
    if (from !== null && TERMINAL.has(from) && !canMove(from, state)) return;
    const event: FlowEvent = { state, at: new Date().toISOString(), url, detail: detail ? detail.slice(0, 400) : null };
    if (!canMove(from, state)) event.unexpected = true;
    this.events.push(event);
    await Promise.resolve(this.sink(event, this.events)).catch(() => undefined);
  }
}

/** The flow state a finished run's coarse state means. */
export function terminalFlowState(state: string): FlowState | null {
  switch (state) {
    case "submitted":
      return "SUBMITTED";
    case "ready_to_submit":
      return "READY_FOR_SUBMISSION";
    case "planned":
      return "READY_FOR_REVIEW";
    case "needs_review":
    case "blocked":
      return "MANUAL_INTERVENTION_REQUIRED";
    case "failed":
      return "FAILED";
    default:
      return null;
  }
}
