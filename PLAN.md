# PLAN — ACS Email as the marketing transport (campaigns + sequence steps) — r13

Status: plan only, no code. Base: `origin/main` = `b0256cf`. Branch: `plan/acs-marketing-transport`.
r4 was a full rewrite consolidating r1–r3; r5–r13 fold review rounds 4–12; only the revision log at the end
refers to earlier versions. Everything above the log is the operative design.

## Goal

Marketing mail (campaign broadcasts and sequence steps) for the operator's own brands goes out through
Azure Communication Services Email from `hello@news.<brand>` instead of the org's M365 mailbox.
Transactional and platform mail (`server/email.ts` `pickTransport`, `sendPlatformNotice`) is untouched.
Every other org, and any operator mail not from an allowlisted sender, keeps today's path byte-for-byte.

Why: bulk mail through the operator's M365 mailbox shares reputation and Exchange limits with invoices,
magic links and support mail. Graph also drops `List-Unsubscribe` (only `X-` headers survive,
`server/email/graph-transport.ts:187-191`) and sends no text part.

## Already done outside the repo (2026-10-27, Dean's go)

- ACS Email Service `cwp-email` (cwp-rg, US data location). Five customer-managed domains, Domain/SPF/
  DKIM/DKIM2 **Verified**, ACS engagement tracking **Disabled** (first-party tracking, #92/#94):
  `news.cherryworkspro.com`, `news.cherrystconsulting.com`, `news.venturuseq.com`,
  `news.venturuseam.com`, `news.venturusos.com`; each has `_dmarc.news` p=none.
- Sender username `hello` on each domain (display names = brand names).
- Communication Services `cwp-comms` (`https://cwp-comms.unitedstates.communication.azure.com`), all five
  domains linked. `cwp-app`'s managed identity holds **Communication and Email Service Owner** on it →
  Entra ID auth, **no connection string or key exists**.

## Constraints

1. **ACS Email retires 2028-09-30** (maintenance mode). Dean chose ACS now behind a provider-neutral seam;
   ACS specifics live only in `server/email/acs-transport.ts` and the routing module.
2. **Default quota 30/min + 100/hour per subscription**; raises are a manual support request gated on a
   low failure rate. 429 is routine and must never drop mail or spin.
3. ACS is **asynchronous**: POST returns 202 + an operation that later becomes `Succeeded`, `Failed` or
   `Canceled` ([Send](https://learn.microsoft.com/en-us/rest/api/communication/email/email/send?view=rest-communication-email-2025-09-01),
   [Get Send Result](https://learn.microsoft.com/en-us/rest/api/communication/email/email/get-send-result?view=rest-communication-email-2025-09-01)).
   Delivery/bounce reports are a further, later stage (Phase 2).
4. The display name comes from the ACS sender config, not the request; campaign `fromName` is ignored on
   the ACS route (UI hint added).
5. Whether ACS dedupes a repeated `Operation-Id` is **undocumented**. The design never re-POSTs a message
   whose fate is unknown, so it does not depend on dedupe.

## 1. Routing (`server/email/marketing-route.ts`, pure)

`resolveMarketingRoute(org, effectiveFrom) → "acs" | "connected"`. ACS only when all hold:
- `ACS_EMAIL_ENDPOINT` set;
- org slug ∈ `ACS_EMAIL_ORG_SLUGS` (comma list; prod `cherry-street-consulting`);
- `effectiveFrom` (lower-cased, trimmed) ∈ `ACS_EMAIL_SENDERS` (exact addresses).

Env parsing: trim, lower-case, drop empties; malformed ⇒ empty (ACS off), logged once. The org allowlist
is the tenant guard (CWP is multi-tenant; a customer typing `hello@news.cherryworkspro.com` routes to
its own connected mailbox, which fails exactly as today). Exact-sender match, not domain.

Effective sender per item:
- campaign: `campaign.fromEmail || brand.fromEmail` (as today, `scheduled-send.ts:494-496`);
- sequence: `seq.fromEmail || brand.fromEmail` — **computed only to decide the route**. If the route is
  `connected`, the sequence send is called with **exactly today's input** (`replyTo: seq.replyTo` only;
  SMTP puts caller `fromEmail` in the real From header, `smtp-transport.ts:23,152`, so changing it would
  alter existing SMTP tenants). If the route is `acs`, it sends with `fromEmail: effectiveFrom`,
  `replyTo: seq.replyTo || brand.replyTo`.

## 2. Send path (both loops)

```
route = resolveMarketingRoute(org, effectiveFrom)
connected → sendViaConnectedMailbox(input)            // unchanged, incl. attempt bookkeeping
acs       → if acsCooldownActive(): defer (no row, no tracking rows, no ACS call) and move on
            suppression check (existing)              // suppressed ⇒ permanent (see §8)
            build tracked html/text + unsubscribe headers (existing)
            in ONE transaction: SELECT parent (campaign / enrollment, and the sequence) FOR SHARE,
                                re-check it still exists and is sendable; for a sequence send, re-read
                                the step at stepIndex under that lock and compare its id + content hash
                                with the step the body was built from — mismatch ⇒ abort: no row, drop
                                the tracking links, enrollment stays due and is rebuilt next tick;
                                INSERT attempt row: status 'accepted', id = new uuid,
                                errorCode 'ACS_SUBMITTING', transport 'acs', providerMessageId = id,
                                nextRetryAt = now + 60 s (non-null)   ← intent written BEFORE POST
            POST /emails:send  with Operation-Id = row id
            → apply §3 outcome to that row
```

Writing the row before the POST closes the crash window for ACS: a crash at any point (after insert,
after the provider accepted but before the outcome update) leaves a row with a non-null `nextRetryAt`
that the reconciler (§4) selects within 60 s, and the message is never POSTed again. The `FOR SHARE`
lock serializes the insert against parent deletion (§4a).

## 3. AcsTransport (`server/email/acs-transport.ts`)

- Raw `fetch`, `api-version=2025-09-01`, no new dependency. Auth: `@azure/identity`
  `DefaultAzureCredential` (already a dependency), scope `https://communication.azure.com/.default`,
  token cached until 5 min before expiry. **Token acquisition never runs inside a tick.** The SDK does
  not forward an abort signal into managed-identity acquisition (`@azure/identity`
  `managedIdentityCredential/index.js:189`), so a caller-side timeout can't bound it. Instead a
  module-level refresher, on its own timer **outside the advisory lock**, keeps the cache warm
  (refresh when < 10 min to expiry; single-flight, so at most one outstanding acquisition; a stalled
  one is abandoned to the event loop and only ever writes the cache when it settles). The send and poll
  paths only **read** the cache: no valid token ⇒ `deferred` `ACS_AUTH` (nothing sent) / stays
  `accepted` (poll), with no wait. A late acquisition can therefore never continue into a POST.
  Credential injectable for tests (`setAcsCredentialForTests`);
  `ACS_EMAIL_TEST_URL_OVERRIDE` replaces the **endpoint only**, so the token path is still exercised.
- Body: `senderAddress`, one `to`, `replyTo` if set, `content.subject/html/plainText`, `headers`
  (incl. `List-Unsubscribe` + `List-Unsubscribe-Post`, after `assertSafeHeaders`),
  `userEngagementTrackingDisabled: true`.
- **Deadlines** (`AbortSignal.timeout`, covering body reads): POST 15 s, each GET 5 s. The token has no
  in-tick deadline because it is never awaited in a tick (above); the refresher logs and alerts (§9) if
  an acquisition is outstanding > 30 s.
- Typed results (`server/email/types.ts`): `SendResult.transport`/`EmailTransport.kind` gain `"acs"`;
  `EmailTransportError` gains optional `providerCode`; `redactErrorCode` reads `providerCode` first and
  falls back to today's message parsing, so Graph/SMTP classification is unchanged.

POST outcomes → the pre-written row:

| POST result | Row becomes | Recipient effect |
|---|---|---|
| 202 | `accepted`, errorCode null, nextRetryAt = now + retry-after | poll (§4) |
| no valid cached token (refresher failing or stalled; nothing sent) | `deferred` `ACS_AUTH` | non-consuming, cooldown, alert |
| 401/403 after one token refresh | `deferred` `ACS_AUTH` | non-consuming, cooldown, alert |
| 429 | `deferred` `ACS_THROTTLED`, nextRetryAt = response time + retry-after | non-consuming, cooldown |
| 400/404 (bad sender/recipient) | `permanent_failure` `ACS_REJECTED` | done |
| 5xx response, timeout, connection lost | stays `accepted` with errorCode `ACS_POST_AMBIGUOUS` | poll; **never re-POST** |

Only 202, 400/404 validation rejections, 401/403 and 429 are treated as knowing whether the message was
taken. A 5xx is ambiguous (a gateway error can follow a successful submission; ACS documents no
non-submission guarantee for it), so it follows the ambiguous path. If it was never taken, the 24 h guard
ends it as `ACS_OPERATION_UNRESOLVED` + alert. A lost mail is visible and alerting; a duplicate is not.

Inline after a 202: **at most one** GET, and only if the 202's `Retry-After` (default 5 s if absent)
plus the GET still fits a 10 s inline window and the poll gates of §6 (poll cooldown, GET pacing,
hourly GET budget) allow it; applying §4's rules. Otherwise, and for anything still unresolved, the row
keeps `nextRetryAt = now + max(Retry-After, 60 s)` and is left to the reconciler. ACS caps GET-status
calls separately from sends (60/min, 200/h per subscription), so polling is budgeted, not free.

## 4. Reconciler — accepted operations are resolved independently of sending

`reconcileAcsOperations(deadline)` runs **first in every tick, whenever `ACS_EMAIL_ENDPOINT` is set**
(independent of the org allowlist, sender routing, the send cooldown, audience membership, enrollment
status). It selects directly:
`status = 'accepted' AND next_retry_at <= now ORDER BY next_retry_at LIMIT 100` (uses the existing
`(status, next_retry_at)` index), and GETs each operation:

| GET result | Row becomes |
|---|---|
| `Succeeded` | `success` |
| `Failed`, recipient-level error code (invalid/blocked/suppressed recipient) | `permanent_failure` with the code |
| `Failed`, quota/throttle code | `deferred` `ACS_THROTTLED` + cooldown (non-consuming: the message was **not** sent, so a new operation after cooldown is safe) |
| `Failed`, unknown code; `Canceled` | `failed`, ordinary transient (consumes an attempt, bounded by `maxAttempts`) |
| `NotStarted` / `Running` | stays `accepted`, nextRetryAt = max(GET `Retry-After`, poll backoff) |
| 404 on an `ACS_POST_AMBIGUOUS` / `ACS_SUBMITTING` row | stays `accepted`, nextRetryAt = poll backoff — 404 does not prove the original POST can't still land |
| GET 429 | stays `accepted`, nextRetryAt = its `Retry-After`; **sets the shared poll cooldown** (§6), so no further GET for any row this tick or until it expires |
| GET 401 / 403 / 5xx / timeout / token failure | stays `accepted`, nextRetryAt = poll backoff |
| row `accepted` for > 24 h | `permanent_failure` `ACS_OPERATION_UNRESOLVED` + degraded alert; never re-sent (a missed mail beats a duplicate) |

The code→class table is one function with tests, built from the documented ACS error codes.
**Poll backoff** is by the row's poll count (`attemptCount` is untouched; new integer column
`poll_count NOT NULL DEFAULT 0` on the attempt row, see §5): 1 m, 5 m, 15 m, then hourly until the 24 h
guard.
With ≤100 sends/h this keeps steady-state polling well under 200 GETs/h; the hourly GET budget (§6)
is the hard backstop.

Bookkeeping that follows resolution, without reviving anything:
- campaign: finalization (`:633`) is deferred while any of its attempts is `accepted`; the reconciler
  re-checks finalization for campaigns it touched.
- sequence: terminal resolution and advancement are **one transaction**: it locks the sequence row
  `FOR UPDATE`, the enrollment row `FOR UPDATE` and the prospect row `FOR SHARE`, writes the attempt's
  terminal status, and in the same commit, if the enrollment is still on that step (any status):
  - always moves `currentStepIndex` past it **and** sets `nextSendAt` exactly as today's advance does
    (`computeNextSendAt(steps, i, resolvedAt)`, `scheduled-send.ts:195`, so step i+1's delay runs from
    the resolution, as it runs from dispatch today). Step i is done whatever the lifecycle (§4b), and a
    later resume keeps the cadence: resume only flips status (`server/storage.ts:7083`) and the worker
    sends when `nextSendAt` is due, the same pause/resume semantics as today. If i was the last step,
    the index moves past the end with `nextSendAt = null`;
  - additionally does the status side of today's advance (`completed` after the last step) **only
    if** the enrollment is `active` and the prospect is still mailable by the `isStillMailable`
    predicate (`unsubscribedAt`, `bouncedAt`, deleted — checked on the locked prospect row, not on
    enrollment status, since unsubscribe only sets `marketingProspects.unsubscribedAt`,
    `server/marketing/unsubscribe.ts:160`). A non-mailable **active** enrollment is set to `removed`
    with `nextSendAt = null` in the same transaction (the same write the worker's removal at
    `server/marketing/scheduled-send.ts:734` makes). It is not left for the worker, which only selects
    rows with a due `nextSendAt` (`:683`) and would never see a last-step one again. Already-inactive
    statuses are preserved.
  Status is never changed here except active → completed / removed, so nothing is reactivated. There is no crash
  window between "terminal" and "index moved".
- **Reactivation schedules.** The status PATCH to `active`, in one transaction holding the sequence
  `FOR SHARE` and the enrollment `FOR UPDATE`, reads the current steps and:
  - index past the last step ⇒ sets `completed` instead;
  - index on an existing step and `nextSendAt` **null** (e.g. resolved on the then-last step while
    paused, after which a step was appended) ⇒ sets `nextSendAt = now + that step's delayDays`;
  - `nextSendAt` already set ⇒ left untouched (a future deadline is preserved; a past one is due now,
    the same as today's resume).
  So no active enrollment is ever left with `nextSendAt = null` and a step still to send.
- **One finalizer for every terminal sequence write.** `finalizeSequenceAttempt(tx, attempt)` is the
  only code that writes a sequence attempt as `success`/`permanent_failure`, and it does the locked
  write + index/`nextSendAt` move above in one transaction. Every path uses it, for **both** transports:
  ACS POST 400/404 and other direct permanent rejections, inline GET resolution, the reconciler, the
  24 h `ACS_OPERATION_UNRESOLVED` guard, connected-transport success/permanent failure (today's separate
  insert at `scheduled-send.ts:852` and advance at `:906` become this one call), and pre-submit
  suppression. The skip-done branch (`:890`) is then only a repair path for rows written before this
  PR; it uses the same finalizer.
- the send loops treat `accepted` as `skip-pending` (they never poll or send for it). The sequence
  intent transaction also parks the enrollment (`nextSendAt = intent.createdAt + 24 h`, the stale-guard
  horizon) so a pending enrollment drops out of the due set instead of occupying the 200-row window;
  the finalizer always overwrites it, and a `deferred` outcome sets it to the deferral's `nextRetryAt`.
- **Delivery side effects move with resolution.** Today a send's success writes the `email_sent`
  activity (`scheduled-send.ts:549` campaign, `:802` sequence; it also drives prospect activity
  timestamps and brand `lastSentAt`, `server/storage.ts:8131`, `:6275`), and a sequence permanent
  failure enqueues the admin digest (`:876`). For ACS these fire **on resolution, never on
  acceptance**: the finalizers (`finalizeSequenceAttempt`, and `finalizeCampaignAttempt` for campaigns)
  move the row with a conditional `UPDATE … WHERE status = 'accepted' RETURNING`. Only the caller whose
  update returned the row (inline GET, reconciler, or direct POST rejection) runs the effects after
  commit: one `email_sent` activity on `success` (`transport: "acs"`, `provider_message_id` = operation
  id), and the existing failure notification on a sequence `permanent_failure`. A repeated reconcile
  of an already-resolved row returns nothing and does nothing. As today, an activity/notification error
  is logged and swallowed; it never changes the attempt or causes a re-send. Connected transports keep
  writing the activity inline exactly as today.

### 4a. Parent deletion while an operation is unresolved

Campaign, sequence and enrollment deletes cascade into attempts (`shared/schema.ts:4140-4146`,
`:4170-4174`; hard-delete paths `server/storage.ts:6860`, `:6903`, `:7093`; enrollment removal
`server/routes/marketing/campaigns.ts:706`). Each of those storage functions, in its transaction:
`SELECT` the parent `FOR UPDATE`, then counts `accepted` attempts under it (via the enrollment for a
sequence). If the count is > 0, it refuses with a typed `PendingDeliveryError` and the route returns
409 "This item has emails still being confirmed by the provider; try again in a few minutes". The
worker's intent insert holds the parent `FOR SHARE` (§2), so a delete either sees the new row or runs
first and the insert's re-check finds no parent. No FK change, and no unresolved operation is ever
erased by deletion.

### 4b. Sequence step edits while an operation is unresolved

Saving a sequence deletes and recreates all its steps (`server/storage.ts:6922`, via
`server/routes/marketing/campaigns.ts:505`), and attempts carry only `stepIndex`
(`shared/schema.ts:4150`). If steps were replaced while an attempt is `accepted`, its later `success`
would advance the enrollment past a different, unsent message. Two rules close this:
- **No resolved-but-unadvanced state exists.** §4's resolution transaction advances
  `currentStepIndex` past the attempt's `stepIndex` (if the enrollment is still on it) for an enrollment
  in **any** status, not only `active`, together with `nextSendAt` (§4). Statuses: a paused/completed/
  removed enrollment keeps its status (nothing is reactivated or sent); an active enrollment whose
  prospect is no longer mailable becomes `removed`; an active mailable one at the end becomes
  `completed`. "Step i is done" is a fact about the
  attempt, independent of the enrollment's lifecycle. A later reactivation through the status PATCH
  (`server/routes/marketing/campaigns.ts:106`, `server/storage.ts:7075`, which allows any of
  active/paused/completed/removed) therefore resumes at i+1, and the skip-done path
  (`scheduled-send.ts:890`) never meets a resolved attempt at the current index of a replaced step.
- **Unresolved attempts block edits regardless of enrollment status.** The step-replacement storage
  function, in its transaction, locks the sequence row `FOR UPDATE` and refuses with
  `PendingDeliveryError` (409, same message as §4a) when **any** enrollment of that sequence, in any
  status, has an `accepted` attempt. This lasts at most until resolution (≤ 24 h guard); the 409 says so. The worker's intent
transaction (§2) also takes the **sequence** row `FOR SHARE` for sequence sends, so an edit and an intent
insert are serialized, and the step-identity check inside the intent transaction (§2) guarantees the
submitted body is the step the attempt's `stepIndex` refers to at insert time. An edit committed after
the body was built but before the insert is caught by the mismatch check and rebuilt.

**Editor save path.** Today every existing-sequence save PATCHes metadata, then PUTs all steps
(`client/src/pages/marketing-os/sequences.tsx:529,532`; separate transactions,
`server/routes/marketing/campaigns.ts:485,512`). Changes:
- The client PUTs steps **only when they differ** from the loaded steps (deep compare of the normalized
  step list), so a name/sender/reply-to change never touches the step guard.
- When both changed and the step PUT returns 409 `PENDING_DELIVERY`, the editor shows "Details saved.
  Step changes can't be saved while N emails from this sequence are being confirmed — try again in a few
  minutes." It keeps the unsaved step edits in the form (not a generic failure toast), and the metadata
  save stands. This is an explicitly communicated partial save; atomic combined save is out of scope.

## 5. Statuses (schema)

Two additive enum values on `email_send_attempt_status` in `shared/schema.ts` (Azure runs only
`drizzle-kit push`, which emits `ALTER TYPE … ADD VALUE`), plus a matching `migrations/00xx-*.sql`
(`ADD VALUE IF NOT EXISTS`) for CI replay. One additive column, `poll_count integer NOT NULL DEFAULT 0`
on the attempts table (§4 poll backoff), declared in `shared/schema.ts` with the same migration file;
the default fills existing rows, so no backfill. No index, no constraint.

- `accepted` — submitted (or possibly submitted); fate unknown; only the reconciler touches it.
- `deferred` — the provider refused to take it for provider reasons (throttle/auth); definitively not
  sent; **does not count toward `maxAttempts`**.

`decideRecipientAction`:
- `accepted` ⇒ `skip-pending`.
- `deferred` ⇒ `skip-pending` until nextRetryAt, then `send` with the **same** attemptNumber
  (new row, new Operation-Id = new row id).
- `success`/`permanent_failure`/`failed` exactly as today.
Deferral rows are bounded: during a known cooldown nothing is written (§2), so there is one deferral row
per cooldown discovery, not per tick.

**This PR's image is an unconditional rollback floor** (same pattern as the #92 tracking floor,
docs/DEPLOY.md "Never roll back past the step-1 image"). Images older than this PR would (a) treat
`accepted` as an unknown status and could re-send it, and (b) run `drizzle-kit push`, which drops the new
enum values by recreating the type and casting stored rows (`drizzle-kit/bin.cjs:25487-25521`), so the
boot fails on any `accepted`/`deferred` row. Any runtime "has ACS been used?" signal would race new
inserts and be erased by cascades, so the floor does not depend on one:
- `deploy_gate.sh`'s explicit-image path **always** refuses a target image that lacks the label
  `cwp.acs-enum=1` (added by this PR's Dockerfile). No data check, no override flag.
- The automatic restore after a failed deploy is the one exception, and only for the deploy of this PR
  itself: ACS ships dark (endpoint unset ⇒ no code path writes the new values), and the restore already
  runs with `SKIP_DB_PUSH=1` (`:118-120`). After this PR is live, `last-known-good` is a labeled image,
  so later automatic restores never go below the floor. The gate asserts this: the automatic restore
  refuses an unlabeled target unless the failing image is the first labeled one.
- docs/DEPLOY.md records the floor next to the #92 one; a manual `az containerapp update --image <older>`
  bypasses the gate and is listed as forbidden.

## 6. Cooldown, pacing, fairness, budgets

- **Shared cooldown:** module-level `acsCooldownUntil` (max of current and `responseTime + retryAfter`),
  set by any ACS deferral (POST or operation-level). Per process. Ticks are serialized by the advisory
  lock; a process that hasn't seen the 429 spends at most one non-consuming call to learn it.
  Correctness doesn't depend on sharing. cwp-app runs one replica.
- **Pacing:** `ACS_SEND_INTERVAL_MS = 2_100` (≈28/min) after an ACS send, in both loops.
- **Poll gates (separate from sends, every GET in the inline poll and the reconciler goes through one
  `acsPollGate`):** a shared module-level `acsPollCooldownUntil`, set by any GET 429 from its
  `Retry-After` (default 60 s) — while active, **no** GET is issued for any row; GET pacing
  `ACS_POLL_INTERVAL_MS = 1_100` (≈55/min); and an in-process sliding-window hourly budget of 180 GETs
  (under the 200/h cap). When the budget or cooldown blocks a GET, the reconciler stops for this tick
  and the rows stay due; inline polling is simply skipped. Per process, like the send cooldown; one
  replica.
- **Fairness:** while the cooldown is active, the campaign query (`:452-458`) and enrollment query
  (`:663-687`) exclude **only items whose effective sender routes to ACS**. One normalization defines the
  effective sender for routing, in TS and in SQL alike:
  `effectiveSender = lower(strip(item.from)) if non-empty, else lower(strip(brand.from))`, where `strip`
  removes leading/trailing characters from **one explicit set `WS`**: exactly the code points of JS `\s`
  (space, `\t \n \v \f \r`, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000,
  U+FEFF; U+0085 is not in it). `server/email/marketing-route.ts` exports `WS` once. The TS `strip` and
  the SQL fragment are both **generated from it**: TS uses a regex char class, and SQL uses
  `regexp_replace(x, $pattern, '', 'g')`, where `$pattern` = `^[WS]+|[WS]+$` is built from the same
  characters and passed as a bound parameter. Neither side uses `trim()`/`btrim()`.
  In SQL: `lower(coalesce(nullif(strip(item.from_email), ''), strip(brand.from_email)))`.
  Sender columns default to `''` (`shared/schema.ts:3434`, `:3531`), so the empty-string fallback is the
  common case. The TS helper `effectiveMarketingSender(item, brand)` feeds `resolveMarketingRoute`. A
  parity test runs the SQL expression (real Postgres) and the helper over the same fixtures (null, `''`,
  spaces, tab-only, newline, NBSP-only, U+3000, padded, mixed case), plus a property test over random
  strings drawn from `WS` ∪ ASCII. The connected path's input stays today's (`||`) as in §1.
  Exclusion is NULL-safe: rows are kept where `(org_id IN (acsOrgIds) AND <expr> IN (acsSenders)) IS
  NOT TRUE`. `brands.from_email` is nullable (`shared/schema.ts:2802`), so `<expr>` can be NULL (empty
  item sender, NULL brand sender). Such a row routes to the connected mailbox and must stay selected; a
  plain `NOT (…)` would drop it.
  Connected-mailbox work in the same org keeps flowing, and reconciliation is unaffected (§4). Both
  queries gain a stable `orderBy` (`sendAt, id` / `nextSendAt, id` asc).
- **Campaign selection progresses past campaigns with nothing to dispatch.** The campaign query takes
  50 rows (`:450`), and a campaign with only `accepted` recipients stays unfinished (`:624`) whether or
  not any cooldown is active (e.g. only the poll gate is blocking). So the query pages with a
  module-level keyset cursor: `WHERE (send_at, id) > cursor ORDER BY send_at, id LIMIT 50`; the cursor
  advances to the last row processed; when a page returns < 50 rows the cursor wraps to the start for
  the next tick. Every due campaign is visited within ⌈due/50⌉ ticks, whatever the oldest ones are
  waiting on. Per process; a restart starts from the beginning, which is only a fairness delay. (Sequence
  enrollments don't need this: a pending enrollment is parked out of the due set, §4.)
- **Budgets:** reconciler 10 s, campaigns 30 s, sequences 15 s. Each phase checks its own deadline
  before every send/poll and stops starting new work when it has passed. **Scope of the guarantee:** ACS
  calls are bounded (§3 deadlines), so a tick with only ACS work ends within ~55 s + one bounded call.
  Graph/SMTP sends are **not** made cancellable by this plan (pre-existing: `graph-transport.ts:268-308`
  has no abort signal and retries internally). A stalled connected send can still hold the tick, as it
  can today. A deadline never abandons an in-flight promise; the lock is released only after it
  settles. Bounding the connected transports is a separate follow-up.
- **Sequence loop parity:** a fresh `isStillMailable` check immediately before each sequence send
  (mirrors `:519`; the 200-row snapshot can be minutes old), and unreached enrollments stay due.

## 7. Tracking rows

Tracking links are saved before the send (`:526`, `:783`). On the ACS route: the cooldown check runs
before tracking rows are created; a `deferred` outcome calls `dropTrackingLinks` (as `MissingMailboxError`
does at `:575`, `:834`); `accepted`/`success` keep them. `failed`/`permanent_failure` behave as today.

Engagement while `accepted`: `server/marketing/tracking-record.ts:164` rejects events whose attempt
exists with status ≠ `success` (a missing attempt is allowed, `:135-141`). The pre-written ACS row would
discard real early opens/clicks. Change: also accept `accepted` (only that addition). Events are stored
as today. Reported metrics stay gated on a `success` attempt (`server/storage.ts:7234`), so events of a
row that later ends `failed`/`permanent_failure` stay stored but never counted.

## 8. Other in-scope fixes

- `RecipientSuppressedError` ⇒ permanent `SUPPRESSED` in `classifyFailure` (today UNKNOWN ⇒ retried).
  All transports.
- **Send Now** (`server/routes/marketing/campaigns.ts`): when the campaign's effective sender routes to
  ACS, the brand-domain equality check (`:350-361`, which rejects `news.` against the root/brand domain)
  and the `selectTransport` mailbox preflight (`:411`) are replaced by the ACS authorization (org +
  exact sender), which is strictly narrower. Every other route runs both checks unchanged.

## 9. Degraded-transport alert

`notifyMarketingTransportDegraded(orgId, code)` in `server/notifications/marketing-failures.ts`, sent via
`sendPlatformNotice` (`server/email.ts:1342`, operator's Graph mailbox) to the org's admins +
`support@cherrystconsulting.com`. **A rejected promise or a resolved `ok:false` (e.g. SMTP fallback
`noop`, `smtp-transport.ts:145-149`) both count as undeliverable** ⇒ `console.error("[acs] degraded alert
undeliverable", code)`. Triggers: `ACS_AUTH` on first occurrence; cooldown continuously active > 60 min;
`ACS_OPERATION_UNRESOLVED`. Rate limit 1 per org per code per 6 h (in-process).

## 10. Data (prod, by hand, Dean's go)

Brand `CherryWorks Pro` (org `cherry-street-consulting`): `from_email hello@mail.cherryworkspro.com`
(dead Resend domain) and `reply_to support@cherryworkspro.com` (no MX → bounces) ⇒ set
`from_email = hello@news.cherryworkspro.com`, `domain = news.cherryworkspro.com`,
`reply_to = support@cherrystconsulting.com`.

Editors copy brand sender/reply-to into each campaign/sequence (`campaigns.tsx:164,242`,
`sequences.tsx:446,520`), which then override the brand. So first a read-only inventory: unsent campaigns
and sequences with active enrollments whose from is on `mail.cherryworkspro.com` or reply-to is
`support@cherryworkspro.com`. Each is listed for Dean with a proposed action (re-point, or delete known
test leftovers such as campaign `121d9854…` / sequence `65c4c750…`). Values that differ from the old
brand defaults are intentional overrides and left alone. Nothing changes without his per-item go.

## 11. Tests (local: `cwp vitest`, affected `cwp e2e`, `cwp validate`)

- **Routing:** every branch of the routing rule; a customer org using an operator address ⇒ connected.
- **AcsTransport** (stub + injected credential): payload shape (text part, List-Unsubscribe + -Post,
  tracking disabled, one recipient, replyTo); every row of the §3 table; token throw and token hang;
  POST stall ⇒ ambiguous; CR/LF header rejected; no address or token in logs.
- **Reconciler:** every row of the §4 table; `Running` past the inline cap ⇒ stays `accepted`, resolved
  next tick; fresh module state (simulated restart) resumes; 202 then GET 429/401/500/token-failure/
  connection-loss ⇒ **exactly one POST** across ticks; ambiguous POST then 404 then a delayed `Succeeded`
  ⇒ one POST, row `success`; 24 h stale ⇒ unresolved + alert, no POST; accepted row reconciled after the
  enrollment is paused ⇒ row resolved, index and `nextSendAt` moved, still paused, nothing sent; after
  the prospect is removed from the segment (enrollment status set by that path) ⇒ status preserved,
  never reactivated. Unsubscribe is driven through `unsubscribeByToken` (not by editing enrollment
  status): **active** enrollment, accepted attempt, unsubscribe, then `Succeeded` ⇒ attempt `success`
  and, in the same finalizer transaction, enrollment `removed` with `nextSendAt` null (not left for the
  worker). **Paused** enrollment + unsubscribe + `Succeeded` ⇒ stays paused (index moved); on resume
  the worker's mailability check removes it before any send.
  Pause → resolve ⇒ index moved, still paused; step edit ⇒ 200; resume ⇒ next send is the new step
  i+1. Injected crash after the terminal write but before commit ⇒ neither persisted; rerun ⇒ resolved
  and index moved once. **Cadence, through the real status PATCH:** step 1 has `delayDays = 5`; pause →
  resolve step 0 ⇒ `nextSendAt` = resolution + 5 d; resume one hour later ⇒ nothing sent until then;
  pause on the last step → resolve → resume ⇒ `completed`; pause on the last step → resolve → append a
  step (`delayDays = 2`) → resume ⇒ `nextSendAt` = resume + 2 d and the appended step is delivered
  then; resume with a future `nextSendAt` ⇒ unchanged. **Crash + edit per terminal path:** for each
  of ACS POST 400, POST 404, pre-submit suppression, inline GET `Failed`, reconciler `Succeeded` and 24 h
  guard, inject a crash inside the finalizer ⇒ nothing persisted, and a step edit then a restart neither
  skips the replacement step nor sends twice (ACS paths are safe because the intent row precedes the
  POST, §2). For connected-transport success the test asserts **database atomicity only** (attempt and
  index move commit together or not at all). A crash after a connected send but before the finalizer
  commits can still re-send next tick: that is today's behavior (send at `:790`, persist at `:852`),
  unchanged by this plan; durable pre-send intent for Graph/SMTP is a separate follow-up (§13).
  **Unsubscribe on the last step:** active enrollment, accepted final-step attempt, `unsubscribeByToken`,
  then `Succeeded` ⇒ attempt `success`, enrollment `removed`, `nextSendAt` null, nothing scheduled.
  **NULL sender during cooldown:** ACS org in cooldown, sequence with `from_email = ''` and its brand
  `from_email` NULL ⇒ the real enrollment query selects it and it dispatches through the connected
  mailbox; same for a campaign. **Poll quota:** 5 accepted rows, the
  first GET returns 429 ⇒ zero further GETs until `Retry-After` elapses (asserted across ticks and the
  inline path); 202 with `Retry-After` > the inline window ⇒ no inline GET; 181st GET in an hour is not
  issued; backoff sequence 1 m/5 m/15 m/1 h by `poll_count`. **Lifecycle, through the real status
  PATCH endpoint:** accepted attempt → PATCH `completed` → step PUT ⇒ 409 → resolve `success` ⇒ index
  advanced, status still `completed` → step PUT ⇒ 200 → PATCH `active` ⇒ the next send is step i+1 of
  the new steps, and nothing is skipped or re-sent; same for `paused` and `removed`.
  **Token:** the real `ManagedIdentityCredential` against a stub identity endpoint
  (`IDENTITY_ENDPOINT`/`IDENTITY_HEADER`) that never answers ⇒ ticks finish within budget, rows
  `deferred ACS_AUTH`, zero POSTs, advisory lock released; the stub then answers ⇒ cache fills and sends
  proceed; a token arriving after a tick ended triggers no POST by itself.
- **Selection fairness:** 50 ACS campaigns whose recipients are all `accepted` (send cooldown
  inactive, poll gate blocked) + 1 connected campaign due later ⇒ the connected one is sent within 2
  ticks; 200 enrollments with `accepted` attempts + 1 due enrollment ⇒ the due one sends the first tick
  (parked rows not selected); cursor wraps.
- **Side effects:** ACS `accepted` ⇒ no `email_sent` activity, brand `lastSentAt` unchanged; resolution
  to `success` next tick ⇒ exactly one activity; reconciling it again (and two concurrent reconcilers)
  ⇒ still one; sequence `permanent_failure` via the reconciler and via POST 400 ⇒ one digest enqueue;
  activity write throws ⇒ attempt stays `success`, no re-send.
- **Statuses:** `deferred` non-consuming with `maxAttempts = 1`: repeated POST-level and operation-level
  quota failures, then recovery ⇒ every recipient sent exactly once; `accepted` blocks campaign
  finalization and sequence advance until resolved.
- **Worker:** ACS-routed campaign in an org with **no** mailbox sends; mixed ACS + connected-mailbox
  campaigns and sequences in one org during cooldown ⇒ the connected ones still send; 250 deferred ACS
  enrollments + 1 non-ACS ⇒ non-ACS sends first cooled-down tick; campaign backlog doesn't starve
  sequences; stalled stubs ⇒ tick ends within budget + one bounded call, lock released, next tick
  progresses; sequence unsubscribed mid-batch ⇒ not sent; flag-off and non-allowlisted SMTP/Graph
  sequences ⇒ transport input byte-identical to today; suppressed ⇒ permanent; 5 consecutive deferrals ⇒
  0 leftover tracking rows; accepted send keeps its tracking rows.
- **Alert:** platform notice called; rejected promise **and** resolved `ok:false` ⇒ error log, no crash;
  rate limit holds.
- **Send Now:** ACS org without mailbox ⇒ 202; root brand domain + authorized `news.` sender ⇒ 202; same
  sender in another org ⇒ 400 as today.
- **Crash recovery:** crash after the intent insert but **before** the POST ⇒ **zero** POSTs ever, row
  becomes eligible for reconciliation at `nextRetryAt` (≥ 60 s) and ends `ACS_OPERATION_UNRESOLVED` at
  24 h; crash after a stubbed 202 but before the outcome update ⇒ **exactly one** POST, row resolved by
  the reconciler. (Eligibility after 60 s is guaranteed; resolution time under backlog is bounded only by
  the reconciler's LIMIT/budget, which is not asserted.)
- POST 500 then operation `Succeeded` ⇒ one POST, `success`.
- open/click during `accepted` ⇒ stored, then counted after `success` and not counted after
  `permanent_failure`.
- delete campaign / sequence / enrollment (incl. the `:706` removal route) while a row is `accepted` ⇒
  409 and the row survives; delete racing an intent insert ⇒ either 409, or no row and no POST.
- **Step edit vs pending (integration):** save steps while an enrollment's step-2 attempt is `accepted` ⇒
  409, steps unchanged; edit racing an intent insert ⇒ serialized (either 409, or the insert sees the
  new steps). **Deterministic stale-body test:** the worker pauses (test hook) after building the old
  step-2 body; steps are replaced and committed; the worker resumes ⇒ mismatch abort, no row, no POST,
  tracking links dropped; next tick submits the **new** body (asserted on the stub's received payload).
- **Editor (e2e, `cwp e2e`):** rename only, while an attempt is `accepted` ⇒ save succeeds, no step PUT
  issued; rename + step change ⇒ name saved, the specific pending message is shown, and the step edits
  stay in the form; after the row resolves, saving again succeeds.
- Fairness parity fixtures (above) inside the 250+1 test.
- `deploy_gate.sh` (shell test, stubbed az): unlabeled explicit target ⇒ always refused; labeled ⇒
  allowed; automatic restore to unlabeled ⇒ allowed only when the failing image is the first labeled one,
  refused otherwise.
- Existing transport/worker/tracking/unsubscribe suites unchanged and green.

## 12. Rollout (each prod step needs Dean's explicit yes)

1. PR → local gates → triple red-team → CI → merge → deploy. Ships **dark** (`ACS_EMAIL_ENDPOINT` unset):
   the enum values exist, no behaviour changes.
2. Inventory (§10) → Dean rules → brand UPDATE + approved item changes. Set env:
   `ACS_EMAIL_ENDPOINT`, `ACS_EMAIL_ORG_SLUGS=cherry-street-consulting`, `ACS_EMAIL_SENDERS=<5>`.
3. Live verify: one campaign to a 2-contact segment (Dean's Gmail + Outlook). Check arrival, SPF/DKIM/
   DMARC pass + aligned on `news.cherryworkspro.com`, Gmail one-click unsubscribe, text part, open/click
   rows, unsubscribe works, attempt rows `accepted → success`, zero `undeliverable` log lines. Then learn
   Operation-Id dedupe behaviour by hand (record in docs/DEPLOY.md; design unaffected).
   Alert proof beforehand, locally: failing injected credential + platform-mailbox capture ⇒ alert
   produced and addressed correctly.
4. Dean files the quota-increase request once real sends show a clean failure rate.

**Turning ACS off (no image rollback; the floor in §5 forbids going below this PR):**
1. Empty `ACS_EMAIL_ORG_SLUGS` ⇒ new revision, same image: no new ACS sends; the reconciler keeps
   resolving `accepted` rows because the endpoint is still set. Marketing for the org falls back to
   the connected mailbox on the next tick.
2. Leave `ACS_EMAIL_ENDPOINT` set. Its only remaining effect is the reconciler. Unsetting it is never
   required; if someone does, `accepted` rows just stay `accepted` (never re-sent), and a warning is
   logged each tick.
3. A bug in this PR's code is fixed **forward** (a new image on top of it), not by rolling back below
   it. A manual `az containerapp update --image <older>` bypasses the gate; docs/DEPLOY.md says so
   next to the #92 floor.

## 13. Out of scope

- **Phase 2:** Event Grid `EmailDeliveryReportReceived` → authenticated webhook → `bounced_at` (no writer
  today) + suppression, correlated by operation id. Own plan (public webhook).
- Marketing failures bypassing `failure-tracker` (pre-existing).
- Graph/SMTP send-then-persist re-send window after a crash (pre-existing; needs durable pre-send intent
  for connected transports) and making Graph/SMTP sends cancellable (§6).
- Customer orgs on ACS; moving transactional mail off M365.

## Revision log

- r1 → REVISE (`36a10baad7fa`, 8 findings).
  - Addressed in r2: typed deferrals, shared cooldown, sequence deadline + fresh mailable check,
    operation polling, Send Now domain check, ACS-only sequence sender changes, persisted-sender
    inventory, outage alert.
- r2 → REVISE (`354b346af0e3`, 7×P2 + 1×P3).
  - Addressed in r3: persisted `accepted`, poll-only after 202, error-code classification, token failures
    as deferrals, fairness + budgets, request deadlines, tracking cleanup, alert via platform notice.
- r3 → REVISE (`78549a5620f4`, 6×P2 + 1×P3, no tenant/CSRF bypass). Addressed in r4:
  1. Independent reconciler that doesn't depend on audience or enrollment state and never reactivates
     anything.
  2. Fairness exclusion by effective ACS sender, not whole org.
  3. Intent row written before the POST, with ambiguous outcomes never re-POSTed (404 is not proof).
  4. `deferred` status, non-consuming for both POST-level and operation-level throttles.
  5. `ok:false` counts as an undeliverable alert.
  6. Rollback requires revision quiescence plus a drain check under the worker lock, and the rollback
     script refuses while rows are `accepted`.
  7. Contradictions removed by this full rewrite.

- r4 → REVISE (`f9cd6f3f99f4`, 8×P2). Addressed in r5:
  1. Intent row inserted with a non-null `nextRetryAt`.
  2. POST 5xx treated as ambiguous and never re-POSTed.
  3. Tracking accepts events during `accepted`, with metrics still gated on success.
  4. Parent deletes refused (409) while `accepted` rows exist, serialized with the intent insert by
     row locks.
  5. A single effective-sender normalization shared by TS and SQL, with a parity test.
  6. `deploy_gate.sh` enforces quiescence and drain on both rollback paths and fails closed.
  7. `SKIP_DB_PUSH=1` on every rollback to a pre-PR image.
  8. Tick-deadline guarantee narrowed to ACS calls; Graph/SMTP cancellation is an explicit follow-up.

- r5 → REVISE (`ece2dddf23bb`, 4×P2 + 1×P3). Addressed in r6:
  1. The forward-after-rollback hazard and the drain-check execution path are both removed by
     **dropping the automated drain/rollback machinery**. This PR's image becomes a rollback floor (as
     #92 did). The gate refuses unlabeled targets using `acsUsed` from token-protected `/api/readyz`, failing closed.
  2. Step replacement is refused while operations are pending, serialized with the intent insert.
  3. One explicit whitespace set `WS` generates both the TS and SQL strip, with real-Postgres parity and
     property tests.
  4. Crash tests split into zero POSTs before submission and one POST after; "within 60 s" is now
     "eligible after 60 s".
- §2's intent transaction now also locks the sequence row (for §4b).

- r6 → REVISE (`eacf87dd5e96`, 3×P2). Addressed in r7:
  1. The floor is unconditional, label-based, with no runtime `acsUsed` signal and no override.
  2. The step's identity and content hash are re-checked under the sequence lock inside the intent
     transaction; on a mismatch it aborts and rebuilds, with a deterministic pause/resume test.
  3. The editor PUTs steps only when changed; a combined edit hitting 409 is a communicated partial save;
     tested in e2e.

- r7 → REVISE (`b650641e0f68`, 3×P2). Addressed in r8:
  1. Terminal resolution and enrollment advancement are one transaction under sequence/enrollment
     locks; the §4b guard also blocks on resolved-but-unadvanced attempts at the current index of any
     non-completed enrollment (incl. paused). Crash and pause→resolve→edit→resume tests.
  2. Advancement re-checks the locked prospect with the `isStillMailable` predicate; tested through
     `unsubscribeByToken`.
  3. GET quota (60/min, 200/h): at most one inline GET, gated by `Retry-After`; poll backoff 1 m/5 m/
     15 m/1 h via new nullable `poll_count`; shared poll cooldown on GET 429; GET pacing 1.1 s; 180/h
     sliding budget. Multi-row 429 test.

- r8 → REVISE (`45b7d82a3786`, 2×P2). Addressed in r9:
  1. Resolution advances the step index for an enrollment in any status (status untouched), so no
     resolved-but-unadvanced state exists; the edit guard blocks on `accepted` attempts of any-status
     enrollments. Lifecycle test through the status PATCH endpoint.
  2. Token acquisition moved out of the tick into a single-flight refresher outside the advisory lock;
     sends/polls only read the cache. Real-credential test with a stalled identity endpoint.
  (Also: r8 log said "nullable `poll_count`"; the operative §5 text is `NOT NULL DEFAULT 0`.)

- r9 → REVISE (`f7bb7218c143`, 2×P2). Addressed in r10:
  1. The index move also sets `nextSendAt` via `computeNextSendAt` from the resolution time, so resume
     keeps the cadence; resuming past the last step completes. Cadence test with a 5-day delay through
     the status PATCH.
  2. One atomic `finalizeSequenceAttempt` for every terminal sequence write on every path and both
     transports, including POST rejection and pre-submit suppression; crash + edit test per path.

- r10 → REVISE (`7444e8349c34`, 3×P2). Addressed in r11:
  1. The finalizer sets a non-mailable active enrollment to `removed` atomically (the worker can't
     reach a last-step row with `nextSendAt` null). Last-step unsubscribe test.
  2. Cooldown exclusion is `(…) IS NOT TRUE`, NULL-safe for a NULL brand sender; query + dispatch test.
  3. Connected-transport crash guarantee narrowed to DB atomicity; the pre-existing send-then-persist
     re-send window for Graph/SMTP is stated and left as a follow-up.

- r11 → REVISE (`174f3721e619`, 1×P2 + 1×P3). Addressed in r12:
  1. Reactivation through the status PATCH schedules `nextSendAt` from the current step when it is
     null (append-after-final-step case), preserves an existing deadline, and completes past the end;
     PATCH test for pause → resolve final → append → resume → delivery.
  2. §4b and §11 aligned with §4: active + unsubscribed ⇒ `removed` atomically; paused keeps status.

- r12 → REVISE (`0dd19a391d5f`, 2×P2). Addressed in r13:
  1. Campaign selection uses a wrapping keyset cursor so pending-only campaigns can't occupy all 50
     slots; pending enrollments are parked (`nextSendAt` = +24 h) until finalized. Fairness tests.
  2. `email_sent` activity and the permanent-failure digest fire once, on resolution, by whoever's
     conditional `UPDATE … WHERE status='accepted'` returned the row; never on acceptance. Tests.

## Questions for the reviewer
1. Is the `accepted`/`deferred` state machine complete, including the intent-row-before-POST path?
2. Is the unconditional image floor (§5) sufficient?
