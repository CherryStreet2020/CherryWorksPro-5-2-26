-- Support Cases (Phase 1): cases, types, messages, events; case link on time
-- entries; per-client key prefix + counter. Idempotent — this file replays on
-- every boot alongside `drizzle-kit push`.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS case_key_prefix varchar(10),
  ADD COLUMN IF NOT EXISTS next_case_number integer NOT NULL DEFAULT 1;

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS support_case_id varchar(36);
CREATE INDEX IF NOT EXISTS idx_time_entries_support_case ON time_entries (support_case_id);

CREATE TABLE IF NOT EXISTS support_case_types (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  name text NOT NULL,
  description text,
  default_priority text NOT NULL DEFAULT 'MEDIUM',
  default_service_id varchar(36),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_case_types_org ON support_case_types (org_id);

CREATE TABLE IF NOT EXISTS support_cases (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  client_id varchar(36) NOT NULL REFERENCES clients(id),
  project_id varchar(36) REFERENCES projects(id),
  type_id varchar(36),
  case_key varchar(24) NOT NULL,
  case_number integer NOT NULL,
  subject text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'NEW',
  priority text NOT NULL DEFAULT 'MEDIUM',
  source text NOT NULL DEFAULT 'AGENT',
  requester_contact_id varchar(36),
  requester_name text,
  requester_email text,
  assignee_user_id varchar(36) REFERENCES users(id),
  created_by_user_id varchar(36) REFERENCES users(id),
  first_response_due_at timestamp,
  resolution_due_at timestamp,
  first_response_at timestamp,
  last_customer_message_at timestamp,
  last_agent_message_at timestamp,
  resolved_at timestamp,
  closed_at timestamp,
  external_ref text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS support_cases_org_key_unique ON support_cases (org_id, case_key);
CREATE INDEX IF NOT EXISTS idx_support_cases_org_status ON support_cases (org_id, status);
CREATE INDEX IF NOT EXISTS idx_support_cases_org_client ON support_cases (org_id, client_id);
CREATE INDEX IF NOT EXISTS idx_support_cases_org_assignee ON support_cases (org_id, assignee_user_id);

CREATE TABLE IF NOT EXISTS support_case_messages (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  case_id varchar(36) NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  author_user_id varchar(36) REFERENCES users(id),
  author_contact_id varchar(36),
  author_name text NOT NULL,
  visibility text NOT NULL DEFAULT 'CUSTOMER',
  body text NOT NULL,
  email_message_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_case_messages_case_created ON support_case_messages (case_id, created_at);

CREATE TABLE IF NOT EXISTS support_case_events (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  case_id varchar(36) NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  from_value text,
  to_value text,
  actor_user_id varchar(36) REFERENCES users(id),
  actor_name text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_case_events_case_created ON support_case_events (case_id, created_at);
