-- Sprint 2n — Marketing OS campaign builder + sequence editor.
--
-- Creates the three brand-scoped tables backing the new
-- `/marketing/campaigns` and `/marketing/sequences` surfaces. Mirrors
-- the Drizzle definitions in shared/schema.ts (marketingCampaigns,
-- marketingSequences, marketingSequenceSteps). Idempotent: every
-- statement uses IF NOT EXISTS so Phase 0 replay is safe across reboots.

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      varchar(36) NOT NULL REFERENCES orgs(id),
  brand_id    varchar(36) NOT NULL REFERENCES brands(id),
  name        text        NOT NULL,
  subject     text        NOT NULL DEFAULT '',
  from_name   text        NOT NULL DEFAULT '',
  from_email  text        NOT NULL DEFAULT '',
  reply_to    text        NOT NULL DEFAULT '',
  body        text        NOT NULL DEFAULT '',
  send_at     timestamp,
  created_at  timestamp   NOT NULL DEFAULT now(),
  updated_at  timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_campaigns_org_brand_idx
  ON marketing_campaigns (org_id, brand_id);

CREATE TABLE IF NOT EXISTS marketing_sequences (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      varchar(36) NOT NULL REFERENCES orgs(id),
  brand_id    varchar(36) NOT NULL REFERENCES brands(id),
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  from_name   text        NOT NULL DEFAULT '',
  from_email  text        NOT NULL DEFAULT '',
  reply_to    text        NOT NULL DEFAULT '',
  created_at  timestamp   NOT NULL DEFAULT now(),
  updated_at  timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_sequences_org_brand_idx
  ON marketing_sequences (org_id, brand_id);

CREATE TABLE IF NOT EXISTS marketing_sequence_steps (
  id           varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       varchar(36) NOT NULL REFERENCES orgs(id),
  sequence_id  varchar(36) NOT NULL REFERENCES marketing_sequences(id) ON DELETE CASCADE,
  step_order   integer     NOT NULL DEFAULT 0,
  delay_days   integer     NOT NULL DEFAULT 0,
  subject      text        NOT NULL DEFAULT '',
  body         text        NOT NULL DEFAULT '',
  created_at   timestamp   NOT NULL DEFAULT now(),
  updated_at   timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_sequence_steps_seq_order_idx
  ON marketing_sequence_steps (sequence_id, step_order);
