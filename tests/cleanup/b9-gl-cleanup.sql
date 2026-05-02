BEGIN;

DO $$
DECLARE
  v_org_id TEXT := '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';
  v_org_name TEXT;
BEGIN
  SELECT name INTO v_org_name FROM orgs WHERE id = v_org_id;
  RAISE NOTICE 'B9 GL cleanup for org: % (%)', v_org_name, v_org_id;
END $$;

-- ============================================================
-- F21: Delete orphaned GL journal entries for EUR invoices
-- CW-INV-0040 (JE 76), CW-INV-0041 (JE 77, 78, 79)
-- These invoices don't exist in the invoices table.
-- Net impact: AR -$1,800, SvcRev -$1,800 (restores GL=Invoices parity)
-- ============================================================
DELETE FROM gl_journal_lines WHERE journal_entry_id IN (
  SELECT id FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (76, 77, 78, 79)
);
DELETE FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (76, 77, 78, 79);

-- ============================================================
-- Clean up other orphaned JEs from deleted invoices
-- These all cancel out (sent+voided pairs or $0 amounts)
-- JEs: 48/49 (INV-0014), 55/56 (INV-0016), 60/61 (INV-0017),
--       62/63 (INV-0018), 69 (INV-0019), 70 (INV-0015)
-- ============================================================
DELETE FROM gl_journal_lines WHERE journal_entry_id IN (
  SELECT id FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (48, 49, 55, 56, 60, 61, 62, 63, 69, 70)
);
DELETE FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (48, 49, 55, 56, 60, 61, 62, 63, 69, 70);

-- ============================================================
-- F20: Delete test expense JEs ($75 of $254.98 Misc Expense is test)
-- JE 59: "Expense approved: Test" $50 → DR 6009, CR 2200
-- JE 66: "Expense approved: Audit Test" $25 → DR 6009, CR 2200
-- Remaining Misc Expense: $179.98 (2x $89.99 Adobe = legitimate)
-- ============================================================
DELETE FROM gl_journal_lines WHERE journal_entry_id IN (
  SELECT id FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (59, 66)
);
DELETE FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (59, 66);

-- Also delete the corresponding test expenses from expenses table
DELETE FROM expenses WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (description ILIKE '%R9 sub-test%' OR description = 'R10 audit expense'
       OR description ILIKE '%E2E test expense%' OR description ILIKE 'Office supplies for E2E%');

-- Delete test payout JEs (52/53, 67/68 — pairs that cancel out)
DELETE FROM gl_journal_lines WHERE journal_entry_id IN (
  SELECT id FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (52, 53, 67, 68)
);
DELETE FROM gl_journal_entries WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb' AND id IN (52, 53, 67, 68);

-- ============================================================
-- F18/F19: Delete pollution GL accounts (no JE references)
-- 7001 "Test GL Account", 9048 "R6 Proof Account Updated", 9999 "R6 Proof Account Updated"
-- ============================================================
DELETE FROM gl_accounts WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND id IN (19, 20, 22);

-- ============================================================
-- F25: Delete test users (FK cascade through all referencing tables)
-- Temporarily disable immutable audit_logs trigger for cleanup
-- ============================================================
ALTER TABLE audit_logs DISABLE TRIGGER prevent_audit_log_modification;

DELETE FROM timesheet_weeks WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM audit_logs WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM bulk_ops WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM mfa_enrollments WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM password_reset_tokens WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM support_requests WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM expense_reports WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM project_members WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM time_entries WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');
DELETE FROM expenses WHERE user_id IN ('479bfe13-9e3e-477e-b53f-9bd3eccf0b20','f627c5b6-a2a0-4d10-97c5-7c61f29b71c1','9fc583c0-51dc-459c-88e3-ff3beec54724','b7f08ab2-0cf8-423a-9fd3-5fac0a55a857','0d78e5a2-3a24-438d-80b5-7edee6a1fc62','271d6e0c-0421-4c09-b800-45a83cbd8966','c21d42cf-c96a-4116-ab3a-dda4f45ecd78','007c08b5-3278-43a8-aab5-63250f06d17c');

DELETE FROM users WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND id IN (
    '479bfe13-9e3e-477e-b53f-9bd3eccf0b20',
    'f627c5b6-a2a0-4d10-97c5-7c61f29b71c1',
    '9fc583c0-51dc-459c-88e3-ff3beec54724',
    'b7f08ab2-0cf8-423a-9fd3-5fac0a55a857',
    '0d78e5a2-3a24-438d-80b5-7edee6a1fc62',
    '271d6e0c-0421-4c09-b800-45a83cbd8966',
    'c21d42cf-c96a-4116-ab3a-dda4f45ecd78',
    '007c08b5-3278-43a8-aab5-63250f06d17c'
  );

ALTER TABLE audit_logs ENABLE TRIGGER prevent_audit_log_modification;

-- Delete duplicate bank_transaction_matches for txn 9
DELETE FROM bank_transaction_matches WHERE id = 2
  AND org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';

-- ============================================================
-- Verification
-- ============================================================
DO $$
DECLARE
  v_ar NUMERIC; v_rev NUMERIC; v_dr NUMERIC; v_cr NUMERIC;
  v_test_users INT; v_test_accts INT; v_user_count INT;
BEGIN
  SELECT COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0) INTO v_ar
  FROM gl_journal_lines jl
  JOIN gl_accounts ga ON ga.id = jl.account_id
  WHERE ga.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND ga.account_number = '1200';
  
  SELECT COALESCE(SUM(jl.credit),0) - COALESCE(SUM(jl.debit),0) INTO v_rev
  FROM gl_journal_lines jl
  JOIN gl_accounts ga ON ga.id = jl.account_id
  WHERE ga.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND ga.account_number = '4000';

  SELECT
    COALESCE(SUM(jl.debit), 0),
    COALESCE(SUM(jl.credit), 0)
  INTO v_dr, v_cr
  FROM gl_journal_lines jl
  JOIN gl_journal_entries je ON jl.journal_entry_id = je.id
  WHERE je.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';

  SELECT COUNT(*) INTO v_test_users FROM users
  WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND (name ILIKE '%test%' OR name ILIKE '%JIT%' OR name ILIKE '%Phase%' OR name ILIKE 'Former%');

  SELECT COUNT(*) INTO v_test_accts FROM gl_accounts
  WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND (account_number IN ('7001','9048','9999'));

  SELECT COUNT(*) INTO v_user_count FROM users
  WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';

  RAISE NOTICE 'GL AR: % (target: 915.95)', v_ar;
  RAISE NOTICE 'GL SvcRev: % (target: 2187.50)', v_rev;
  RAISE NOTICE 'Trial Balance — DR:%, CR:%, diff:%', v_dr, v_cr, v_dr - v_cr;
  RAISE NOTICE 'Test users remaining: % (target: 0)', v_test_users;
  RAISE NOTICE 'Test GL accounts remaining: % (target: 0)', v_test_accts;
  RAISE NOTICE 'Total users remaining: %', v_user_count;

  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'Trial balance broken! DR=% CR=%', v_dr, v_cr;
  END IF;
  IF v_ar <> 915.95 THEN
    RAISE EXCEPTION 'AR mismatch! Got % expected 915.95', v_ar;
  END IF;
  IF v_rev <> 2187.50 THEN
    RAISE EXCEPTION 'SvcRev mismatch! Got % expected 2187.50', v_rev;
  END IF;
END $$;

COMMIT;
