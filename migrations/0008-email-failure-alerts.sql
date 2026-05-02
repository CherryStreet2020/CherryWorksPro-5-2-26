-- Task #188: Persist email failure threshold-breach alerts so the admin
-- dashboard's history survives server restarts (deploys, crashes, scaling
-- events). Previously the alerts lived in a 20-entry in-process ring
-- buffer and were lost on every boot.
--
-- The `by_org` jsonb column stores the per-org slice produced inside
-- maybeSendFailureWebhook so getRecentFailureAlerts(orgScope) can keep
-- projecting per-tenant counts after a restart without a separate table.
CREATE TABLE IF NOT EXISTS email_failure_alerts (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamp NOT NULL DEFAULT now(),
  failure_count integer NOT NULL,
  threshold integer NOT NULL,
  threshold_breached boolean NOT NULL DEFAULT true,
  top_transport text,
  top_error_code text,
  delivered boolean NOT NULL DEFAULT false,
  by_org jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_failure_alerts_ts_idx
  ON email_failure_alerts (ts DESC);
