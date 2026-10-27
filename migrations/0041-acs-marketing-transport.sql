-- ACS Email marketing transport. Idempotent; structure only.
-- Azure applies this from shared/schema.ts (drizzle-kit push); nothing to run by hand.
ALTER TYPE email_send_attempt_status ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE email_send_attempt_status ADD VALUE IF NOT EXISTS 'deferred';
ALTER TABLE email_send_attempts ADD COLUMN IF NOT EXISTS poll_count integer NOT NULL DEFAULT 0;
