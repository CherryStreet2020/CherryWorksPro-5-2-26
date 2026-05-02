-- Sprint M-Chat-1 — Native AI Marketing Chatbot MVP.
--
-- Additive-only schema for the cherryworkspro.com chatbot:
--   * 4 nullable columns on `brands` (chat_enabled / chat_persona_name /
--     chat_welcome_message / chat_system_prompt).
--   * 2 new pgEnums (marketing_chat_conversation_status,
--     marketing_chat_message_role).
--   * 2 new tables (marketing_chat_conversations, marketing_chat_messages).
--
-- Every statement is idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE
-- IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and DO $$ … duplicate_object
-- guarded enum creation. The Phase-0 boot replay (`runPhase0SqlReplay`)
-- runs this on every server start; second runs must be no-ops.
--
-- The `brands` table itself was created via db:push (no prior migration
-- file), so we cannot assume any column except those Drizzle has been
-- pushing. The four ADD COLUMN guards here are tested by replaying the
-- migration twice in dev with zero diff.

-- ───────────────────────────────────────────────────────────────────────
-- Step 1: 4 additive columns on `brands`. All nullable, no DEFAULT that
-- would touch existing rows aside from chat_enabled defaulting to false.
-- ───────────────────────────────────────────────────────────────────────
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN DEFAULT false;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS chat_persona_name TEXT;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS chat_welcome_message TEXT;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS chat_system_prompt TEXT;

-- ───────────────────────────────────────────────────────────────────────
-- Step 2: pgEnums.
-- CREATE TYPE has no IF NOT EXISTS in PostgreSQL 14, so we wrap each
-- in a DO $$ block that swallows the duplicate_object exception. This
-- keeps the migration idempotent across replays.
-- ───────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE marketing_chat_conversation_status AS ENUM ('active', 'ended', 'abandoned');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE marketing_chat_message_role AS ENUM ('user', 'assistant', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- Step 3: marketing_chat_conversations.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_chat_conversations (
  id               VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           VARCHAR(36) NOT NULL REFERENCES orgs(id),
  brand_id         VARCHAR(36) NOT NULL REFERENCES brands(id),
  prospect_id      VARCHAR(36) REFERENCES marketing_prospects(id) ON DELETE SET NULL,
  session_token    TEXT NOT NULL,
  status           marketing_chat_conversation_status NOT NULL DEFAULT 'active',
  summary          TEXT,
  started_at       TIMESTAMP NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMP NOT NULL DEFAULT now(),
  ended_at         TIMESTAMP,
  tokens_in_total  INTEGER NOT NULL DEFAULT 0,
  tokens_out_total INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS marketing_chat_conv_org_brand_idx
  ON marketing_chat_conversations (org_id, brand_id);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_chat_conv_brand_session_uniq
  ON marketing_chat_conversations (brand_id, session_token);

CREATE INDEX IF NOT EXISTS marketing_chat_conv_prospect_idx
  ON marketing_chat_conversations (prospect_id)
  WHERE prospect_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────
-- Step 4: marketing_chat_messages.
-- ON DELETE CASCADE on conversation_id keeps message GC trivial when a
-- conversation row is purged.
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_chat_messages (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(36) NOT NULL REFERENCES marketing_chat_conversations(id) ON DELETE CASCADE,
  role            marketing_chat_message_role NOT NULL,
  content         TEXT NOT NULL,
  model           TEXT,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_chat_msg_conv_created_idx
  ON marketing_chat_messages (conversation_id, created_at);
