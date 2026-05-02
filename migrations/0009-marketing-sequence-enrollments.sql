-- Task #208 — Marketing OS sequence enrollments.
-- Sprint 2o.0 — column flipped from contact_id (→ client_contacts) to
-- prospect_id (→ marketing_prospects) per HR4 (no FK from marketing_*
-- to PSO). The legacy table had 0 rows at the cutover; this migration
-- is rewritten to be idempotent across both shapes:
--   • Fresh DB:        marketing_prospects is created later by
--                      drizzle-kit push, so we create the enum + table
--                      shell here without the prospect_id column. The
--                      column is added by Drizzle.
--   • Pre-2o.0 DB:     legacy contact_id column is dropped if present
--                      and any legacy contact-scoped indexes are
--                      removed so Drizzle can install the prospect_id
--                      column + uniq index cleanly.
--   • Post-2o.0 DB:    every statement is a no-op.

DO $$ BEGIN
  CREATE TYPE marketing_sequence_enrollment_status AS ENUM
    ('active', 'paused', 'completed', 'removed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS marketing_sequence_enrollments (
  id                  varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              varchar(36) NOT NULL REFERENCES orgs(id),
  sequence_id         varchar(36) NOT NULL REFERENCES marketing_sequences(id) ON DELETE CASCADE,
  current_step_index  integer     NOT NULL DEFAULT 0,
  next_send_at        timestamp,
  status              marketing_sequence_enrollment_status NOT NULL DEFAULT 'active',
  enrolled_at         timestamp   NOT NULL DEFAULT now(),
  updated_at          timestamp   NOT NULL DEFAULT now()
);

-- Drop the legacy contact-scoped uniq index (if it ever existed) so
-- Drizzle can install the prospect-scoped equivalent without conflict.
DROP INDEX IF EXISTS marketing_sequence_enrollments_seq_contact_uniq;

-- Drop the legacy contact_id column if it survived from pre-2o.0.
ALTER TABLE marketing_sequence_enrollments DROP COLUMN IF EXISTS contact_id;

CREATE INDEX IF NOT EXISTS marketing_sequence_enrollments_org_seq_idx
  ON marketing_sequence_enrollments (org_id, sequence_id);

CREATE INDEX IF NOT EXISTS marketing_sequence_enrollments_due_idx
  ON marketing_sequence_enrollments (status, next_send_at);
