-- Help Center / Customer Portal split + Customer Admin. Idempotent.
-- Azure applies the columns from shared/schema.ts (drizzle-kit push); the backfill
-- below is run BY HAND on prod right after the roll (see PR body).
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS portal_role text NOT NULL DEFAULT 'member';
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS billing_access boolean NOT NULL DEFAULT false;
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS portal_pending_at timestamp;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_email_domains text[];
ALTER TABLE portal_login_links ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_client_contacts_org_email_live
  ON client_contacts (org_id, lower(email))
  WHERE email IS NOT NULL AND client_id IS NOT NULL AND deleted_at IS NULL;
-- Primary contacts keep what they had: company-wide case visibility and billing. ONE
-- TIME ONLY: migrations replay on every boot outside Azure, and a firm's later decision
-- to demote a primary must never be undone by a replay — hence the completion marker.
CREATE TABLE IF NOT EXISTS schema_backfills (name text PRIMARY KEY, done_at timestamp NOT NULL DEFAULT now());
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_backfills WHERE name = '0039-portal-role-primary') THEN
    UPDATE client_contacts SET portal_role = 'admin', billing_access = true
     WHERE is_primary AND deleted_at IS NULL;
    INSERT INTO schema_backfills (name) VALUES ('0039-portal-role-primary');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS portal_blocked_emails (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  client_id varchar(36) REFERENCES clients(id) ON DELETE SET NULL,
  email text NOT NULL,
  reason text,
  blocked_by_user_id varchar(36) REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_blocked_emails_org_email ON portal_blocked_emails (org_id, lower(email));
