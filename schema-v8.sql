-- V8 Dossier / resume foundations. Safe to re-run.
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v8.sql

CREATE TABLE IF NOT EXISTS resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  language TEXT NOT NULL CHECK (language IN ('en', 'fr')),
  label TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT false,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  analyzed_at TIMESTAMPTZ,
  raw_text TEXT,
  profile_json JSONB,
  analysis_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_active_per_lang
  ON resumes (language)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS resumes_uploaded_idx
  ON resumes (uploaded_at DESC);

CREATE TABLE IF NOT EXISTS company_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  researched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary TEXT NOT NULL,
  company_fact TEXT NOT NULL,
  company_fact_source TEXT NOT NULL,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 0,
  model TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS company_dossiers_application_uidx
  ON company_dossiers (application_id)
  WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_dossiers_company_idx
  ON company_dossiers (company_id, researched_at DESC);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
  dossier_id UUID REFERENCES company_dossiers(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('outreach', 'application', 'cover', 'followup')),
  lang TEXT NOT NULL CHECK (lang IN ('en', 'fr')),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  gmail_draft_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_detected_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_drafts_dedupe
  ON outreach_drafts (application_id, kind, lower(to_email))
  WHERE sent_detected_at IS NULL AND gmail_draft_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS outreach_drafts_application_idx
  ON outreach_drafts (application_id, created_at DESC);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL;
