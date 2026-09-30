-- V12 employer portal accounts: where the desk has an account in your name. One row per portal host. The password is
-- never stored here or anywhere in the database: it lives in .env.local (PORTAL_ACCOUNT_PASSWORD) only.
-- Safe to re-run. Apply after schema-v11.sql:
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v12.sql

CREATE TABLE IF NOT EXISTS portal_accounts (
  host TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- created: the account was made; verify_email: it waits for the link sent to the email;
  -- signed_in: a later run signed in; failed: the last attempt did not get through (see note)
  state TEXT NOT NULL CHECK (state IN ('created', 'verify_email', 'signed_in', 'failed')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
