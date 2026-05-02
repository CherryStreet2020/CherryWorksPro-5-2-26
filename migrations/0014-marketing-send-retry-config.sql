-- Task #271: Make the marketing send-retry policy (max attempts + base
-- backoff) configurable per organization. Previously hard-coded as
-- module constants in server/marketing/scheduled-send.ts (5 attempts,
-- 5min base backoff) with env-var overrides only.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS marketing_send_max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS marketing_send_retry_base_ms INTEGER NOT NULL DEFAULT 300000;
