-- Inbound mail ledger: one row per internet message id, so overlapping
-- inbox passes (scheduled + "Check inbox now") and webhook retries cannot
-- process the same message twice. Idempotent.
--
-- On a fresh database this Phase 0 replay runs BEFORE the code-side
-- runProductionMigrations() that historically created inbound_emails, so the
-- table is created here with the same shape (the code path then no-ops).
CREATE TABLE IF NOT EXISTS inbound_emails (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  headers JSONB,
  resend_message_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
DELETE FROM inbound_emails a
  USING inbound_emails b
  WHERE a.resend_message_id IS NOT NULL
    AND a.resend_message_id = b.resend_message_id
    AND (a.created_at, a.ctid) > (b.created_at, b.ctid);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_message_id_unique
  ON inbound_emails (resend_message_id) WHERE resend_message_id IS NOT NULL;
