-- V16 auto-apply v2: answers remembered across forms, legal answers confirmed once, a fit review per posting, and a
-- tailored CV per application. Safe to re-run. Apply after schema-v15.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v16.sql

-- "Use it automatically": set on the Answers page for work authorization and sponsorship. Once set, a form asking about
-- Canada (or the country you live in) gets that answer without a click; every other personal question still waits.
ALTER TABLE answers ADD COLUMN IF NOT EXISTS auto_use BOOLEAN NOT NULL DEFAULT false;

-- What you answered on one form, reused on the next (AIHawk's answers.json idea). One row per question, worded as a
-- key with the company's name taken out ("have you previously worked at {company}"), so the same question on another
-- employer's form finds it. Personal and self-identification questions are never stored here.
CREATE TABLE IF NOT EXISTS screening_answers (
  key TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  intent TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  lang TEXT CHECK (lang IS NULL OR lang IN ('en', 'fr')),
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  uses INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A reviewer's read of one posting against the CV (career-ops' rubric): a grade from 1 to 5, the reasons, and the red
-- flags with the posting's own words. Kept per job and posting text, so it is read once.
CREATE TABLE IF NOT EXISTS job_reviews (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  grade NUMERIC NOT NULL CHECK (grade BETWEEN 1 AND 5),
  verdict TEXT NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
  red_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  description_hash TEXT NOT NULL,
  model TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The CV made for one application (your real CV's content, reordered for the posting), next to its letter.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tailored_cv_path TEXT;
