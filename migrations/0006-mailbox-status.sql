-- Sprint 2g.2: Track OAuth mailbox health so admins can be notified when their
-- connected Microsoft 365 / Gmail mailbox stops working (token revoked, consent
-- withdrawn, password reset, IT revoked the app, etc.).
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS email_oauth_status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS email_oauth_last_error_at timestamp,
  ADD COLUMN IF NOT EXISTS email_oauth_last_error_message text,
  ADD COLUMN IF NOT EXISTS email_oauth_failed_send_count integer NOT NULL DEFAULT 0;
