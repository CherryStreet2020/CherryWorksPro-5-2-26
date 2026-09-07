-- Customer portal identity (Support Cases Phase 2): magic-link logins and
-- per-contact sessions; per-client "show hours in the portal" toggle. Idempotent.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS portal_show_hours boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS portal_login_links (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  contact_id varchar(36) NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL,
  expires_at timestamp NOT NULL,
  consumed_at timestamp,
  requested_ip text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_login_links_token_unique ON portal_login_links (token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_login_links_contact ON portal_login_links (contact_id);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  contact_id varchar(36) NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL,
  expires_at timestamp NOT NULL,
  last_seen_at timestamp NOT NULL DEFAULT now(),
  revoked_at timestamp,
  user_agent text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_sessions_token_unique ON portal_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_contact ON portal_sessions (contact_id);
