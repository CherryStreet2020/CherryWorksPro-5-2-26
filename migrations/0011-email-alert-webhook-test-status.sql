-- Task #229: Persist the most recent "Send test alert" outcome per org so
-- admins see a durable signal that the configured webhook URL is healthy
-- (not just a one-time toast that disappears on navigation).
ALTER TABLE org_email_alert_webhooks
  ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_test_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_test_error TEXT;
