-- Sprint 2i.1: Per-org feature entitlements.
-- Foundation for flipping Marketing OS (and future add-ons) on/off per tenant
-- without a redeploy. No service code reads this table yet (Sprint 2i.2).
DO $$ BEGIN
  CREATE TYPE org_entitlement_feature AS ENUM (
    'pso_core',
    'marketing_os',
    'multi_brand',
    'hubspot_bridge'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS org_entitlements (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar(36) NOT NULL REFERENCES orgs(id),
  feature org_entitlement_feature NOT NULL,
  active boolean NOT NULL DEFAULT false,
  activated_at timestamp,
  stripe_subscription_id text,
  grace_period_ends_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_entitlements_org_feature_unique
  ON org_entitlements (org_id, feature);

CREATE INDEX IF NOT EXISTS org_entitlements_org_feature_active_idx
  ON org_entitlements (org_id, feature, active);
