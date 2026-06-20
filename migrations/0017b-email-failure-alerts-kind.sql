-- Task #313: Send an alert webhook when silenced sends spike, not just show
-- a UI badge.
--
-- The same `email_failure_alerts` table now records two kinds of alerts:
--   * 'transport_failure' — the original threshold-breach alert (legacy default)
--   * 'suppressed_spike'  — silenced (suppression-list) sends crossed the
--                           per-hour threshold and the configured webhook
--                           was notified.
--
-- Legacy rows pre-dating this column are all transport-failure alerts, so
-- the default keeps reads correct without a backfill.
ALTER TABLE email_failure_alerts
  ADD COLUMN IF NOT EXISTS alert_kind TEXT NOT NULL DEFAULT 'transport_failure';

CREATE INDEX IF NOT EXISTS email_failure_alerts_kind_ts_idx
  ON email_failure_alerts (alert_kind, ts);
