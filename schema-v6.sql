-- V6 additions. Safe to re-run.
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v6.sql

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;

DO $$
BEGIN
  ALTER TABLE messages
    ADD CONSTRAINT messages_gmail_message_id_key UNIQUE (gmail_message_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE followups
    ADD CONSTRAINT followups_application_due_key UNIQUE (application_id, due_on);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS status_events_application_idx
  ON status_events (application_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS messages_application_idx
  ON messages (application_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS followups_due_state_idx
  ON followups (due_on, state);
