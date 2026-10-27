-- First-party open/click tracking for campaigns. Idempotent; structure only.
-- Azure applies this from shared/schema.ts (drizzle-kit push); nothing to run by hand.
CREATE TABLE IF NOT EXISTS email_tracking_links (
  token text PRIMARY KEY,
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  kind text NOT NULL DEFAULT 'campaign',
  campaign_id varchar(36),
  prospect_id varchar(36) REFERENCES marketing_prospects(id) ON DELETE SET NULL,
  attempt_id varchar(36),
  links jsonb NOT NULL,
  opened_at timestamp,
  open_count integer NOT NULL DEFAULT 0,
  clicked_at timestamp,
  click_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_tracking_links_attempt_idx ON email_tracking_links (attempt_id);
