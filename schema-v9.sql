-- V9 outreach pipeline. Safe to re-run.
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v9.sql

-- Expand application statuses to the Assisted Mode pipeline.
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;

UPDATE applications SET status = 'discovered' WHERE status = 'draft';
UPDATE applications SET status = 'applied' WHERE status = 'submitted';
UPDATE applications SET status = 'accepted' WHERE status = 'offer';
UPDATE applications SET status = 'followup' WHERE status = 'replied';
UPDATE applications SET status = 'interview' WHERE status = 'assessment';

ALTER TABLE applications
  ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'discovered', 'qualified', 'ready', 'applied',
    'followup', 'interview', 'accepted', 'rejected', 'withdrawn'
  ));

ALTER TABLE applications
  ALTER COLUMN status SET DEFAULT 'discovered';

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ats';

ALTER TABLE outreach_drafts
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS assisted_mode BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  inserted INT NOT NULL DEFAULT 0,
  updated INT NOT NULL DEFAULT 0,
  skipped INT NOT NULL DEFAULT 0,
  scored INT NOT NULL DEFAULT 0,
  qualified INT NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT true,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_runs_application_idx
  ON workflow_runs (application_id, created_at DESC);
