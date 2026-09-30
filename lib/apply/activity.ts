// What counts as "your work" on an application, so a cleanup never removes one. Shared by every script that removes
// applications (dedupe, prune): what the desk did by itself does not count, what you did does.

export const SENT_STATUSES = ["applied", "followup", "interview", "accepted", "rejected", "withdrawn"] as const;
export const OPEN_STATUSES = ["discovered", "qualified", "ready"] as const;

/**
 * SQL: how many things of yours are on the application `a`: an email you approved, put in Gmail or sent; a portal run that
 * went past planning (filling or submitting); an answer you approved; a reply from the company; a follow-up.
 * Not counted: a plan-only portal run (the desk read the form) and an email draft nobody approved.
 */
export const ACTIVITY_SQL = `(
  (SELECT count(*) FROM outreach_drafts o WHERE o.application_id = a.id
     AND (o.approved_at IS NOT NULL OR o.gmail_draft_id IS NOT NULL OR o.sent_at IS NOT NULL OR o.sent_detected_at IS NOT NULL))
  + (SELECT count(*) FROM portal_runs r WHERE r.application_id = a.id AND (r.mode <> 'plan' OR r.submitted_at IS NOT NULL))
  + (SELECT count(*) FROM writing_samples w WHERE w.application_id = a.id)
  + (SELECT count(*) FROM messages m WHERE m.application_id = a.id)
  + (SELECT count(*) FROM followups f WHERE f.application_id = a.id)
)::int`;
