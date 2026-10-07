-- V18 explicit application state: every portal run keeps the state it is in (FOUND_JOB ... SUBMITTED / FAILED /
-- MANUAL_INTERVENTION_REQUIRED, lib/apply/flow-state.ts) and the trail of states it went through, each with the page it
-- happened on and why. A run that stops can be diagnosed from its trail and picked up where it stopped. Safe to re-run.
-- Apply after schema-v17.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v18.sql
ALTER TABLE portal_runs ADD COLUMN IF NOT EXISTS flow_state TEXT;
ALTER TABLE portal_runs ADD COLUMN IF NOT EXISTS flow_log JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS portal_runs_flow_state ON portal_runs (flow_state);
