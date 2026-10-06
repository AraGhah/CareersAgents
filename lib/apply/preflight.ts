// The last gate before Submit. Every item is computed from the live page and the
// stored plan, not from what the code meant to do. A single failing "blocking"
// item means no automatic submit: the browser stays open for a person, or the
// run is recorded as blocked.

import type { ResumeChoice } from "./resume-select";
import type { CoverLetter } from "./cover-letter";
import type { CaptchaState } from "./browser/guards";
import type { FillResult } from "./browser/fill";
import type { FieldDecision, PreflightItem } from "./types";

const PLACEHOLDER = /\[[^\]]{1,60}\]|\{\{[^}]+\}\}|\bTODO\b|\bTBD\b|\bXXX+\b|lorem ipsum|\byour name here\b|\bdo not send\b|\bne pas envoyer\b/i;

export type PreflightInput = {
  decisions: FieldDecision[];
  fills: Map<string, FillResult>;
  /** Labels of required fields whose live control is still empty after filling. */
  requiredEmpty: string[];
  resume: ResumeChoice;
  resumeFieldPresent: boolean;
  coverLetter: CoverLetter | null;
  coverLetterUsed: boolean;
  captcha: CaptchaState;
  formErrors: string[];
  duplicate: string | null;
  isTarget: boolean;
  autoApprove: boolean;
  submitRequested: boolean;
  submitEnabled: boolean;
  /** You approved this filled form on /approvals: that is the review a priority company gets. */
  approvedByYou?: boolean;
  /** A multi-step form the run could not take to its last page, and why (the page that needs you). */
  stoppedEarly?: string | null;
};

export function runPreflight(p: PreflightInput): PreflightItem[] {
  const items: PreflightItem[] = [];
  const add = (id: string, ok: boolean, label: string, detail?: string, blocking = true) =>
    items.push({ id, ok, label, detail, blocking });

  add("not_duplicate", !p.duplicate, "Not already applied to", p.duplicate ?? undefined);

  if (p.stoppedEarly) add("all_pages", false, "Every page of the form is completed", p.stoppedEarly);

  add("required_filled", p.requiredEmpty.length === 0, "Every required field has a value", p.requiredEmpty.length ? p.requiredEmpty.join("; ") : undefined);

  const failedFills = [...p.fills.entries()].filter(([, r]) => !r.ok);
  add(
    "read_back",
    failedFills.length === 0,
    "Every value written reads back correctly",
    failedFills.length
      ? failedFills.map(([sig, r]) => `${p.decisions.find((d) => d.signature === sig)?.label ?? sig}: ${r.detail}`).join("; ")
      : undefined,
  );

  const pending = p.decisions.filter(
    (d) => (d.status === "manual" && (d.required || d.value)) || (d.status === "generated" && !p.autoApprove),
  );
  add("nothing_pending", pending.length === 0, "No question left for manual review", pending.length ? pending.map((d) => d.label).join("; ") : undefined);

  const r = p.resume;
  add("resume_selected", !!r.resume && r.fileExists, "Correct CV selected and on disk", r.resume ? `${r.resume.label}: ${r.reason}` : r.reason);
  if (r.resume) add("resume_lang", r.langMatches, "CV language matches the posting", r.reason, false);
  // A form with nowhere to put a CV is not a whole internship application: it is the first step of a
  // multi-step portal (ADP asks for name and email, then the CV), and "submitting" it only starts one.
  add(
    "cv_on_form",
    p.resumeFieldPresent,
    "The form takes your CV (a complete application, not a first step)",
    p.resumeFieldPresent ? undefined : "no CV upload on this page: likely step 1 of a multi-step portal",
  );
  if (p.resumeFieldPresent) {
    const resumeFill = [...p.fills.entries()].find(([sig]) => p.decisions.find((d) => d.signature === sig)?.intent === "resume");
    add("resume_attached", !!resumeFill?.[1].ok, "The CV is attached to the form", resumeFill?.[1].detail);
  }

  if (p.coverLetterUsed) {
    const failing = (p.coverLetter?.checks ?? []).filter((c) => !c.ok);
    add(
      "cover_letter_matches",
      !!p.coverLetter && failing.length === 0,
      "Cover letter matches this company, role and language",
      failing.map((c) => `${c.label} (${c.detail ?? ""})`).join("; ") || undefined,
    );
  }

  // Answers a person typed or rewrote are theirs; drafted ones must still pass their own checks.
  const ungrounded = p.decisions.filter(
    (d) => d.source === "generated" && d.checks.some((c) => !c.ok && (c as { severity?: string }).severity === "block"),
  );
  add("answers_grounded", ungrounded.length === 0, "Written answers contain no invented information", ungrounded.map((d) => d.label).join("; ") || undefined);

  const withPlaceholder = p.decisions.filter((d) => d.value && d.kind !== "file" && PLACEHOLDER.test(d.value));
  add("no_placeholders", withPlaceholder.length === 0, "No placeholder text anywhere", withPlaceholder.map((d) => d.label).join("; ") || undefined);

  add("no_captcha", !p.captcha.challenge, "No CAPTCHA to solve", p.captcha.challenge ? `${p.captcha.kind} challenge: solve it yourself` : p.captcha.present ? `${p.captcha.kind} present (invisible)` : undefined);

  add("no_form_errors", p.formErrors.length === 0, "The form shows no validation errors", p.formErrors.join("; ") || undefined);

  if (p.submitRequested) {
    add("not_target", !p.isTarget || p.approvedByYou === true, "Not a priority company, or approved by you (those are always reviewed by hand)", p.isTarget && !p.approvedByYou ? "is_target company: approve it on /approvals or submit it yourself" : undefined);
    add("submit_enabled", p.submitEnabled, "Submit allowed (your approval, or PORTAL_SUBMIT=auto)", p.submitEnabled ? undefined : "waiting for your approval on /approvals");
  }
  return items;
}

export function preflightPasses(items: PreflightItem[]): boolean {
  return items.every((i) => i.ok || !i.blocking);
}
