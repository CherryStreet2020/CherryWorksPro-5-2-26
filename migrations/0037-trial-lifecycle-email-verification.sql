-- Trial lifecycle + email verification + platform settings. Idempotent.
-- NOTE: Azure provisions structure via drizzle-kit push from shared/schema.ts;
-- the backfill below is mirrored by a boot-time step in server/index.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token_hash varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamp;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_reminder_7_sent_at timestamp;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_reminder_1_sent_at timestamp;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_expired_at timestamp;
CREATE TABLE IF NOT EXISTS platform_settings (
  key varchar(64) PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by_user_id varchar(36)
);
-- Accounts that existed before verification shipped are treated as verified —
-- exactly once (marker row), so a later deliberate reset is never undone.
UPDATE users SET email_verified_at = COALESCE(created_at, now())
  WHERE email_verified_at IS NULL AND created_at < '2026-09-08'
    AND NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'legacy_email_verification_backfill_done');
INSERT INTO platform_settings (key, value)
  VALUES ('legacy_email_verification_backfill_done', '{"source":"migration-0037"}')
  ON CONFLICT (key) DO NOTHING;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS sent_to text;
