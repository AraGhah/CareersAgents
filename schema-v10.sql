-- V10: per-category CVs + a global settings table.
-- Safe to re-run. Apply after schema.sql (and v6/v8/v9 if you use those features):
--   docker exec -i internship-desk-db psql -U internship -d internship_desk -f - < schema-v10.sql

-- category IS NULL means "general" resume, usable as a fallback for any category.
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS category TEXT;

DO $$ BEGIN
  ALTER TABLE resumes ADD CONSTRAINT resumes_category_check
    CHECK (category IS NULL OR category IN
      ('software-developer', 'software-engineer', 'full-stack-developer', 'back-end-developer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Replaces the old "one active resume per language" index: now one active
-- resume per (language, category) slot, so a Full-Stack EN and a Back-End EN
-- CV can be active at the same time.
DROP INDEX IF EXISTS resumes_one_active_per_lang;
CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_active_per_lang_category
  ON resumes (language, COALESCE(category, '_general')) WHERE is_active;

-- First DB-persisted global setting in this app. One row so far:
-- key = 'active_category', value = one of the InternshipCategory slugs above (or NULL/unset).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
