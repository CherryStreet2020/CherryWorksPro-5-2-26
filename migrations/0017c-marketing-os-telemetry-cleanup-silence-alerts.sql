-- Task #318: Email admins when the telemetry cleanup sweep has been silent
-- for several consecutive days. The decision logic in
-- `server/notifications/marketing-os-telemetry-cleanup-silence.ts` mirrors
-- the dedupe pattern used by the email-alert webhook auto-test failure
-- email: we send one email per breakage and treat the next successful
-- cleanup run (recorded in `marketing_os_telemetry_cleanup_runs`) as an
-- implicit reset.
--
-- Rows here are append-only — the most recent `sent_at` is what the
-- decision logic compares against the most recent recorded cleanup run.
CREATE TABLE IF NOT EXISTS marketing_os_telemetry_cleanup_silence_alerts (
  id              VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  health_status   TEXT         NOT NULL,
  -- BIGINT: ageMs is milliseconds since the last cleanup run. A 32-bit
  -- INTEGER would overflow after ~24.8 days of silence, which is
  -- exactly the regime this alert is meant to surface.
  age_ms          BIGINT,
  notified_count  INTEGER      NOT NULL
);

CREATE INDEX IF NOT EXISTS marketing_os_telemetry_cleanup_silence_alerts_sent_at_idx
  ON marketing_os_telemetry_cleanup_silence_alerts (sent_at);
