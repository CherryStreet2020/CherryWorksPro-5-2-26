-- P0-TERM-PURGE: Rename "consultant" terminology to "team member"
-- This migration is idempotent and safe to re-run.

-- 1. Rename the role enum value CONSULTANT → TEAM_MEMBER
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CONSULTANT' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role RENAME VALUE 'CONSULTANT' TO 'TEAM_MEMBER';
  END IF;
END $$;

-- 2. Rename column max_consultants → max_team_members on orgs table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orgs' AND column_name = 'max_consultants') THEN
    ALTER TABLE orgs RENAME COLUMN max_consultants TO max_team_members;
  END IF;
END $$;

-- 3. Rename column consultant_id → team_member_id on consultant_payouts_v2 table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'consultant_payouts_v2' AND column_name = 'consultant_id') THEN
    ALTER TABLE consultant_payouts_v2 RENAME COLUMN consultant_id TO team_member_id;
  END IF;
END $$;

-- 4. Rename table consultant_payouts_v2 → team_member_payouts_v2
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consultant_payouts_v2') THEN
    ALTER TABLE consultant_payouts_v2 RENAME TO team_member_payouts_v2;
  END IF;
END $$;
