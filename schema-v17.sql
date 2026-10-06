-- V17 careers-page first: a registry of every company's own careers board (freehire's sources/*.yml and jobseek's
-- boards.csv idea, kept in the database), crawled every day, grown every day with companies found the day before, and an
-- approval step between "the form is filled" and "the form is submitted". Safe to re-run. Apply after schema-v16.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v17.sql

-- One row per careers board the desk reads. `key` names the board on its platform ("greenhouse:coveoen",
-- "workday:autodesk.wd1.myworkdayjobs.com/Ext", "careers-page:https://www.example.com/careers") so the same board found
-- twice (by freehire, by the company's site, by a posting link) is one row. A board that stops answering is retired, never
-- deleted (freehire's sources/retired/): its history stays, and a later sighting brings it back.
CREATE TABLE IF NOT EXISTS career_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  config JSONB NOT NULL,
  careers_url TEXT,
  -- 'seed' | 'freehire' | 'careers-site' | 'posting-link' | 'employers.json'
  discovered_via TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_crawled_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_jobs INT,
  last_matches INT,
  fail_count INT NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS career_boards_company ON career_boards (company_id);
CREATE INDEX IF NOT EXISTS career_boards_due ON career_boards (status, last_crawled_at);

-- Where and when a company came into the desk, and when its own site was last read for a careers board.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS discovered_via TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS careers_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS careers_checked_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS careers_note TEXT;

-- The daily run: what it found and how far it took it.
CREATE TABLE IF NOT EXISTS daily_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  new_companies INT NOT NULL DEFAULT 0,
  new_boards INT NOT NULL DEFAULT 0,
  boards_crawled INT NOT NULL DEFAULT 0,
  new_jobs INT NOT NULL DEFAULT 0,
  prepared INT NOT NULL DEFAULT 0,
  waiting_approval INT NOT NULL DEFAULT 0,
  notes TEXT
);

-- "Approuver et envoyer": you looked at the filled form and said yes. Read by the submit run, cleared once it ran, so one
-- approval is one submit attempt. With PORTAL_SUBMIT=approve (the default) nothing is submitted without it.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS submit_approved_at TIMESTAMPTZ;
-- "Pas celle-ci": left out of the approval list and of the daily batch.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS approval_dismissed_at TIMESTAMPTZ;
