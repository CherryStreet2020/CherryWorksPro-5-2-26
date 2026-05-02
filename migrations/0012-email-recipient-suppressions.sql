-- Task #252: Persist masked-recipient suppressions so they survive
-- server restarts. Previously these lived in a process-local Map and
-- were silently wiped on every deploy, re-enabling mail to chronic
-- failing recipients. The (org_id, hash) primary key matches the
-- in-memory cache key the failure tracker uses.
CREATE TABLE IF NOT EXISTS email_recipient_suppressions (
  org_id varchar(36) NOT NULL,
  hash varchar(16) NOT NULL,
  masked_recipient text NOT NULL,
  reason text NOT NULL DEFAULT 'manual:admin',
  added_at timestamp NOT NULL DEFAULT now(),
  added_by text,
  suppressed_sends integer NOT NULL DEFAULT 0,
  last_suppressed_at timestamp,
  PRIMARY KEY (org_id, hash)
);

CREATE INDEX IF NOT EXISTS email_recipient_suppressions_org_idx
  ON email_recipient_suppressions(org_id);
