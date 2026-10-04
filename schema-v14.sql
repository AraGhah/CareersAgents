-- V14 multi-step portal forms: the desk now fills a form page by page ("Next" → … → final Submit), so a run records how
-- many pages it went through and, when it stops, the page that needs you. Safe to re-run. Apply after schema-v13.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v14.sql

-- Which page of the form each field is on (1 = the first page).
ALTER TABLE portal_fields ADD COLUMN IF NOT EXISTS step INT;

-- Pages the run reached, and the page it stopped on when something needs a person (null when it did not stop early).
ALTER TABLE portal_runs ADD COLUMN IF NOT EXISTS step_count INT;
ALTER TABLE portal_runs ADD COLUMN IF NOT EXISTS stop_step INT;
