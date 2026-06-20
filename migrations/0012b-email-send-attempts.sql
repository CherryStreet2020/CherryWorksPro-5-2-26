-- Task #235: Per-recipient send attempts so the scheduled-send worker can
-- retry transient failures with exponential backoff and so admins can see
-- exactly which recipients did not receive a campaign / sequence step.
--
-- Sprint 2o.0 — column flipped from contact_id (→ client_contacts) to
-- prospect_id (→ marketing_prospects) per HR4. Live DB had 0 non-null
-- contact_id rows at cutover; migration is rewritten to be idempotent
-- across all three envs:
--   • Fresh DB:    table is created with prospect_id directly. Drizzle
--                  installs the FK + indexes on schema push.
--   • Pre-2o.0 DB: legacy contact_id column + indexes are dropped if
--                  present so Drizzle can install prospect_id cleanly.
--   • Post-2o.0 DB: every statement is a no-op.

DO $$ BEGIN
  CREATE TYPE email_send_attempt_kind AS ENUM ('campaign', 'sequence');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE email_send_attempt_status AS ENUM ('success', 'failed', 'permanent_failure');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS email_send_attempts (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          VARCHAR(36) NOT NULL REFERENCES orgs(id),
  kind            email_send_attempt_kind NOT NULL,
  campaign_id     VARCHAR(36) REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  sequence_id     VARCHAR(36) REFERENCES marketing_sequences(id) ON DELETE CASCADE,
  enrollment_id   VARCHAR(36) REFERENCES marketing_sequence_enrollments(id) ON DELETE CASCADE,
  step_index      INTEGER,
  recipient_email TEXT,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  status          email_send_attempt_status NOT NULL,
  error_code      TEXT,
  error_message   TEXT,
  transport       TEXT,
  provider_message_id TEXT,
  attempted_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  next_retry_at   TIMESTAMP
);

-- Drop the legacy contact-scoped indexes if they survived from pre-2o.0
-- (the prospect-scoped equivalents are installed by Drizzle on push).
DROP INDEX IF EXISTS email_send_attempts_campaign_idx;
DROP INDEX IF EXISTS email_send_attempts_sequence_idx;

-- Drop the legacy contact_id column if it survived from pre-2o.0. The
-- FK to client_contacts is dropped automatically with the column.
ALTER TABLE email_send_attempts DROP COLUMN IF EXISTS contact_id;

CREATE INDEX IF NOT EXISTS email_send_attempts_retry_idx
  ON email_send_attempts (status, next_retry_at);
