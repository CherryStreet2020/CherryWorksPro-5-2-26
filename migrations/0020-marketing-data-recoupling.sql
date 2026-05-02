-- Sprint 2o.0 Step 5a — data recoupling
-- Move all client_contacts → marketing_prospects (335 expected) and
-- companies → marketing_companies (157 source rows, but deduplicated by
-- (org_id, domain) per Marketing OS invariant — 18 distinct domained
-- pairs + 17 NULL-domain rows = ~35 surviving marketing_companies).
-- TRUNCATE the seed-only contact_activities (6,952 perf-2f-phase7) and
-- contact_tag_assignments (3 Sprint-2d s2d-* fixtures). Delete now-empty
-- source rows.
--
-- DEDUP HANDLING: 130 of 140 domained source companies share an (org_id,
-- domain) pair (test domains: x.test, example.com, x.com, etc.). The
-- marketing_companies_org_domain_uniq partial unique index forbids dups.
-- Resolution: per (org_id, domain) cluster, the OLDEST row wins as
-- survivor; all sibling old_ids in _company_map point to the survivor's
-- new_id so client_contacts.company_id pointers remap correctly. Audit
-- table records all 157 source rows; dedup is implicit when multiple
-- old_ids share a new_id.
--
-- IDEMPOTENT: re-runs are no-ops via the sprint_2o0_migration_audit guard.
-- ATOMICITY: entire body wrapped in a single DO block (one txn). RAISE
-- EXCEPTION on verification failure rolls back the whole migration.
-- ROLLBACK ANCHOR: post-Step-1 checkpoint (see STEP4_REVIEW.md).
--
-- DO NOT TRUNCATE / DELETE clients — 1,069 rows are load-bearing for
-- invoices/projects/estimates/etc. (verified in Step 4 FK enumeration).

CREATE TABLE IF NOT EXISTS sprint_2o0_migration_audit (
  id serial PRIMARY KEY,
  entity_type text NOT NULL,
  old_id varchar(36) NOT NULL,
  new_id varchar(36) NOT NULL,
  org_id varchar(36) NOT NULL,
  brand_id varchar(36),
  identifying_field text,
  lifecycle_stage text NOT NULL,
  migration_source text NOT NULL DEFAULT 'sprint-2o.0-0020',
  dedup_role text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT sprint_2o0_audit_unique UNIQUE (entity_type, old_id)
);

DO $$
DECLARE
  audit_existing         int;
  contacts_total         int;
  companies_total        int;
  companies_survivors    int;
  contacts_moved         int;
  backlink_count         int;
  prospect_count         int;
  contacts_remaining     int;
  companies_remaining    int;
  prior_migrated_count   int;
BEGIN
  -- Idempotency guard: scope by migration_source so this migration's sentinel
  -- can't be conflated with any future sprint's writes to the same audit table.
  SELECT count(*) INTO audit_existing
    FROM sprint_2o0_migration_audit
    WHERE migration_source = 'sprint-2o.0-0020';
  SELECT count(*) INTO contacts_total  FROM client_contacts;
  SELECT count(*) INTO companies_total FROM companies;

  -- Post-state probe (survives audit-table loss). The original Phase-3 INSERT
  -- stamps every freshly migrated prospect with lead_source = 'migrated_from
  -- _client_contacts' — that marker is the strongest "we've run before" signal
  -- and outlives the audit table even if a `db:push --force` drops the audit
  -- (the audit table is not in the Drizzle schema).
  SELECT count(*) INTO prior_migrated_count
    FROM marketing_prospects
    WHERE lead_source = 'migrated_from_client_contacts';

  RAISE NOTICE '[0020] Pre-flight: % client_contacts, % companies, % audit rows from sprint-2o.0-0020 already present, % prospects already carrying the migration marker',
               contacts_total, companies_total, audit_existing, prior_migrated_count;

  -- Three independent guards. ANY triggers no-op:
  --   (a) Our migration's sentinel/audit rows already present → already ran.
  --   (b) Both source tables empty → nothing to migrate.
  --   (c) Marketing_prospects already carries the migration marker → a prior
  --       run completed Phase 3, even if the audit table has since been
  --       dropped. Lingering rows in client_contacts/companies belong to a
  --       separate seed cycle (test fixtures created after the original
  --       migration) and are NOT this migration's responsibility — re-running
  --       Phase 1 (TRUNCATE) on them would silently destroy real fixture
  --       state and the verification anyway can't reconcile partial deltas
  --       against the cumulative Phase-3 marker count.
  IF audit_existing > 0
     OR (contacts_total = 0 AND companies_total = 0)
     OR prior_migrated_count > 0 THEN
    -- Persist a sentinel for every no-op branch so that future boots stay
    -- no-op even if state shifts beneath us. Two distinct sentinel labels
    -- so debugging a future replay can distinguish "we recovered after the
    -- audit table was dropped" from "fresh DB had nothing to migrate".
    --   • audit-recreated-after-drop: post-state marker existed but audit
    --     was missing (the broken-state recovery path).
    --   • empty-source-lock: cold boot with no source rows at all — without
    --     this, a later seed of client_contacts/companies on a previously
    --     no-opped DB would cause 0020 to run and migrate/destroy that
    --     freshly-seeded data on the *next* restart.
    IF audit_existing = 0 AND prior_migrated_count > 0 THEN
      INSERT INTO sprint_2o0_migration_audit
        (entity_type, old_id, new_id, org_id, brand_id,
         identifying_field, lifecycle_stage, dedup_role, migration_source)
      VALUES ('sentinel', 'sentinel-recreated', 'sentinel-recreated',
              '00000000-0000-0000-0000-000000000000', NULL,
              'audit-recreated-after-drop', 'lead', 'sentinel',
              'sprint-2o.0-0020')
      ON CONFLICT (entity_type, old_id) DO NOTHING;
      RAISE NOTICE '[0020] No-op — % prospects already carry migration marker; audit sentinel recreated',
                   prior_migrated_count;
    ELSIF audit_existing = 0 AND contacts_total = 0 AND companies_total = 0 THEN
      INSERT INTO sprint_2o0_migration_audit
        (entity_type, old_id, new_id, org_id, brand_id,
         identifying_field, lifecycle_stage, dedup_role, migration_source)
      VALUES ('sentinel', 'empty-source-lock', 'empty-source-lock',
              '00000000-0000-0000-0000-000000000000', NULL,
              'cold-boot-empty-sources', 'lead', 'sentinel',
              'sprint-2o.0-0020')
      ON CONFLICT (entity_type, old_id) DO NOTHING;
      RAISE NOTICE '[0020] No-op — fresh DB with empty sources; empty-source sentinel locked';
    ELSE
      RAISE NOTICE '[0020] No-op — already migrated (audit=%, contacts=%, companies=%, marker=%)',
                   audit_existing, contacts_total, companies_total, prior_migrated_count;
    END IF;
    RETURN;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────
  -- Phase 1: TRUNCATE seed-only activities + tag assignments
  -- ──────────────────────────────────────────────────────────────────────
  TRUNCATE contact_activities;
  TRUNCATE contact_tag_assignments;
  RAISE NOTICE '[0020] Phase 1 done: truncated contact_activities + contact_tag_assignments';

  -- ──────────────────────────────────────────────────────────────────────
  -- Phase 2: Build company dedup mapping
  -- For each (org_id, domain) cluster with domain IS NOT NULL: oldest row
  --   = survivor, gets a fresh new_id, all siblings point to same new_id.
  -- For domain IS NULL rows: each gets its own unique new_id.
  -- ──────────────────────────────────────────────────────────────────────
  CREATE TEMP TABLE _company_survivors (
    survivor_old_id varchar(36) PRIMARY KEY,
    new_id          varchar(36) NOT NULL DEFAULT (gen_random_uuid())::varchar
  ) ON COMMIT DROP;

  -- Survivors: oldest per (org_id, domain) for domained rows + every NULL-domain row
  INSERT INTO _company_survivors (survivor_old_id)
  SELECT id FROM (
    SELECT id,
           row_number() OVER (PARTITION BY org_id, domain ORDER BY created_at, id) AS rn
    FROM companies
    WHERE domain IS NOT NULL
  ) ranked
  WHERE rn = 1
  UNION ALL
  SELECT id FROM companies WHERE domain IS NULL;

  -- _company_map: every source company → its cluster's survivor's new_id
  CREATE TEMP TABLE _company_map (
    old_id      varchar(36) PRIMARY KEY,
    new_id      varchar(36) NOT NULL,
    is_survivor boolean     NOT NULL
  ) ON COMMIT DROP;

  -- Domained rows: every old_id → survivor's new_id from same (org_id, domain)
  INSERT INTO _company_map (old_id, new_id, is_survivor)
  SELECT
    c.id,
    s.new_id,
    (c.id = s.survivor_old_id)
  FROM companies c
  JOIN companies sc ON sc.org_id = c.org_id
                   AND sc.domain IS NOT DISTINCT FROM c.domain
  JOIN _company_survivors s ON s.survivor_old_id = sc.id
  WHERE c.domain IS NOT NULL
    AND sc.id = (
      SELECT id FROM companies cc
      WHERE cc.org_id = c.org_id AND cc.domain = c.domain
      ORDER BY cc.created_at, cc.id LIMIT 1
    );

  -- NULL-domain rows: 1:1
  INSERT INTO _company_map (old_id, new_id, is_survivor)
  SELECT c.id, s.new_id, true
  FROM companies c
  JOIN _company_survivors s ON s.survivor_old_id = c.id
  WHERE c.domain IS NULL;

  -- ──────────────────────────────────────────────────────────────────────
  -- Phase 2b: Insert survivors into marketing_companies
  -- ──────────────────────────────────────────────────────────────────────
  INSERT INTO marketing_companies (
    id, org_id, brand_id, name, domain, industry, size_bucket, linkedin_url,
    owner_user_id, lifecycle_stage, deleted_at, created_at, updated_at
  )
  SELECT
    m.new_id, c.org_id, c.brand_id, c.name, c.domain, c.industry, c.size_band, c.linkedin_url,
    c.owner_user_id, 'prospect', c.deleted_at, c.created_at, c.updated_at
  FROM companies c
  JOIN _company_map m ON m.old_id = c.id
  WHERE m.is_survivor = true;

  GET DIAGNOSTICS companies_survivors = ROW_COUNT;

  -- Audit: every source company (survivors + dedup-collapsed siblings)
  INSERT INTO sprint_2o0_migration_audit
    (entity_type, old_id, new_id, org_id, brand_id, identifying_field, lifecycle_stage, dedup_role)
  SELECT
    'marketing_company',
    m.old_id,
    m.new_id,
    c.org_id,
    c.brand_id,
    COALESCE(c.domain, c.name),
    'prospect',
    CASE WHEN m.is_survivor THEN 'survivor' ELSE 'collapsed_to_survivor' END
  FROM _company_map m
  JOIN companies c ON c.id = m.old_id;

  RAISE NOTICE '[0020] Phase 2 done: % source companies → % survivors (% deduped)',
               companies_total, companies_survivors, companies_total - companies_survivors;

  -- ──────────────────────────────────────────────────────────────────────
  -- Phase 3: Migrate client_contacts → marketing_prospects
  -- ──────────────────────────────────────────────────────────────────────
  CREATE TEMP TABLE _prospect_map (
    old_id varchar(36) PRIMARY KEY,
    new_id varchar(36) NOT NULL DEFAULT (gen_random_uuid())::varchar
  ) ON COMMIT DROP;
  INSERT INTO _prospect_map (old_id) SELECT id FROM client_contacts;

  INSERT INTO marketing_prospects (
    id, org_id, brand_id, company_id, first_name, last_name, email, phone, title,
    linkedin_url, location, lifecycle_stage, lead_source, lead_score,
    unsubscribe_token, unsubscribed_at, bounced_at, last_activity_at,
    notes, owner_user_id, deleted_at, created_at, updated_at
  )
  SELECT
    p.new_id, cc.org_id, cc.brand_id,
    cm.new_id,
    cc.first_name, cc.last_name, cc.email, cc.phone, cc.title,
    cc.linkedin_url, cc.location,
    'lead'::marketing_prospect_lifecycle_stage,
    'migrated_from_client_contacts',
    0,
    (gen_random_uuid())::text,
    cc.unsubscribed_at, cc.bounced_at, cc.last_activity_at,
    cc.notes, cc.owner_user_id, cc.deleted_at, cc.created_at, cc.updated_at
  FROM client_contacts cc
  JOIN _prospect_map p ON p.old_id = cc.id
  LEFT JOIN _company_map cm ON cm.old_id = cc.company_id;

  GET DIAGNOSTICS contacts_moved = ROW_COUNT;

  -- In-transaction back-link proof
  UPDATE client_contacts cc
     SET originated_from_prospect_id = p.new_id,
         marketing_converted_at      = now()
    FROM _prospect_map p
   WHERE cc.id = p.old_id;

  -- BIJECTION verification (architect-recommended hardening over plain count
  -- equality). Three independent checks must all hold:
  --   (1) Total backlink rows == total prospects == contacts_moved
  --   (2) DISTINCT originated_from_prospect_id values == backlink rows
  --       (no two contacts back-link to the same prospect)
  --   (3) Anti-join: every (old_id, new_id) pair from _prospect_map exists
  --       exactly once in (client_contacts → marketing_prospects)
  DECLARE
    distinct_backlinks  int;
    bijection_misses    int;
  BEGIN
    SELECT count(*) INTO backlink_count
      FROM client_contacts WHERE originated_from_prospect_id IS NOT NULL;
    SELECT count(*) INTO prospect_count
      FROM marketing_prospects WHERE lead_source = 'migrated_from_client_contacts';
    SELECT count(DISTINCT originated_from_prospect_id) INTO distinct_backlinks
      FROM client_contacts WHERE originated_from_prospect_id IS NOT NULL;
    SELECT count(*) INTO bijection_misses
      FROM _prospect_map p
      WHERE NOT EXISTS (
        SELECT 1 FROM client_contacts cc
         WHERE cc.id = p.old_id AND cc.originated_from_prospect_id = p.new_id
      )
         OR NOT EXISTS (
        SELECT 1 FROM marketing_prospects mp
         WHERE mp.id = p.new_id AND mp.lead_source = 'migrated_from_client_contacts'
      );

    IF backlink_count <> prospect_count OR backlink_count <> contacts_moved THEN
      RAISE EXCEPTION
        '[0020] Verification FAILED (count) — backlinks=%, prospects=%, contacts_moved=%',
        backlink_count, prospect_count, contacts_moved;
    END IF;
    IF distinct_backlinks <> backlink_count THEN
      RAISE EXCEPTION
        '[0020] Verification FAILED (uniqueness) — % backlinks but only % distinct prospect_ids',
        backlink_count, distinct_backlinks;
    END IF;
    IF bijection_misses > 0 THEN
      RAISE EXCEPTION
        '[0020] Verification FAILED (bijection) — % _prospect_map pairs missing or mismatched',
        bijection_misses;
    END IF;
    RAISE NOTICE '[0020] Verification OK: % bijective backlinks ↔ % prospects (0 misses)',
                 backlink_count, prospect_count;
  END;

  INSERT INTO sprint_2o0_migration_audit
    (entity_type, old_id, new_id, org_id, brand_id, identifying_field, lifecycle_stage, dedup_role)
  SELECT 'prospect',
         p.old_id, p.new_id, cc.org_id, cc.brand_id,
         COALESCE(cc.email, NULLIF(trim(cc.first_name || ' ' || cc.last_name), ''), '<unnamed>'),
         'lead',
         'survivor'
    FROM _prospect_map p
    JOIN client_contacts cc ON cc.id = p.old_id;

  RAISE NOTICE '[0020] Phase 3 done: % client_contacts → marketing_prospects', contacts_moved;

  -- ──────────────────────────────────────────────────────────────────────
  -- Phase 4: DELETE the now-untethered source rows
  -- ──────────────────────────────────────────────────────────────────────
  DELETE FROM client_contacts;
  DELETE FROM companies;

  SELECT count(*) INTO contacts_remaining  FROM client_contacts;
  SELECT count(*) INTO companies_remaining FROM companies;

  IF contacts_remaining > 0 OR companies_remaining > 0 THEN
    RAISE EXCEPTION
      '[0020] Phase 4 verification FAILED — % client_contacts + % companies still present',
      contacts_remaining, companies_remaining;
  END IF;

  RAISE NOTICE '[0020] Phase 4 done. Source tables empty. Migration complete: % prospects, % marketing_companies (from % source companies)',
               contacts_moved, companies_survivors, companies_total;
END $$;
