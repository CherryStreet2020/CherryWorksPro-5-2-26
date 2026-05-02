-- Name-Split Migration: Promote firstName + lastName to canonical source of truth
-- TENANT ISOLATION: Every UPDATE is scoped by org_id — no global UPDATEs.
-- The backfill loops per-org and only touches rows within that org.
--
-- This migration was applied programmatically per-org:
--   1. For each org, backfill first_name and last_name from the legacy name column
--      (split on first whitespace: everything before = firstName, everything after = lastName)
--   2. Set first_name and last_name to NOT NULL with default ''

-- Per-org backfill template (executed for each org_id individually):
-- UPDATE users
-- SET first_name = CASE
--       WHEN position(' ' IN name) > 0 THEN substring(name from 1 for position(' ' IN name) - 1)
--       ELSE name
--     END,
--     last_name = CASE
--       WHEN position(' ' IN name) > 0 THEN substring(name from position(' ' IN name) + 1)
--       ELSE ''
--     END
-- WHERE org_id = $1 AND first_name IS NULL;

-- Schema changes:
ALTER TABLE users ALTER COLUMN first_name SET DEFAULT '';
ALTER TABLE users ALTER COLUMN last_name SET DEFAULT '';
ALTER TABLE users ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE users ALTER COLUMN last_name SET NOT NULL;
