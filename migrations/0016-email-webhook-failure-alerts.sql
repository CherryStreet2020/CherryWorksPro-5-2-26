-- Task #285: Email org admins after N consecutive auto-test failures so a
-- broken webhook isn't silently ignored until someone happens to load the
-- email-health page.
--
-- consecutive_failure_count tracks the streak of auto-test failures since
-- the last success; failure_alert_sent_at records when admins were last
-- notified, so we only fire one alert per breakage instead of every tick
-- while the webhook stays broken.
ALTER TABLE org_email_alert_webhooks
  ADD COLUMN IF NOT EXISTS consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_alert_sent_at TIMESTAMP;
