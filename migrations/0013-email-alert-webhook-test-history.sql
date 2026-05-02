-- Task #250: Persist a rolling history of webhook test attempts (not just
-- the most recent one) so admins can spot intermittent / flapping webhooks
-- instead of only seeing the latest result on org_email_alert_webhooks.
CREATE TABLE IF NOT EXISTS email_alert_webhook_tests (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id VARCHAR(36) NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  tested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ok BOOLEAN NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_alert_webhook_tests_org_time
  ON email_alert_webhook_tests (org_id, tested_at DESC);
