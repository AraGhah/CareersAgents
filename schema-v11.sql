-- V11 portal applications: the automatic form-filling path for postings with no
-- published contact. Safe to re-run. Apply after schema-v10.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v11.sql

-- How an application goes out. 'email' = a published contact exists (the V8/V9
-- outreach flow); 'portal' = no contact, the company's online form; 'manual' = a
-- portal the desk cannot drive (login wall, Workday account, LinkedIn Easy Apply).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS channel TEXT;
DO $$ BEGIN
  ALTER TABLE applications ADD CONSTRAINT applications_channel_check
    CHECK (channel IS NULL OR channel IN ('email', 'portal', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The company's own application form for a posting found elsewhere. An Indeed or
-- LinkedIn listing points at the job board; this is where the form actually is
-- (Indeed's "apply on company site" link). NULL = the posting URL is the form.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_url TEXT;

-- One row per attempt at a portal application. The company/role/url columns are
-- a snapshot, so the record stays true even if the job row is re-scraped later.
CREATE TABLE IF NOT EXISTS portal_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('plan', 'review', 'submit')),
  state TEXT NOT NULL DEFAULT 'planning' CHECK (state IN (
    'planning',        -- reading the form
    'needs_review',    -- answers or manual fields wait for you
    'planned',         -- every field resolved and approved, ready to execute
    'filling',         -- browser is filling the form
    'ready_to_submit', -- filled + validated, Submit left for you
    'submitted',       -- the portal confirmed the application
    'blocked',         -- CAPTCHA, login wall, legal/sensitive question, failed gate
    'failed',          -- an error; see portal_errors
    'duplicate'        -- already applied, nothing was done
  )),
  platform TEXT,
  posting_url TEXT NOT NULL,
  form_url TEXT,
  company_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  lang TEXT CHECK (lang IN ('en', 'fr')),
  resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
  resume_path TEXT,
  resume_reason TEXT,
  cover_letter_path TEXT,
  cover_letter_required BOOLEAN NOT NULL DEFAULT false,
  field_count INT NOT NULL DEFAULT 0,
  required_count INT NOT NULL DEFAULT 0,
  manual_count INT NOT NULL DEFAULT 0,
  preflight JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_reason TEXT,
  error TEXT,
  screenshot_path TEXT,
  confirmation_text TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS portal_runs_application_idx
  ON portal_runs (application_id, started_at DESC);

-- A second submitted run for the same application is refused by the database,
-- not only by the code.
CREATE UNIQUE INDEX IF NOT EXISTS portal_runs_one_submitted
  ON portal_runs (application_id) WHERE state = 'submitted';

-- Every field the form asked for and what the desk did with it. `signature` is a
-- stable key (normalized label + kind) so a plan made headless can be matched to
-- the live form again at execute time.
CREATE TABLE IF NOT EXISTS portal_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES portal_runs(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  intent TEXT NOT NULL,
  source TEXT NOT NULL,          -- 'bank' | 'profile' | 'derived' | 'generated' | 'file' | 'user' | 'none'
  value TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'resolved',      -- deterministic value from your data
    'generated',     -- written answer, passed checks, waits for approval
    'approved',      -- you approved (or edited) it
    'manual',        -- needs you: legal, sensitive, unknown, unavailable
    'skipped',       -- optional and nothing true to put there
    'filled',        -- written to the live form and read back
    'failed'         -- could not be written or read back
  )),
  reason TEXT,
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  edited BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  UNIQUE (run_id, signature)
);

CREATE TABLE IF NOT EXISTS portal_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  run_id UUID REFERENCES portal_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_errors_created_idx ON portal_errors (created_at DESC);

-- The candidate's own voice: answers you approved or rewrote. The answer engine
-- reads the closest ones back as examples, so later answers sound like you.
CREATE TABLE IF NOT EXISTS writing_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  question_type TEXT NOT NULL,
  answer TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'fr')),
  source TEXT NOT NULL CHECK (source IN ('approved', 'edited')),
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS writing_samples_type_idx ON writing_samples (question_type, lang, created_at DESC);
