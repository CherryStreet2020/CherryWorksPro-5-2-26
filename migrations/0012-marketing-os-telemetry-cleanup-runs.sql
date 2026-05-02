-- Task #243 — Persist marketing-os telemetry cleanup runs.
--
-- Each successful pass of `runMarketingOsTelemetryCleanupOnce` writes a
-- row here so the admin dashboard can show "last cleanup" without
-- requiring shell access to the server logs. The table is capped at the
-- last N rows by the application code; no DB-side trim required.
--
-- Idempotent so the boot replay is safe across reboots.

CREATE TABLE IF NOT EXISTS marketing_os_telemetry_cleanup_runs (
  id              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at          timestamp NOT NULL DEFAULT now(),
  deleted_count   integer NOT NULL,
  retention_days  integer NOT NULL,
  cutoff          timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS marketing_os_telemetry_cleanup_runs_ran_at_idx
  ON marketing_os_telemetry_cleanup_runs (ran_at);
