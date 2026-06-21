-- Audit #6/7/15/16: discounted invoices never posted to the general ledger.
-- The invoice auto-journal builds DR 1200 (AR)=total, CR 4000 (Revenue)=subtotal,
-- CR 2300 (Tax)=tax — with NO discount line. Since total = subtotal + tax -
-- discount, debits fall short of credits by exactly the discount, so
-- createGLJournalEntry's balance check throws and the entry is silently dropped
-- (or skipped by migrate/backfill). The fix adds a contra-revenue
-- "Sales Discounts" (4100, REVENUE type / DEBIT normal balance) line so the
-- entry balances.
--
-- That account must already exist for the org, because createAutoJournalEntry
-- silently DROPS any line whose accountNumber is not in the org's chart — which
-- would re-create the imbalance. seedDefaultGLAccounts() only seeds a chart for
-- orgs that have NONE (it early-returns when any account exists), so EXISTING
-- orgs would never receive 4100 from code alone. This migration backfills it.
--
-- Scope: only orgs that already have a chart (identified by their 4000 Service
-- Revenue account). Brand-new orgs get 4100 via seedDefaultGLAccounts().
-- Idempotent: ON CONFLICT on the (org_id, account_number) unique index
-- (idx_gl_accounts_org_account_number) makes re-runs (every boot) a no-op.
INSERT INTO gl_accounts (org_id, account_number, name, account_type, normal_balance, is_system, is_active, currency)
SELECT DISTINCT org_id, '4100', 'Sales Discounts', 'REVENUE'::gl_account_type, 'DEBIT', true, true, 'USD'
FROM gl_accounts
WHERE account_number = '4000'
ON CONFLICT (org_id, account_number) DO NOTHING;
