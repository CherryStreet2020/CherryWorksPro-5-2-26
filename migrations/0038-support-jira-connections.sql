-- Saved Jira Cloud connection for the Support import (token encrypted at rest). Idempotent.
CREATE TABLE IF NOT EXISTS support_jira_connections (
  org_id varchar(36) PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  project_key varchar(10) NOT NULL,
  email text NOT NULL,
  api_token_enc text NOT NULL,
  client_id varchar(36),
  project_id varchar(36),
  connected_as text,
  connected_at timestamp NOT NULL DEFAULT now(),
  last_import_at timestamp,
  last_import_summary jsonb,
  updated_by_user_id varchar(36)
);
