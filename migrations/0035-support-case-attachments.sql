-- Support Cases: attachments on cases/messages (bytes in object storage). Idempotent.
CREATE TABLE IF NOT EXISTS support_case_attachments (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  case_id varchar(36) NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  message_id varchar(36),
  filename text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  storage_key text NOT NULL,
  uploaded_by_user_id varchar(36),
  uploaded_by_contact_id varchar(36),
  source text NOT NULL DEFAULT 'AGENT',
  external_ref text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_case_attachments_case ON support_case_attachments (case_id);
CREATE INDEX IF NOT EXISTS idx_support_case_attachments_external ON support_case_attachments (org_id, external_ref);
