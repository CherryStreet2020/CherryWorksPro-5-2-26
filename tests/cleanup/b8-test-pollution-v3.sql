BEGIN;

DO $$
DECLARE
  v_org_id TEXT := '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';
  v_org_name TEXT;
BEGIN
  SELECT name INTO v_org_name FROM orgs WHERE id = v_org_id;
  RAISE NOTICE 'B8 cleanup for org: % (%)', v_org_name, v_org_id;
END $$;

-- Pollution pattern: B4*, RL-*, RateTest*, E2E Test*
-- FK cascade order: time_entries → project_members → project_services → projects
--                   invoice_lines → invoice_revisions → outbox_emails → payments → invoices
--                   recurring_invoice_templates → estimates → estimate_lines → clients

-- 1. time_entries via projects
DELETE FROM time_entries WHERE project_id IN (
  SELECT id FROM projects WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 2. project_members via projects
DELETE FROM project_members WHERE project_id IN (
  SELECT id FROM projects WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 3. project_services via projects
DELETE FROM project_services WHERE project_id IN (
  SELECT id FROM projects WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 4. projects
DELETE FROM projects WHERE client_id IN (
  SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
);

-- 5. invoice_lines via invoices
DELETE FROM invoice_lines WHERE invoice_id IN (
  SELECT id FROM invoices WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 6. invoice_revisions via invoices
DELETE FROM invoice_revisions WHERE invoice_id IN (
  SELECT id FROM invoices WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 7. outbox_emails via invoices
DELETE FROM outbox_emails WHERE invoice_id IN (
  SELECT id FROM invoices WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 8. payments via invoices
DELETE FROM payments WHERE invoice_id IN (
  SELECT id FROM invoices WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 9. invoices
DELETE FROM invoices WHERE client_id IN (
  SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
);

-- 10. recurring_invoice_templates
DELETE FROM recurring_invoice_templates WHERE client_id IN (
  SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
);

-- 11. estimate_lines via estimates
DELETE FROM estimate_lines WHERE estimate_id IN (
  SELECT id FROM estimates WHERE client_id IN (
    SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
  )
);

-- 12. estimates
DELETE FROM estimates WHERE client_id IN (
  SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
    AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%')
);

-- 13. clients (the main target)
DELETE FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%');

-- Verification
DO $$
DECLARE
  v_clients INT; v_invoices INT; v_projects INT;
BEGIN
  SELECT COUNT(*) INTO v_clients FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%');
  SELECT COUNT(*) INTO v_invoices FROM invoices
    WHERE client_id IN (SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%'));
  SELECT COUNT(*) INTO v_projects FROM projects
    WHERE client_id IN (SELECT id FROM clients WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name ILIKE '%B4%' OR name LIKE 'RL-%' OR name LIKE 'RateTest%' OR name LIKE 'E2E Test%'));
  RAISE NOTICE 'B8 remaining — clients:%, invoices:%, projects:%', v_clients, v_invoices, v_projects;
END $$;

-- Trial balance integrity check
DO $$
DECLARE
  v_dr NUMERIC; v_cr NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN debit > 0 THEN debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN credit > 0 THEN credit ELSE 0 END), 0)
  INTO v_dr, v_cr
  FROM gl_journal_lines jel
  JOIN gl_journal_entries je ON jel.journal_entry_id = je.id
  WHERE je.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';
  RAISE NOTICE 'Trial Balance — DR:%, CR:%, diff:%', v_dr, v_cr, v_dr - v_cr;
  IF v_dr <> v_cr THEN
    RAISE EXCEPTION 'Trial balance broken after cleanup! DR=% CR=%', v_dr, v_cr;
  END IF;
END $$;

-- Committed for real run on 2026-04-09
COMMIT;
