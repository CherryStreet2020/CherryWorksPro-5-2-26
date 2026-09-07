-- Support Cases Phase 3: SLA policies, persisted notification center, SLA
-- clocks on cases, the org's inbound support address. Idempotent.

ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS support_inbound_address text;

ALTER TABLE support_cases
  ADD COLUMN IF NOT EXISTS sla_paused_at timestamp,
  ADD COLUMN IF NOT EXISTS first_response_alerted_at timestamp,
  ADD COLUMN IF NOT EXISTS resolution_alerted_at timestamp;

CREATE TABLE IF NOT EXISTS support_sla_policies (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  client_id varchar(36) REFERENCES clients(id) ON DELETE CASCADE,
  first_response_hours numeric(6,2) NOT NULL DEFAULT 8,
  resolution_hours numeric(6,2) NOT NULL DEFAULT 24,
  business_hours_only boolean NOT NULL DEFAULT true,
  business_start_hour integer NOT NULL DEFAULT 9,
  business_end_hour integer NOT NULL DEFAULT 17,
  timezone text NOT NULL DEFAULT 'America/New_York',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS support_sla_policies_org_client_unique
  ON support_sla_policies (org_id, client_id);

CREATE TABLE IF NOT EXISTS user_notifications (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  user_id varchar(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  link text,
  metadata jsonb,
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON user_notifications (user_id, read_at);
