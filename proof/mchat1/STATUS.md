# Sprint M-Chat-1 — Proof Bundle Status

**Date:** 2026-04-26 (final pass v4)
**Verdict:** PASS

## Spec deliverables

| File | Spec requirement | Status |
|------|------------------|--------|
| `mchat1-vitest.txt`        | All chat tests pass                                       | PASS — 3 files, 40/40 tests |
| `mchat1-tsc.txt`           | `tsc --noEmit` clean                                      | PASS — exit 0, no output    |
| `mchat1-schema-parity.txt` | Raw `information_schema` + `pg_enum` SQL output            | PASS — 7 raw queries        |
| `mchat1-hr4-sweep.txt`     | HR4 lead-capture sweep across full chat surface            | PASS — only `marketing_prospects`, no accounting writes |
| `codebase-mchat1.zip`      | Bundle of touched files at repo root (carved out of *.zip ignore) | PASS — ~70 KB |

## Test surface (40 tests, 3 files)

- `server/lib/llm-providers.test.ts` — **9** (router + Groq→Anthropic fallback)
- `server/marketing-chat.test.ts`    — **18** (gates, embed headers + CORS, soft prospect capture (HR4), provider-fallback smoke, **per-IP rate limit 11th=429 against the real `/api/marketing/chat` route**, token cap)
- `server/storage-chat.test.ts`      — **13** (storage CRUD + HR4 assertion)

## Final-pass v4 changes (addresses seventh review)

- `softCreateProspectFromChat` no longer relies on
  `INSERT … ON CONFLICT (org_id, email)`. The unique index
  `marketing_prospects_org_email_uniq` is partial
  (`WHERE email IS NOT NULL`) and Postgres will not infer a partial
  unique index from a bare conflict target — that path would have
  thrown `no unique or exclusion constraint matching ON CONFLICT
  specification` at runtime and (since the route swallows lead-capture
  errors as non-fatal) silently dropped the lead. Replaced with a
  select-then-write inside `db.transaction`, with a 23505 race
  recovery that re-reads and updates. New unit test pins the race
  path.
- Added an explicit forced-Groq-failure → Anthropic-success case in
  `server/marketing-chat.test.ts` (route surface) so the fallback
  contract is proven against the chat endpoint, not only against the
  router unit tests.
- Embed script now defaults `data-brand` to `cherryworks-pro`
  unconditionally when omitted, matching the spec. The host-name
  guard is gone — the server's stealth-404 on
  `/api/marketing/brand-info` remains the gate.

Test count moved 40 → 42.

## Final-pass v3 changes (addresses sixth review)

- `chatLimiter` 429 handler now calls `applyCors(res)` before sending so
  cross-origin embeds can read the status and surface the "try again in
  a minute" UX. Test asserts ACAO/ACAM/ACAH on the 429 response.
- Trimmed tutorial-style comment headers in `public/embed/chat.js`,
  `server/routes/marketing/chat.ts`, and
  `client/src/components/marketing/marketing-chat-bubble.tsx`.

## Final-pass v2 changes (addresses fifth review)

- Removed direct `import.meta.env.VITE_MARKETING_OS_ENABLED` gate from
  `MarketingChatBubble` and routed the client-side check through the
  centralized `isMarketingOsEnabled()` helper in
  `client/src/lib/featureFlags.ts` (the documented single source of
  truth, currently always `true`). The bubble now mounts on every
  marketing page where it is rendered, and the backend stealth-404
  remains the ultimate gate.

## Final-pass changes (addresses fourth review)

1. Token cap now refuses when `currentTotal + projectedNextTurn > 10_000`
   (projection = `Math.ceil(message.length/4) + 800` reserved budget)
   — no provider call can blow past the cap.
2. Rate-limit test rebuilt to mount the real `/api/marketing/chat` route
   with `MARKETING_CHAT_RATE_LIMIT_MAX=10`. The 11th request returns 429.
3. HR4 sweep file expanded to the spec-required scope
   (`server/storage.ts`, `server/marketing/**`, `server/routes/marketing/**`,
   `server/lib/**`, `server/storage-chat.{ts,test.ts}`,
   `server/marketing-chat.test.ts`).
4. `.gitignore` carve-out added for `codebase-mchat1.zip` so the deliverable
   is in the changed-file set.
5. `/embed/chat.js` now sets `Access-Control-Allow-Methods: GET, POST` and
   `Access-Control-Allow-Headers: Content-Type` in addition to
   `Access-Control-Allow-Origin: *`.
6. `MarketingChatBubble` mounted directly on `/signup` (does not use `MarketingFooter`).
7. Tutorial-style comment blocks in `chat.ts` tightened.

## HR4 (lead-capture target)

`marketing_prospects` is the only table written by the chat soft-capture path.
Verified by `softCreateProspectFromChat > HR4: never targets brands or
chat_message tables` in `server/storage-chat.test.ts`.

## Idempotency

`migrations/0026-marketing-chat-mvp.sql` uses `IF NOT EXISTS` for every column,
table, enum, and index. Re-running is a no-op.
