-- Migration 0004: Contractor term purge
-- Renames contractor-related DB objects to neutral terminology
-- Idempotent: safe to run multiple times

-- 1. Rename contractor_payouts table → imported_payouts
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contractor_payouts') THEN
    ALTER TABLE contractor_payouts RENAME TO imported_payouts;
    RAISE NOTICE 'contractor_payouts → imported_payouts';
  END IF;
END $$;

-- 2. Rename users.contractor_agreement_signed → agreement_signed
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'contractor_agreement_signed') THEN
    ALTER TABLE users RENAME COLUMN contractor_agreement_signed TO agreement_signed;
    RAISE NOTICE 'users.contractor_agreement_signed → agreement_signed';
  END IF;
END $$;

-- 3. Update worker_type values: 1099_CONTRACTOR → INDEPENDENT
UPDATE users SET worker_type = 'INDEPENDENT' WHERE worker_type = '1099_CONTRACTOR';
