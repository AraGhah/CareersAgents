-- V13 auto-apply: the "Postuler automatiquement" button. One run = one click ("apply to N internships"),
-- one item per application it worked on. Safe to re-run. Apply after schema-v12.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v13.sql

CREATE TABLE IF NOT EXISTS auto_apply_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested INT NOT NULL CHECK (requested BETWEEN 1 AND 50),
  -- Lowest match score (percent) a posting needs to be considered.
  min_score INT NOT NULL CHECK (min_score BETWEEN 0 AND 100),
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN (
    'running',  -- a background process is working through the list
    'done',     -- reached the number asked for, or ran out of eligible postings
    'stopped',  -- you pressed Stop
    'failed'    -- an error nobody can retry past (Gmail disconnected), or the process died
  )),
  stop_requested BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Touched while the process works, so a run whose process died is recognised instead of showing "running" forever.
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auto_apply_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES auto_apply_runs(id) ON DELETE CASCADE,
  -- Order the postings were tried in: best score first.
  position INT NOT NULL,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  score NUMERIC,
  channel TEXT CHECK (channel IS NULL OR channel IN ('email', 'portal', 'manual')),
  outcome TEXT NOT NULL DEFAULT 'working' CHECK (outcome IN (
    'working', -- being prepared right now
    'draft',   -- the Gmail draft is ready, CV and cover letter attached: you press Send
    'sent',    -- the desk submitted the online form and the portal confirmed it
    'review',  -- the form was filled but something waits for you (an answer, a CAPTCHA, the daily limit)
    'skipped', -- nothing to do: a form the desk does not drive, a duplicate, a closed posting
    'failed'   -- an error; the detail says which
  )),
  detail TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (run_id, application_id)
);

CREATE INDEX IF NOT EXISTS auto_apply_items_run_idx ON auto_apply_items (run_id, position);
CREATE INDEX IF NOT EXISTS auto_apply_runs_started_idx ON auto_apply_runs (started_at DESC);
