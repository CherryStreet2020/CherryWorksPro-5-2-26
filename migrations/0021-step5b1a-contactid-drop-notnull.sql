-- ─────────────────────────────────────────────────────────────────────
-- Sprint 2o.0 — Step 5b1a: relax legacy contact_id + lock in the
-- end-state PK on contact_tag_assignments
-- ─────────────────────────────────────────────────────────────────────
--
-- Background:
--   Step 5a TRUNCATEd contact_activities + contact_tag_assignments and
--   re-pointed the source-of-truth to marketing_prospects (via the new
--   prospect_id columns added in 0019). The application code in 5b1b
--   will be re-targeted to insert prospect_id only — without supplying
--   contact_id. Because contact_id was still NOT NULL with FK CASCADE
--   to the now-empty client_contacts, every such insert would fail.
--
-- Why Option B (composite PK swap) instead of a temporary surrogate:
--   contact_tag_assignments.contact_id participates in the composite PK
--   (contact_id, tag_id), so a plain DROP NOT NULL is rejected by
--   Postgres. Three options were on the table:
--     A — add a temporary surrogate `id uuid` PK in 5b1a, then unwind
--         it in 5b2. Pure churn — 5b2 immediately tears it down.
--     B — promote the new (prospect_id, tag_id) PK now. Safe because
--         the table is empty (verified at the top of the DO block),
--         making the SET NOT NULL on prospect_id a metadata-only flip
--         with the same blast-radius class as DROP NOT NULL.
--     C — drop the PK entirely until 5b2. Rejected: storage.ts uses
--         .onConflictDoNothing() without a target, which silently
--         swallows duplicates if no UNIQUE constraint exists.
--   Option B was approved. It also lets 5b2 collapse into the boring
--   column-drop + schema-marker-strip step it should be.
--
-- Idempotency:
--   Each ALTER is guarded against information_schema / pg_constraint so
--   this migration is safe against:
--     • Pre-5b1a   (legacy shape — full apply)
--     • Mid-5b1a   (partial apply — skips done statements, completes
--                   remainder; the up-front rowcount assert protects
--                   the prospect_id SET NOT NULL on a populated table)
--     • Post-5b1a  (fully no-op)
--     • Post-5b2   (contact_id columns dropped — guards short-circuit)
--
-- Reversibility:
--   Inverse manual rollback (NOT executed) at the bottom. Real rollback
--   path is the end-of-5a checkpoint.
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_act_rows               bigint;
  v_tag_rows               bigint;
  v_act_cid_present        boolean;
  v_act_cid_nullable       boolean;
  v_tag_cid_present        boolean;
  v_tag_cid_nullable       boolean;
  v_tag_pid_present        boolean;
  v_tag_pid_nullable       boolean;
  v_old_pk_exists          boolean;
  v_new_pk_exists          boolean;
  v_post_5b2_shape         boolean;
  v_tag_pid_already_notnull boolean;
BEGIN
  -- ── Post-state short-circuit (added after the original 5b1a/5b2 cycle
  --    completed successfully and a later test seed re-populated
  --    contact_activities). All structural changes this migration performs
  --    are already in the target shape if BOTH:
  --      • contact_id has been dropped from contact_activities AND
  --        contact_tag_assignments (Step 5b2 already ran), AND
  --      • contact_tag_assignments.prospect_id is NOT NULL
  --        (this migration's Step 2 already ran).
  --    Once that's true, every ALTER below is a no-op and the empty-table
  --    precondition (a safety belt for the original PK swap) no longer
  --    applies — there is no PK swap left to perform.
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_activities' AND column_name='contact_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_tag_assignments' AND column_name='contact_id'
  )
  INTO v_post_5b2_shape;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_tag_assignments'
      AND column_name='prospect_id' AND is_nullable='NO'
  ) INTO v_tag_pid_already_notnull;

  IF v_post_5b2_shape AND v_tag_pid_already_notnull THEN
    RAISE NOTICE '[0021] No-op — post-5b2 shape already in place (contact_id dropped on both tables, prospect_id NOT NULL)';
    RETURN;
  END IF;

  -- ── Belt-and-suspenders: empty-table precondition for Option B ────
  -- The (prospect_id, tag_id) PK promotion is only safe if no row
  -- has a NULL prospect_id. Step 5a TRUNCATEd both tables; verify.
  EXECUTE 'SELECT count(*) FROM contact_activities'      INTO v_act_rows;
  EXECUTE 'SELECT count(*) FROM contact_tag_assignments' INTO v_tag_rows;

  IF v_act_rows <> 0 OR v_tag_rows <> 0 THEN
    RAISE EXCEPTION '[0021] ABORT: Option B requires empty tables. contact_activities=%, contact_tag_assignments=%',
      v_act_rows, v_tag_rows;
  END IF;

  -- ── Step 1: contact_activities.contact_id → nullable ──────────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_activities' AND column_name='contact_id'
  ) INTO v_act_cid_present;

  IF v_act_cid_present THEN
    SELECT (is_nullable = 'YES') FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contact_activities' AND column_name='contact_id'
      INTO v_act_cid_nullable;
    IF NOT v_act_cid_nullable THEN
      ALTER TABLE contact_activities ALTER COLUMN contact_id DROP NOT NULL;
      RAISE NOTICE '[0021] step 1: contact_activities.contact_id → nullable';
    ELSE
      RAISE NOTICE '[0021] step 1: contact_activities.contact_id already nullable — skipped';
    END IF;
  ELSE
    RAISE NOTICE '[0021] step 1: contact_activities.contact_id absent — skipped';
  END IF;

  -- ── Step 2: contact_tag_assignments.prospect_id → NOT NULL ────────
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_tag_assignments' AND column_name='prospect_id'
  ) INTO v_tag_pid_present;

  IF v_tag_pid_present THEN
    SELECT (is_nullable = 'YES') FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contact_tag_assignments' AND column_name='prospect_id'
      INTO v_tag_pid_nullable;
    IF v_tag_pid_nullable THEN
      ALTER TABLE contact_tag_assignments ALTER COLUMN prospect_id SET NOT NULL;
      RAISE NOTICE '[0021] step 2: contact_tag_assignments.prospect_id → NOT NULL';
    ELSE
      RAISE NOTICE '[0021] step 2: contact_tag_assignments.prospect_id already NOT NULL — skipped';
    END IF;
  ELSE
    RAISE EXCEPTION '[0021] step 2: contact_tag_assignments.prospect_id missing — Step 0019 not applied?';
  END IF;

  -- ── Step 3: drop legacy composite PK on (contact_id, tag_id) ──────
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_tag_assignments_contact_id_tag_id_pk'
      AND conrelid = 'public.contact_tag_assignments'::regclass
  ) INTO v_old_pk_exists;

  IF v_old_pk_exists THEN
    ALTER TABLE contact_tag_assignments DROP CONSTRAINT contact_tag_assignments_contact_id_tag_id_pk;
    RAISE NOTICE '[0021] step 3: dropped legacy PK contact_tag_assignments_contact_id_tag_id_pk';
  ELSE
    RAISE NOTICE '[0021] step 3: legacy PK already absent — skipped';
  END IF;

  -- ── Step 4: add new composite PK on (prospect_id, tag_id) ─────────
  -- Skip if any PK constraint already exists on the table (idempotent
  -- against re-runs and against future shape changes).
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contact_tag_assignments'::regclass
      AND contype  = 'p'
  ) INTO v_new_pk_exists;

  IF NOT v_new_pk_exists THEN
    ALTER TABLE contact_tag_assignments
      ADD CONSTRAINT contact_tag_assignments_pkey
      PRIMARY KEY (prospect_id, tag_id);
    RAISE NOTICE '[0021] step 4: added PK contact_tag_assignments_pkey on (prospect_id, tag_id)';
  ELSE
    RAISE NOTICE '[0021] step 4: PK already present — skipped';
  END IF;

  -- ── Step 5: contact_tag_assignments.contact_id → nullable ─────────
  -- Now safe because contact_id is no longer in any PK.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contact_tag_assignments' AND column_name='contact_id'
  ) INTO v_tag_cid_present;

  IF v_tag_cid_present THEN
    SELECT (is_nullable = 'YES') FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contact_tag_assignments' AND column_name='contact_id'
      INTO v_tag_cid_nullable;
    IF NOT v_tag_cid_nullable THEN
      ALTER TABLE contact_tag_assignments ALTER COLUMN contact_id DROP NOT NULL;
      RAISE NOTICE '[0021] step 5: contact_tag_assignments.contact_id → nullable';
    ELSE
      RAISE NOTICE '[0021] step 5: contact_tag_assignments.contact_id already nullable — skipped';
    END IF;
  ELSE
    RAISE NOTICE '[0021] step 5: contact_tag_assignments.contact_id absent — skipped';
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Inverse (manual rollback, NOT executed):
--   ALTER TABLE contact_tag_assignments DROP CONSTRAINT contact_tag_assignments_pkey;
--   ALTER TABLE contact_tag_assignments ADD  CONSTRAINT contact_tag_assignments_contact_id_tag_id_pk
--     PRIMARY KEY (contact_id, tag_id);
--   ALTER TABLE contact_tag_assignments ALTER COLUMN prospect_id DROP NOT NULL;
--   ALTER TABLE contact_tag_assignments ALTER COLUMN contact_id  SET  NOT NULL;
--   ALTER TABLE contact_activities      ALTER COLUMN contact_id  SET  NOT NULL;
-- All safe against the empty post-5a tables. Real rollback path is the
-- end-of-5a checkpoint (or the pre-5b1a checkpoint b1c0c9a2).
-- ─────────────────────────────────────────────────────────────────────
