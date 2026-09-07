-- Inbound mail ledger: one row per internet message id, so overlapping
-- inbox passes (scheduled + "Check inbox now") and webhook retries cannot
-- process the same message twice. Idempotent.
DELETE FROM inbound_emails a
  USING inbound_emails b
  WHERE a.resend_message_id IS NOT NULL
    AND a.resend_message_id = b.resend_message_id
    AND a.created_at > b.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_message_id_unique
  ON inbound_emails (resend_message_id) WHERE resend_message_id IS NOT NULL;
