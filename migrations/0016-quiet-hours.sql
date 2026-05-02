-- Task #303 — Quiet-hours window for admin failure emails.
-- A per-(user, org) window during which non-urgent failure notifications
-- (campaign digests, sequence-step exhaustion) buffer until the window
-- ends instead of waking admins at 3am. Mailbox-reconnect alerts
-- deliberately bypass this gate because they're action-required.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS pending_admin_notifications (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id VARCHAR(36) NOT NULL REFERENCES orgs(id),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  context_tag TEXT NOT NULL,
  release_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pending_admin_notifications_release_at_idx
  ON pending_admin_notifications (release_at);
