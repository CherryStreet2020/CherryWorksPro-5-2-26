-- FIXIT B7 — Test Data Cleanup v2
-- Org-scoped to Cherry Street Consulting ONLY
-- Targets: V6 PROBE, R18-EUR-Client, R18-EstConvert-Client, R18-Test2, E2E Test Client
-- Does NOT touch Northstar Innovation or Acme Digital Agency
-- FK audit: invoices→(invoice_lines, invoice_revisions, outbox_emails, payments),
--           clients→(invoices, projects, estimates, expenses, client_contacts, recurring_invoice_templates),
--           projects→(time_entries, project_members, project_services, expenses)

BEGIN;

DO $$
DECLARE
  v_org_id TEXT := '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';
  v_org_name TEXT;
BEGIN
  SELECT name INTO v_org_name FROM orgs WHERE id = v_org_id;
  IF v_org_name IS NULL THEN
    RAISE EXCEPTION 'Org % not found — aborting', v_org_id;
  END IF;
  RAISE NOTICE 'B7 cleanup for org: % (%)', v_org_name, v_org_id;
END $$;

-- ════════════════════════════════════════════════════════════════
-- Step 1: Delete project FK children for test-client-owned projects
-- ════════════════════════════════════════════════════════════════
DELETE FROM time_entries
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND project_id IN (
    SELECT p.id FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM project_members
WHERE project_id IN (
    SELECT p.id FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM project_services
WHERE project_id IN (
    SELECT p.id FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM projects
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client')
  );

-- ════════════════════════════════════════════════════════════════
-- Step 2: Delete invoice FK children, then invoices
-- ════════════════════════════════════════════════════════════════
DELETE FROM invoice_lines
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM invoice_revisions
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM outbox_emails
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM payments
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM invoices
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client')
  );

-- ════════════════════════════════════════════════════════════════
-- Step 3: Delete remaining client FK children
--         estimates→(estimate_lines, outbox_emails)
-- ════════════════════════════════════════════════════════════════
DELETE FROM estimate_lines
WHERE estimate_id IN (
    SELECT e.id FROM estimates e
    JOIN clients c ON e.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM outbox_emails
WHERE estimate_id IN (
    SELECT e.id FROM estimates e
    JOIN clients c ON e.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'V6 PROBE%' OR c.name LIKE 'R18-%' OR c.name = 'E2E Test Client')
  );

DELETE FROM estimates
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client')
  );

DELETE FROM expenses
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client')
  );

DELETE FROM client_contacts
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client')
  );

DELETE FROM recurring_invoice_templates
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client')
  );

-- ════════════════════════════════════════════════════════════════
-- Step 4: Delete the test clients themselves
-- ════════════════════════════════════════════════════════════════
DELETE FROM clients
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client');

-- ════════════════════════════════════════════════════════════════
-- Verification: all should be 0
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_org TEXT := '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';
  v_clients INT; v_invoices INT; v_projects INT;
BEGIN
  SELECT count(*) INTO v_clients FROM clients WHERE org_id = v_org AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client');
  SELECT count(*) INTO v_invoices FROM invoices WHERE org_id = v_org AND client_id IN (SELECT id FROM clients WHERE org_id = v_org AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client'));
  SELECT count(*) INTO v_projects FROM projects WHERE org_id = v_org AND client_id IN (SELECT id FROM clients WHERE org_id = v_org AND (name LIKE 'V6 PROBE%' OR name LIKE 'R18-%' OR name = 'E2E Test Client'));
  RAISE NOTICE 'B7 remaining — clients:%, invoices:%, projects:%', v_clients, v_invoices, v_projects;
END $$;

-- Trial balance integrity check
DO $$
DECLARE
  v_dr NUMERIC; v_cr NUMERIC;
BEGIN
  SELECT SUM(debit), SUM(credit) INTO v_dr, v_cr FROM gl_journal_lines;
  RAISE NOTICE 'Trial Balance — DR:%, CR:%, diff:%', v_dr, v_cr, v_dr - v_cr;
  IF v_dr != v_cr THEN
    RAISE EXCEPTION 'Trial balance broken after cleanup! DR=% CR=%', v_dr, v_cr;
  END IF;
END $$;

-- Committed for real run on 2026-04-09
COMMIT;
