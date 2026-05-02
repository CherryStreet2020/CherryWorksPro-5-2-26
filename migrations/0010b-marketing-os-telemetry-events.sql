-- Task #230 — Marketing OS discovery telemetry persistence.
--
-- Creates the `marketing_os_telemetry_events` table (and its enum +
-- indexes) declared in shared/schema.ts as
-- `marketingOsTelemetryEvents`. Without this file, fresh databases
-- never get the table because the production migration runner only
-- replays SQL from this directory; the admin upgrade-interest widget
-- and the periodic cleanup sweep then crash with
-- "relation 'marketing_os_telemetry_events' does not exist".
--
-- Idempotent so Phase 0 boot replay is safe across reboots.

DO $$ BEGIN
  CREATE TYPE marketing_os_telemetry_event_type AS ENUM
    ('section_shown', 'modal_opened', 'checkout_clicked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS marketing_os_telemetry_events (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      varchar(36) NOT NULL REFERENCES orgs(id),
  user_id     varchar(36) REFERENCES users(id),
  event_type  marketing_os_telemetry_event_type NOT NULL,
  source      text,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_os_telemetry_org_created_idx
  ON marketing_os_telemetry_events (org_id, created_at);

CREATE INDEX IF NOT EXISTS marketing_os_telemetry_org_event_created_idx
  ON marketing_os_telemetry_events (org_id, event_type, created_at);
