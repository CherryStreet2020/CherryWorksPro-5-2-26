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
--
-- Reserved-number assumption: 4100 is now a system account. Account number 4100
-- is not referenced anywhere in the codebase except as this contra account, and
-- no posting/seed path creates a custom 4100, so on a normal deployment no org
-- holds a conflicting 4100. The ON CONFLICT below deliberately does NOT clobber a
-- row that already exists (it could be customer data). The only way to reach a
-- conflict is a user who manually created their own account "4100" before this
-- release; for such an org the discount line would post into that account
-- (still balanced — the contra is a DEBIT plug — but mislabeled), and if that
-- account is archived the line is dropped and the imbalance is surfaced by the
-- repost-gl post-check (audit #16) / GL_AUTO_JOURNAL_FAILED audit. Verify with
-- `SELECT org_id FROM gl_accounts WHERE account_number='4100' AND name <> 'Sales Discounts'`
-- before deploying; remediate any hits manually. (Longer-term hardening: reserve
-- system account numbers in the create-account validator and resolve the contra
-- account by attribute rather than by hard-coded number.)
INSERT INTO gl_accounts (org_id, account_number, name, account_type, normal_balance, is_system, is_active, currency)
SELECT DISTINCT org_id, '4100', 'Sales Discounts', 'REVENUE'::gl_account_type, 'DEBIT', true, true, 'USD'
FROM gl_accounts
WHERE account_number = '4000'
ON CONFLICT (org_id, account_number) DO NOTHING;
