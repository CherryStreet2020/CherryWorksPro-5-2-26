-- Phase 2 (invoice delivery history): record CC recipients + the transport's
-- message id on each outbox row, and index outbox lookups by invoice.
--
-- Additive + nullable + IF NOT EXISTS so it is safe to replay (Phase 0 replay
-- runs every *.sql on each boot in dev/CI/local). On prod the schema reaches the
-- DB via drizzle-kit push at the publish gate (this file documents the same
-- change and keeps dev/CI in sync).
ALTER TABLE outbox_emails ADD COLUMN IF NOT EXISTS cc text;
ALTER TABLE outbox_emails ADD COLUMN IF NOT EXISTS provider_message_id text;
CREATE INDEX IF NOT EXISTS idx_outbox_emails_invoice_id ON outbox_emails (invoice_id);
