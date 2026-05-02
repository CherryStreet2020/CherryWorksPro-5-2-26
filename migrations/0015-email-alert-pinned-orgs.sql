-- Task #280: Operator-curated list of orgs that should always appear
-- in the per-org breakdown of the cross-tenant alert webhook payload
-- when they contributed at least one failure to the breach window.
CREATE TABLE IF NOT EXISTS email_alert_pinned_orgs (
  org_id varchar(36) PRIMARY KEY,
  pinned_at timestamp NOT NULL DEFAULT now(),
  pinned_by text,
  note text
);
