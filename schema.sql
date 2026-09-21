-- internship_desk
-- Run once:  psql -U youruser -d internship_desk -f schema.sql

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  ats TEXT,                      -- 'greenhouse' | 'lever' | 'workable' | 'workday' | 'other'
  board_token TEXT,              -- the slug used by that ATS endpoint
  city TEXT,
  is_target BOOLEAN NOT NULL DEFAULT false,
  notes TEXT
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  external_id TEXT NOT NULL,     -- the ATS's own job id
  title TEXT NOT NULL,
  location TEXT,
  workplace_type TEXT,           -- 'onsite' | 'hybrid' | 'remote' | NULL
  url TEXT NOT NULL,
  description TEXT,
  posted_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE (company_id, external_id)
);

CREATE TABLE job_scores (
  job_id UUID NOT NULL REFERENCES jobs(id),
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  component TEXT NOT NULL,       -- 'skills' | 'location' | 'timing' | 'language' | 'level'
  raw_value NUMERIC,
  weight NUMERIC,
  PRIMARY KEY (job_id, scored_at, component)
);

-- Everything factual about me, written by me, never by a model.
CREATE TABLE answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,      -- 'work_authorization', 'graduation_date', 'why_backend'
  category TEXT NOT NULL CHECK (category IN ('green','yellow','red')),
  answer_en TEXT,
  answer_fr TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  tech TEXT[] NOT NULL,
  url TEXT,
  highlight_for TEXT[]           -- 'backend', 'fullstack', 'ai', 'gamedev'
);

CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready','submitted','replied','interview',
                      'assessment','rejected','offer','withdrawn')),
  submitted_at TIMESTAMPTZ,
  resume_path TEXT,
  cover_letter_path TEXT,
  notes TEXT
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT,
  role TEXT,
  email TEXT,
  source_url TEXT NOT NULL,      -- where I FOUND it; no guessed addresses
  verified BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES applications(id),
  gmail_thread_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  subject TEXT,
  snippet TEXT,
  classification TEXT,           -- 'confirmation' | 'rejection' | 'interview' | ...
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id),
  due_on DATE NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','drafted','sent','cancelled')),
  gmail_draft_id TEXT
);

CREATE INDEX ON jobs (company_id, last_seen_at);
CREATE INDEX ON applications (status);
