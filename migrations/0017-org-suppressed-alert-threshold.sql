-- Task #314: Per-org override for the silenced-send (suppression-list)
-- per-hour warning threshold previously fixed to the
-- EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR env var (default 25).
-- NULL means "use the env/default fallback" so existing tenants who
-- never touch this setting continue to inherit any platform tuning.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS email_suppressed_alert_threshold_per_hour INTEGER;
