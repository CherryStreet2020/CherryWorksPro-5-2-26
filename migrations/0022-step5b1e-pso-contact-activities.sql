-- ─────────────────────────────────────────────────────────────────────
-- Sprint 2o.0 — Step 5b1e: additive PSO-side activity timeline table
-- ─────────────────────────────────────────────────────────────────────
--
-- Background:
--   Step 5b2 will DROP `contact_activities.contact_id` and
--   `contact_tag_assignments.contact_id`. Pre-flight audit caught 4
--   live PSO-side sites in server/storage.ts that still write/read those
--   deprecated columns:
--     - createContact (insert "contact_created" activity)
--     - maybeAutoLinkContactCompany (insert "company_linked" activity)
--     - listCompanyActivities (join contact_activities → client_contacts)
--     - getContact (join contact_tag_assignments → contact_tags)
--
--   The first three are retargeted in 5b1e to a new PSO-only activity
--   table, `pso_contact_activities`. The fourth is a tag-block ripout
--   (no replacement — PSO contacts do not use tags). This migration
--   creates the new table additively so 5b2 can run as pure DDL drops
--   with zero code-migration scope.
--
-- HR4 strict separation:
--   FKs only to PSO entities + orgs + users. NO brand_id column. NO FK
--   to marketing_prospects / marketing_companies / brands. The PSO side
--   stays brand-free; the marketing side stays customer-free.
--
-- Column shape mirrors contact_activities (Sprint 2f convention):
--   payload jsonb, actor_id nullable FK, occurred_at + created_at
--   separate timestamps. type is plain text validated at the TS layer.
--
-- Idempotency:
--   IF NOT EXISTS guards on table + indexes. Safe against:
--     • Pre-5b1e   (full apply)
--     • Post-5b1e  (no-op)
--     • Re-runs    (no-op)
--
-- Reversibility:
--   Drop with `DROP TABLE IF EXISTS pso_contact_activities CASCADE;`
--   from a manual rollback file. Not part of automated rollback.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pso_contact_activities (
  id                   varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               varchar(36) NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_contact_id    varchar(36) NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE,
  company_id           varchar(36) REFERENCES companies(id) ON DELETE SET NULL,
  actor_id             varchar(36) REFERENCES users(id),
  type                 text        NOT NULL,
  payload              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at          timestamp   NOT NULL DEFAULT now(),
  created_at           timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pso_contact_activities_org_contact_idx
  ON pso_contact_activities (org_id, client_contact_id);

-- Matches the listCompanyActivities query shape (org_id + company_id +
-- ORDER BY created_at DESC) so the per-company timeline is an index seek
-- with no Sort node.
CREATE INDEX IF NOT EXISTS pso_contact_activities_org_company_created_idx
  ON pso_contact_activities (org_id, company_id, created_at DESC);
