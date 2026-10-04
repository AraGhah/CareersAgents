-- V15 one batch at a time, and no second application after an unconfirmed submit. Safe to re-run. Apply after schema-v14.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v15.sql

-- "Postuler automatiquement" refused a second batch only in code (check, then insert): two clicks close together both
-- got through and two processes filled the same forms. The database now holds the rule. Older duplicates are closed
-- first, keeping the newest, so the index can be built.
UPDATE auto_apply_runs r
   SET state = 'failed', finished_at = COALESCE(finished_at, now()),
       note = COALESCE(note, 'Closed by schema-v15: another batch was running at the same time.')
 WHERE r.state = 'running'
   AND EXISTS (SELECT 1 FROM auto_apply_runs n WHERE n.state = 'running' AND n.started_at > r.started_at);

CREATE UNIQUE INDEX IF NOT EXISTS auto_apply_runs_one_running
  ON auto_apply_runs ((true)) WHERE state = 'running';

-- When the desk clicked a final Submit. A click the portal never confirmed may still have gone through, so such a run
-- counts as "maybe applied" for the duplicate check: it is never retried automatically, even a week later.
ALTER TABLE portal_runs ADD COLUMN IF NOT EXISTS submit_clicked_at TIMESTAMPTZ;
