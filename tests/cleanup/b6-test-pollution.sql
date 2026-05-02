-- FIXIT B6 — Test Data Cleanup
-- Org-scoped to Cherry Street Consulting ONLY
-- Review before running. Use COMMIT to apply, ROLLBACK to abort.
--
-- FK audit performed against all referencing tables:
--   users.id  ← 17 tables (time_entries, timesheet_weeks, project_members, etc.)
--   projects.id ← 4 tables (time_entries, project_members, project_services, expenses)
--   clients.id  ← 6 tables (invoices, projects, estimates, expenses, client_contacts, recurring_invoice_templates)
--   invoices.id ← 4 tables (invoice_lines, invoice_revisions, outbox_emails, payments)

BEGIN;

-- Scope guard: Cherry Street Consulting org
DO $$
DECLARE
  v_org_id TEXT := '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';
  v_org_name TEXT;
BEGIN
  SELECT name INTO v_org_name FROM orgs WHERE id = v_org_id;
  IF v_org_name IS NULL THEN
    RAISE EXCEPTION 'Org % not found — aborting', v_org_id;
  END IF;
  RAISE NOTICE 'Cleaning test data for org: % (%)', v_org_name, v_org_id;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. API keys: test keys from B4 and rate-limiter debugging
-- ════════════════════════════════════════════════════════════════
DELETE FROM api_keys
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (name LIKE 'B4%' OR name = 'rl-debug2');

-- ════════════════════════════════════════════════════════════════
-- 2. Users: CSRF test accounts
--    Must delete from all 17 FK-referencing tables first.
--    Dry-run showed only time_entries had rows (18), rest were 0.
--    Defensive deletes for all FK tables included.
-- ════════════════════════════════════════════════════════════════
DELETE FROM time_entries
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM timesheet_weeks
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM project_members
WHERE user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM expense_reports
WHERE user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM expenses
WHERE user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM team_member_payouts_v2
WHERE team_member_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM mfa_enrollments
WHERE user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM password_reset_tokens
WHERE user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM support_requests
WHERE user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM bulk_ops
WHERE user_id IN (
    SELECT id FROM users
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND email LIKE 'csrftest%@example.com'
  );

DELETE FROM users
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND email LIKE 'csrftest%@example.com';

-- ════════════════════════════════════════════════════════════════
-- 3. Services: test services from various rounds
-- ════════════════════════════════════════════════════════════════
DELETE FROM services
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (name LIKE 'R6-Proof-Svc%' OR name LIKE 'B4%');

-- ════════════════════════════════════════════════════════════════
-- 4. Projects: test projects
--    FK refs: time_entries, project_members, project_services, expenses
--    Delete all FK children before projects.
-- ════════════════════════════════════════════════════════════════
DELETE FROM time_entries
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND project_id IN (
    SELECT id FROM projects
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name LIKE 'Fix1%' OR name LIKE 'R10%')
  );

DELETE FROM project_members
WHERE project_id IN (
    SELECT id FROM projects
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name LIKE 'Fix1%' OR name LIKE 'R10%')
  );

DELETE FROM project_services
WHERE project_id IN (
    SELECT id FROM projects
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name LIKE 'Fix1%' OR name LIKE 'R10%')
  );

DELETE FROM expenses
WHERE project_id IN (
    SELECT id FROM projects
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name LIKE 'Fix1%' OR name LIKE 'R10%')
  );

DELETE FROM projects
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (name LIKE 'B4%' OR name LIKE 'Fix1%' OR name LIKE 'R10%');

-- ════════════════════════════════════════════════════════════════
-- 5. Clients: test clients
--    FK refs: invoices, projects, estimates, expenses, client_contacts,
--             recurring_invoice_templates
--    Invoice FK refs: invoice_lines, invoice_revisions, outbox_emails, payments
--    Delete deepest children first.
-- ════════════════════════════════════════════════════════════════

-- 5a. Delete time entries + project FK children for client-owned projects
DELETE FROM time_entries
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND project_id IN (
    SELECT p.id FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'B4%' OR c.name = 'New Client')
  );

DELETE FROM project_members
WHERE project_id IN (
    SELECT p.id FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'B4%' OR c.name = 'New Client')
  );

DELETE FROM project_services
WHERE project_id IN (
    SELECT p.id FROM projects p
    JOIN clients c ON p.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'B4%' OR c.name = 'New Client')
  );

DELETE FROM projects
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name = 'New Client')
  );

-- 5b. Delete invoice FK children, then invoices
DELETE FROM invoice_lines
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'B4%' OR c.name = 'New Client')
  );

DELETE FROM invoice_revisions
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'B4%' OR c.name = 'New Client')
  );

DELETE FROM outbox_emails
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'B4%' OR c.name = 'New Client')
  );

DELETE FROM payments
WHERE invoice_id IN (
    SELECT i.id FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE c.org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (c.name LIKE 'B4%' OR c.name = 'New Client')
  );

DELETE FROM invoices
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name = 'New Client')
  );

-- 5c. Delete other client FK children
DELETE FROM estimates
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name = 'New Client')
  );

DELETE FROM expenses
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name = 'New Client')
  );

DELETE FROM client_contacts
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name = 'New Client')
  );

DELETE FROM recurring_invoice_templates
WHERE client_id IN (
    SELECT id FROM clients
    WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
      AND (name LIKE 'B4%' OR name = 'New Client')
  );

-- 5d. Finally delete the clients
DELETE FROM clients
WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (name LIKE 'B4%' OR name = 'New Client');

-- ════════════════════════════════════════════════════════════════
-- Verify counts: all should be 0
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_org TEXT := '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb';
  v_keys INT; v_users INT; v_svcs INT; v_projs INT; v_clients INT;
BEGIN
  SELECT count(*) INTO v_keys FROM api_keys WHERE org_id = v_org AND (name LIKE 'B4%' OR name = 'rl-debug2');
  SELECT count(*) INTO v_users FROM users WHERE org_id = v_org AND email LIKE 'csrftest%@example.com';
  SELECT count(*) INTO v_svcs FROM services WHERE org_id = v_org AND (name LIKE 'R6-Proof-Svc%' OR name LIKE 'B4%');
  SELECT count(*) INTO v_projs FROM projects WHERE org_id = v_org AND (name LIKE 'B4%' OR name LIKE 'Fix1%' OR name LIKE 'R10%');
  SELECT count(*) INTO v_clients FROM clients WHERE org_id = v_org AND (name LIKE 'B4%' OR name = 'New Client');
  RAISE NOTICE 'Remaining after cleanup — keys:%, users:%, services:%, projects:%, clients:%', v_keys, v_users, v_svcs, v_projs, v_clients;
END $$;

-- Committed for real run on 2026-04-09
COMMIT;
