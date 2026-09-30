// Shared shapes for the portal-application system (lib/apply/*). Everything the
// browser layer reads, the planner decides, and the store records goes through
// these types, so each module can change without the others noticing.

export type Lang = "en" | "fr";

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "textarea"
  | "date"
  | "month"
  | "select"
  | "combobox"
  | "radio"
  | "checkbox"
  | "checkbox-group"
  | "file";

/** One question on the live form, as the browser layer found it. */
export type FormField = {
  /** Index stamped on the element as data-desk-field; only valid on the page it was read from. */
  index: number;
  signature: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options: string[];
  name: string | null;
  placeholder: string | null;
  maxLength: number | null;
  /** Textarea rows, a rough hint for the expected answer length. */
  rows: number | null;
  /** Helper text printed near the field ("150 words max", "MM/DD/YYYY"). */
  hint: string | null;
  accept: string | null;
};

export type FieldIntent =
  | "first_name"
  | "last_name"
  | "full_name"
  | "preferred_name"
  | "email"
  | "phone"
  | "city"
  | "region"
  | "country"
  | "location"
  | "address"
  | "postal_code"
  | "linkedin"
  | "github"
  | "portfolio"
  | "website"
  | "school"
  | "degree"
  | "discipline"
  | "graduation_date"
  | "graduation_year"
  | "education_start"
  | "gpa"
  | "available_from"
  | "internship_term"
  | "internship_duration"
  | "languages"
  | "language_level_en"
  | "language_level_fr"
  | "how_heard"
  | "relocation"
  | "onsite_ok"
  | "skill_yes_no"
  | "years_experience"
  | "resume"
  | "cover_letter_file"
  | "cover_letter_text"
  | "transcript"
  | "other_file"
  // Always a person's decision; never filled by the desk.
  | "work_authorization"
  | "sponsorship"
  | "legal_declaration"
  | "consent"
  | "sensitive"
  | "demographic"
  | "salary"
  | "previous_employment"
  | "referral"
  // Written answers.
  | "open_question"
  | "unknown";

/** The written-answer families the engine knows how to approach. */
export type QuestionType =
  | "why_company"
  | "why_fit"
  | "about_you"
  | "why_role"
  | "project"
  | "technical"
  | "strengths"
  | "weakness"
  | "teamwork"
  | "challenge"
  | "career_goal"
  | "generic";

export type FieldStatus = "resolved" | "generated" | "approved" | "manual" | "skipped" | "filled" | "failed";

export type FieldSource = "bank" | "profile" | "derived" | "generated" | "file" | "user" | "none";

export type Check = { id: string; ok: boolean; label: string; detail?: string };

/** What the planner decided for one field. */
export type FieldDecision = {
  signature: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options: string[];
  intent: FieldIntent;
  source: FieldSource;
  value: string | null;
  status: FieldStatus;
  reason: string;
  checks: Check[];
  questionType?: QuestionType;
};

export type RunMode = "plan" | "review" | "submit";

export type RunState =
  | "planning"
  | "needs_review"
  | "planned"
  | "filling"
  | "ready_to_submit"
  | "submitted"
  | "blocked"
  | "failed"
  | "duplicate";

export type PlatformId = "greenhouse" | "lever" | "workable" | "ashby" | "generic";

export type PreflightItem = Check & { blocking: boolean };
