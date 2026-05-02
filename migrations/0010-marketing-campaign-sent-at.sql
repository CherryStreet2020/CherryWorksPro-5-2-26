-- Task #207 — Track when a campaign has been dispatched.
--
-- Adds `sent_at` to marketing_campaigns so the scheduled-send worker can
-- distinguish campaigns it still needs to dispatch (`sent_at IS NULL AND
-- send_at <= now()`) from ones it has already broadcast. Without this
-- column the worker would re-broadcast the same campaign on every tick.
-- Idempotent so Phase 0 replay is safe across reboots.

ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS sent_at timestamp;

CREATE INDEX IF NOT EXISTS marketing_campaigns_pending_idx
  ON marketing_campaigns (send_at)
  WHERE sent_at IS NULL AND send_at IS NOT NULL;
