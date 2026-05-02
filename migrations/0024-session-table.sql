-- 0024-session-table.sql
--
-- Ensure the express-session backing table used by `connect-pg-simple`
-- exists at boot time. The library's `createTableIfMissing: true` option
-- only fires on the first session WRITE, which means an unauthenticated
-- visitor (and the periodic prune cycle) can hit "relation \"session\"
-- does not exist" errors on a brand-new dev database before any user
-- ever logs in. Creating the table up front via a regular boot-time
-- migration prevents that 500 cascade.
--
-- Schema mirrors node_modules/connect-pg-simple/table.sql exactly,
-- minus the `COLLATE "default"` clause (Postgres-equivalent default).
-- All statements are idempotent so the boot-time migration runner
-- can replay this file safely on every restart.

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);

DO $$
BEGIN
  -- Scope the existence check to public.session + contype='p' so that an
  -- unrelated constraint named 'session_pkey' on a different table/schema
  -- (or a future non-PK constraint of the same name) does not cause this
  -- step to silently skip.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.session'::regclass
      AND contype  = 'p'
  ) THEN
    ALTER TABLE "session"
      ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
