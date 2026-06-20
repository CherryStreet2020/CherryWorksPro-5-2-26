-- Task #234 — Add audience targeting to marketing campaigns.
--
-- Today the scheduled-send worker broadcasts every campaign to all
-- undeleted brand contacts. This migration adds two columns so admins can
-- target a specific saved segment:
--
--   * audience_type  — 'all' (default, backward-compatible) or 'segment'.
--   * audience_segment_id — FK to contact_segments when audience_type is
--     'segment'. ON DELETE SET NULL so deleting a segment falls back to
--     'all' rather than orphaning the campaign (the route still validates
--     audience_type='all' when audience_segment_id is null).
--
-- Idempotent so Phase 0 replay is safe across reboots.

ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS audience_type text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS audience_segment_id varchar(36)
    REFERENCES contact_segments(id) ON DELETE SET NULL;

-- Defensive sanity: if a previous attempt left the column nullable, lock
-- it back down. ADD COLUMN IF NOT EXISTS skips the NOT NULL when the
-- column already exists.
ALTER TABLE marketing_campaigns
  ALTER COLUMN audience_type SET DEFAULT 'all',
  ALTER COLUMN audience_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_campaigns_audience_segment_idx
  ON marketing_campaigns (audience_segment_id)
  WHERE audience_segment_id IS NOT NULL;

-- Defence-in-depth: even if a future writer skips the route-level Zod
-- validation, the database itself rejects out-of-band audience values
-- and rejects an audience_type/audience_segment_id mismatch.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_campaigns_audience_type_chk'
  ) THEN
    ALTER TABLE marketing_campaigns
      ADD CONSTRAINT marketing_campaigns_audience_type_chk
      CHECK (audience_type IN ('all', 'segment'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_campaigns_audience_segment_chk'
  ) THEN
    ALTER TABLE marketing_campaigns
      ADD CONSTRAINT marketing_campaigns_audience_segment_chk
      CHECK (
        (audience_type = 'segment' AND audience_segment_id IS NOT NULL)
        OR (audience_type = 'all' AND audience_segment_id IS NULL)
      );
  END IF;
END $$;
