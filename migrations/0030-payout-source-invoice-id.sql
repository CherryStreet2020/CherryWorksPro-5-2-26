-- #17: explicit invoice link on auto-created payouts.
--
-- storage.hasActiveInvoicePayout reads team_member_payouts_v2.source_invoice_id
-- to detect "a payout for this (invoice, member) already exists" instead of
-- substring-matching the notes, so re-sending an invoice can't spawn duplicate
-- payouts. The column + index are also declared in shared/schema.ts.
--
-- Why both a migration AND schema.ts: production adds the column via
-- `drizzle-kit push --force` at prestart (migrations are skipped on prod via
-- SKIP_STARTUP_MIGRATIONS=1), but dev/CI/local boot through the Phase 0 SQL
-- replay, which does NOT run push. Without this file those environments would
-- lack the column and POST /api/invoices/:id/send would silently skip all
-- auto-payouts. Phase 0 replays every migration on each boot, so this MUST be
-- idempotent (IF NOT EXISTS) and a no-op everywhere the column already exists.
ALTER TABLE team_member_payouts_v2 ADD COLUMN IF NOT EXISTS source_invoice_id varchar(36);
CREATE INDEX IF NOT EXISTS idx_team_member_payouts_v2_source_invoice
  ON team_member_payouts_v2 (source_invoice_id, team_member_id);
