export const APPLICATION_STATUSES = [
  "discovered",
  "qualified",
  "ready",
  "applied",
  "followup",
  "interview",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Dashboard pipeline columns (Assisted Mode). */
export const PIPELINE_STATUSES = APPLICATION_STATUSES;

export const WORKPLACE_TYPES = ["onsite", "hybrid", "remote"] as const;

export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export type AnswerCategory = "green" | "yellow" | "red";

export type Company = {
  id: string;
  name: string;
  website: string | null;
  ats: string | null;
  board_token: string | null;
  city: string | null;
  is_target: boolean;
  notes: string | null;
};

export type JobRow = {
  id: string;
  title: string;
  location: string | null;
  workplace_type: WorkplaceType | null;
  url: string;
  posted_at: Date | null;
  first_seen_at: Date;
  closed_at: Date | null;
  company_id: string;
  company_name: string;
  /** Short description excerpt for list filters — only set by listJobs. */
  description_preview?: string | null;
  application_id: string | null;
  status: ApplicationStatus | null;
  score: string | null;
  gated: boolean | null;
};

export type ScoreComponent = {
  component: string;
  raw_value: string;
  weight: string;
};

export type JobDetail = JobRow & {
  description: string | null;
  last_seen_at: Date;
  external_id: string;
  company_city: string | null;
  components: ScoreComponent[];
};

export type ApplicationDetail = {
  id: string;
  status: ApplicationStatus;
  submitted_at: Date | null;
  resume_path: string | null;
  cover_letter_path: string | null;
  resume_id: string | null;
  notes: string | null;
  job_id: string;
  title: string;
  location: string | null;
  workplace_type: WorkplaceType | null;
  url: string;
  description: string | null;
  posted_at: Date | null;
  closed_at: Date | null;
  company_id: string;
  company_name: string;
  company_website: string | null;
  company_city: string | null;
};

export type Answer = {
  id: string;
  key: string;
  category: AnswerCategory;
  answer_en: string | null;
  answer_fr: string | null;
  updated_at: Date;
};

export type Project = {
  id: string;
  name: string;
  summary: string;
  tech: string[];
  url: string | null;
  highlight_for: string[] | null;
};
