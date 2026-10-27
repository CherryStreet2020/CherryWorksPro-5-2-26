/**
 * Task #207 — Scheduled-send worker for marketing campaigns + sequence
 * enrollments.
 *
 * Two periodic jobs:
 *
 *   1. processScheduledCampaigns()
 *      Reads `marketing_campaigns` rows whose `send_at` has elapsed and
 *      that have not yet been dispatched (`sent_at IS NULL`). For each
 *      campaign, broadcasts the message to every undeleted contact in
 *      the campaign's brand that has an email address, recording each
 *      successful send as an `email_sent` activity row so the firehose
 *      stays accurate. The campaign is then stamped with `sent_at = now()`
 *      so the next tick skips it.
 *
 *   2. processScheduledSequenceEnrollments()
 *      Reads active enrollments whose `next_send_at` has elapsed. For
 *      each, dispatches the step at `current_step_index`, records an
 *      `email_sent` activity, then advances to the next step (setting
 *      `next_send_at = now() + nextStep.delayDays days`) or marks the
 *      enrollment `completed` when no further steps remain.
 *
 * Both jobs are guarded by a process-wide pg advisory lock so a multi-
 * instance deployment never double-sends. If the org has no connected
 * mailbox (`MissingMailboxError`) the campaign / enrollment is left
 * untouched so dispatch resumes once the admin reconnects.
 *
 * Task #235 — Per-recipient send attempts are persisted in
 * `email_send_attempts` so transient transport errors can be retried
 * with exponential backoff (instead of silently giving up after one
 * try). A campaign is only stamped `sent_at` once every recipient has
 * either succeeded or been classified as a permanent failure (max
 * attempts hit, or a non-transient error code such as `VALIDATION_ERROR`).
 * Sequence enrollments only advance their step index after the same
 * terminal state — transient failures push `next_send_at` forward by the
 * computed backoff so the next tick retries.
 *
 * ACS marketing transport (PLAN r13) — items whose effective sender routes to
 * ACS (`server/email/marketing-route.ts`) are submitted through
 * `./acs-send.ts`: an `accepted` intent row is written before the POST and
 * resolved later by the reconciler, which runs first in every tick.
 */
import { randomUUID } from "crypto";
import { db, pool } from "../db";
import {
  brands,
  orgs,
  marketingCampaigns,
  marketingSequences,
  marketingSequenceSteps,
  marketingSequenceEnrollments,
  marketingProspects,
  emailSendAttempts,
  type MarketingCampaign,
  type MarketingSequenceStep,
  type EmailSendAttempt,
  type EmailSendAttemptStatus,
} from "@shared/schema";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { sendViaConnectedMailbox } from "../email/send-via-connected-mailbox";
import { isRecipientSuppressed, recordSuppressedSend } from "../email/failure-tracker";
import {
  WS_SQL_PATTERN,
  effectiveMarketingSender,
  stripWs,
  readAcsRoutingConfig,
  resolveMarketingRoute,
  type AcsRoutingConfig,
} from "../email/marketing-route";
import {
  acsCooldownActive,
  startAcsTokenRefresher,
  stopAcsTokenRefresher,
} from "../email/acs-transport";
import {
  acsSendWaitMs,
  checkAcsCooldownAlert,
  dispatchAcs,
  reconcileAcsOperations,
  type AcsDispatchResult,
  type RetryPolicyForAttempt,
} from "./acs-send";
import { finalizeSequenceAttempt } from "./send-finalize";
import { notifyMarketingTransportDegraded } from "../notifications/marketing-failures";
import {
  listUnsubscribeHeaders,
  unsubscribeFooterText,
  withUnsubscribeFooter,
} from "./unsubscribe";
import { isEmailTrackingEnabled } from "../lib/featureFlags";
import { newTrackingToken, withTracking } from "./tracking";
import { dropTrackingLinks, saveTrackingLinks } from "./tracking-record";
import { MissingMailboxError, RecipientSuppressedError } from "../email/types";
import { redactErrorCode } from "../email/failure-tracker";
import { storage } from "../storage";
import { notifyAdminsOfCampaignFailures } from "../notifications/marketing-failures";

export { computeNextSendAt } from "./send-finalize";

const ADVISORY_LOCK_KEY = 100007;
const TICK_MS = Number(process.env.MARKETING_SCHEDULED_SEND_TICK_MS) || 60_000;
// Exchange Online accepts 30 messages a minute per mailbox; pace Graph sends
// just under that so a campaign does not spend its time in 429 back-off.
const GRAPH_SEND_INTERVAL_MS = 2_100;
// Each phase stops starting new work after its budget and leaves the rest
// due; the next tick resumes it (sent recipients are skipped). Keeps a large
// campaign from holding the advisory lock, and sequences behind it, for half
// an hour. Reconciler 10 s + campaigns 30 s + sequences 15 s fit one tick.
const RECONCILE_BUDGET_MS = 10_000;
const CAMPAIGN_BUDGET_MS = 30_000;
const SEQUENCE_BUDGET_MS = 15_000;
const CAMPAIGN_PAGE = 50;
const ACCEPTED_FALLBACK_RETRY_MS = 60_000;
const PARK_PENDING_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  // Tests inject an instant sleep; production waits for real.
  const override = (global as any).__emailTestSleep as ((ms: number) => Promise<void>) | undefined;
  return override ? override(ms) : new Promise((r) => setTimeout(r, ms));
}

/**
 * Default max attempts (initial + retries) before a recipient is marked
 * a permanent failure. Used as the org-level default when a row doesn't
 * have an override yet, and as the fallback for callers that don't pass
 * a per-org policy. The env var lets ops shift the global default
 * without a deploy; per-org overrides live on `orgs.marketingSendMaxAttempts`.
 */
export const MAX_SEND_ATTEMPTS =
  Number(process.env.MARKETING_SEND_MAX_ATTEMPTS) || 5;

/**
 * Default base delay used for exponential backoff between retries
 * (default 5 minutes). Per-org override lives on
 * `orgs.marketingSendRetryBaseMs`.
 */
export const RETRY_BACKOFF_BASE_MS =
  Number(process.env.MARKETING_SEND_RETRY_BASE_MS) || 5 * 60 * 1000;

/**
 * Task #271 — Resolved retry policy for an org. Both fields fall back
 * to the module defaults above when an org row hasn't been configured
 * (e.g. legacy rows pre-migration that the in-memory storage forgot to
 * default). Values are clamped to safe ranges so a bad DB row can't
 * stall the worker.
 */
export interface OrgRetryPolicy {
  maxAttempts: number;
  baseMs: number;
}

const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 20;
const MIN_BASE_MS = 1_000;
const MAX_BASE_MS = 24 * 60 * 60 * 1000;

export function resolveOrgRetryPolicy(
  org: { marketingSendMaxAttempts?: number | null; marketingSendRetryBaseMs?: number | null } | null | undefined,
): OrgRetryPolicy {
  const rawAttempts =
    typeof org?.marketingSendMaxAttempts === "number"
      ? org.marketingSendMaxAttempts
      : MAX_SEND_ATTEMPTS;
  const rawBase =
    typeof org?.marketingSendRetryBaseMs === "number"
      ? org.marketingSendRetryBaseMs
      : RETRY_BACKOFF_BASE_MS;
  return {
    maxAttempts: Math.max(MIN_MAX_ATTEMPTS, Math.min(MAX_MAX_ATTEMPTS, Math.floor(rawAttempts))),
    baseMs: Math.max(MIN_BASE_MS, Math.min(MAX_BASE_MS, Math.floor(rawBase))),
  };
}

/**
 * Error codes (as classified by `redactErrorCode`) that should be
 * retried instead of giving up. Anything not in this set is treated as
 * permanent and the recipient is dropped after the first attempt so we
 * don't waste attempts retrying e.g. invalid addresses or decrypt
 * failures.
 */
const TRANSIENT_ERROR_CODE_PATTERNS: RegExp[] = [
  /^TIMEOUT$/,
  /^NETWORK_ERROR$/,
  /^HTTP_ERROR_5\d{2}$/,
  /^HTTP_ERROR_429$/,
  /^SMTP_4\d{2}(_|$)/,
  /^TOKEN_REFRESH_FAILED(_|$)/,
  /^SEND_FAILED(_|$)/,
  /^UNKNOWN$/,
];

export function isTransientErrorCode(code: string): boolean {
  return TRANSIENT_ERROR_CODE_PATTERNS.some((re) => re.test(code));
}

/**
 * Pure helper: exponential backoff in ms for the *next* retry given the
 * 1-indexed attempt number that just failed. Attempt 1 → base, attempt
 * 2 → base*2, etc. Capped at 24h to avoid runaway timestamps for very
 * large MAX_SEND_ATTEMPTS overrides.
 */
export function computeBackoffMs(
  failedAttemptNumber: number,
  baseMs: number = RETRY_BACKOFF_BASE_MS,
): number {
  const n = Math.max(1, Math.floor(failedAttemptNumber));
  const ms = baseMs * Math.pow(2, n - 1);
  return Math.min(ms, 24 * 60 * 60 * 1000);
}

export interface ScheduledSendStats {
  campaignsProcessed: number;
  campaignEmailsSent: number;
  campaignErrors: number;
  enrollmentsProcessed: number;
  enrollmentEmailsSent: number;
  enrollmentsCompleted: number;
  enrollmentErrors: number;
}

function emptyStats(): ScheduledSendStats {
  return {
    campaignsProcessed: 0,
    campaignEmailsSent: 0,
    campaignErrors: 0,
    enrollmentsProcessed: 0,
    enrollmentEmailsSent: 0,
    enrollmentsCompleted: 0,
    enrollmentErrors: 0,
  };
}

/**
 * Task #234 — Resolve the audience for a campaign at dispatch time.
 *
 *   * `audienceType='all'` (legacy default): every undeleted brand contact
 *     with a non-null email — preserves the pre-Task-#234 behavior.
 *   * `audienceType='segment'`: contacts that match the saved segment's
 *     filter at the moment of send. Resolved live (not snapshotted) so
 *     edits to the segment after the campaign was scheduled take effect.
 *     If the segment was deleted (FK ON DELETE SET NULL), the campaign
 *     resolves to zero recipients and is marked `sent_at` so the worker
 *     doesn't loop on it.
 */
export async function resolveCampaignRecipients(
  campaign: Pick<MarketingCampaign, "orgId" | "brandId" | "audienceType" | "audienceSegmentId">,
): Promise<Array<{ id: string; email: string | null; unsubscribeToken: string }>> {
  if (campaign.audienceType === "segment") {
    if (!campaign.audienceSegmentId) return [];
    const segment = await storage.getSegment(campaign.audienceSegmentId, campaign.orgId);
    if (!segment || segment.brandId !== campaign.brandId) return [];
    const filter = (segment.filter ?? {}) as { tagIds?: string[]; search?: string };
    // listProspectsByFilter pages (default 50, max 500): walk every page or
    // a segment campaign silently stops at the first 50 contacts.
    const PAGE = 500;
    const contacts: Awaited<ReturnType<typeof storage.resolveSegmentProspects>> = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await storage.resolveSegmentProspects(
        campaign.orgId,
        campaign.brandId,
        { tagIds: filter.tagIds ?? [], search: filter.search ?? "" },
        { limit: PAGE, offset },
      );
      contacts.push(...page);
      if (page.length < PAGE) break;
    }
    // Unsubscribed and bounced prospects never get marketing mail.
    return contacts
      .filter((c) => !!c.email && !c.unsubscribedAt && !c.bouncedAt)
      .map((c) => ({ id: c.id, email: c.email, unsubscribeToken: c.unsubscribeToken }));
  }
  // HR4-FIX-5b1c.1: retargeted to marketingProspects (was clientContacts read on marketing surface).
  // The "all brand contacts" audience for a marketing campaign is the brand's
  // marketing prospects — never PSO client contacts.
  return db
    .select({
      id: marketingProspects.id,
      email: marketingProspects.email,
      unsubscribeToken: marketingProspects.unsubscribeToken,
    })
    .from(marketingProspects)
    .where(and(
      eq(marketingProspects.orgId, campaign.orgId),
      eq(marketingProspects.brandId, campaign.brandId),
      isNull(marketingProspects.deletedAt),
      isNotNull(marketingProspects.email),
      isNull(marketingProspects.unsubscribedAt),
      isNull(marketingProspects.bouncedAt),
    ));
}

type RecipientDecision =
  | { action: "send"; attemptNumber: number }
  | { action: "skip-done" }
  | { action: "skip-pending"; nextRetryAt: Date };

/**
 * Pure helper: decide what to do with a recipient given its most recent
 * `email_send_attempts` row (or null if it has never been attempted)
 * and the current time. Exposed for unit tests.
 */
export function decideRecipientAction(
  latest: Pick<EmailSendAttempt, "status" | "attemptNumber" | "nextRetryAt"> | null,
  now: Date,
  maxAttempts: number = MAX_SEND_ATTEMPTS,
): RecipientDecision {
  if (!latest) return { action: "send", attemptNumber: 1 };
  if (latest.status === "success") return { action: "skip-done" };
  if (latest.status === "permanent_failure") return { action: "skip-done" };
  // An ACS operation still in flight: the reconciler resolves it; never
  // re-send (PLAN r13 §5).
  if (latest.status === "accepted") {
    return {
      action: "skip-pending",
      nextRetryAt: latest.nextRetryAt ?? new Date(now.getTime() + ACCEPTED_FALLBACK_RETRY_MS),
    };
  }
  // Deferred before submission (ACS cooldown / throttle): the same attempt
  // number is sent again once its nextRetryAt passes.
  if (latest.status === "deferred") {
    if (latest.nextRetryAt && latest.nextRetryAt > now) {
      return { action: "skip-pending", nextRetryAt: latest.nextRetryAt };
    }
    return { action: "send", attemptNumber: latest.attemptNumber };
  }
  // status === "failed"
  if (latest.attemptNumber >= maxAttempts) return { action: "skip-done" };
  if (latest.nextRetryAt && latest.nextRetryAt > now) {
    return { action: "skip-pending", nextRetryAt: latest.nextRetryAt };
  }
  return { action: "send", attemptNumber: latest.attemptNumber + 1 };
}

interface AttemptOutcome {
  status: EmailSendAttemptStatus;
  errorCode: string | null;
  errorMessage: string | null;
  transport: string | null;
  providerMessageId: string | null;
  nextRetryAt: Date | null;
}

function classifySuccess(
  result: { transport: string; providerMessageId?: string | null },
): AttemptOutcome {
  return {
    status: "success",
    errorCode: null,
    errorMessage: null,
    transport: result.transport,
    providerMessageId: result.providerMessageId ?? null,
    nextRetryAt: null,
  };
}

function classifyFailure(
  err: unknown,
  attemptNumber: number,
  now: Date,
  maxAttempts: number = MAX_SEND_ATTEMPTS,
  baseMs: number = RETRY_BACKOFF_BASE_MS,
): AttemptOutcome {
  // A suppressed recipient is never retried (PLAN r13 §6).
  const errorCode = err instanceof RecipientSuppressedError ? "SUPPRESSED" : redactErrorCode(err);
  const transient = errorCode !== "SUPPRESSED" && isTransientErrorCode(errorCode);
  const exhausted = attemptNumber >= maxAttempts;
  const permanent = !transient || exhausted;
  const message = err instanceof Error ? err.message : String(err);
  // Truncate the raw message so a verbose stack trace doesn't bloat the
  // table; the redacted error_code is the canonical machine-readable
  // signal anyway.
  const trimmed = message.length > 500 ? `${message.slice(0, 500)}…` : message;
  return {
    status: permanent ? "permanent_failure" : "failed",
    errorCode,
    errorMessage: trimmed,
    transport: null,
    providerMessageId: null,
    nextRetryAt: permanent ? null : new Date(now.getTime() + computeBackoffMs(attemptNumber, baseMs)),
  };
}

/**
 * A campaign or sequence-step body with links rewritten for click tracking
 * and the open pixel added. The link row is committed BEFORE the send, so
 * every rewritten link in a delivered email resolves even if the attempt
 * insert never happens. Tracking is best-effort: if the body cannot be
 * parsed, or that insert fails or cannot finish within the tracking bounds,
 * the email goes out untracked rather than late or not at all. The
 * unsubscribe footer is added by the caller afterwards, so it is never
 * rewritten.
 */
async function trackedHtml(
  body: string,
  link: {
    orgId: string;
    kind: "campaign" | "sequence";
    campaignId: string | null;
    prospectId: string;
    attemptId: string;
  },
  logLabel: string,
): Promise<{ html: string; token: string | null }> {
  if (!isEmailTrackingEnabled()) return { html: body, token: null };
  const token = newTrackingToken();
  try {
    const tracked = withTracking(body, token);
    await saveTrackingLinks({ token, ...link, links: tracked.links });
    return { html: tracked.html, token };
  } catch (err) {
    console.error(
      `[marketing-scheduled-send] ${logLabel}: tracking off for this send:`,
      err instanceof Error ? err.message : err,
    );
    return { html: body, token: null };
  }
}

// One query per campaign, not per recipient: a resumed campaign re-walks its
// whole audience every tick, and per-recipient lookups for thousands of
// already-sent rows could eat the tick budget before a single new send.
async function getLatestCampaignAttempts(
  orgId: string,
  campaignId: string,
): Promise<Map<string, EmailSendAttempt>> {
  const rows = await db
    .select()
    .from(emailSendAttempts)
    .where(and(
      eq(emailSendAttempts.orgId, orgId),
      eq(emailSendAttempts.campaignId, campaignId),
    ))
    .orderBy(desc(emailSendAttempts.attemptedAt));
  const latest = new Map<string, EmailSendAttempt>();
  for (const row of rows) {
    if (row.prospectId && !latest.has(row.prospectId)) latest.set(row.prospectId, row);
  }
  return latest;
}

async function getLatestSequenceAttempt(
  orgId: string,
  sequenceId: string,
  prospectId: string,
  stepIndex: number,
): Promise<EmailSendAttempt | null> {
  const [row] = await db
    .select()
    .from(emailSendAttempts)
    .where(and(
      eq(emailSendAttempts.orgId, orgId),
      eq(emailSendAttempts.sequenceId, sequenceId),
      eq(emailSendAttempts.prospectId, prospectId),
      eq(emailSendAttempts.stepIndex, stepIndex),
    ))
    .orderBy(desc(emailSendAttempts.attemptedAt))
    .limit(1);
  return row ?? null;
}

async function isStillMailable(prospectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: marketingProspects.id })
    .from(marketingProspects)
    .where(and(
      eq(marketingProspects.id, prospectId),
      isNull(marketingProspects.deletedAt),
      isNull(marketingProspects.unsubscribedAt),
      isNull(marketingProspects.bouncedAt),
    ))
    .limit(1);
  return !!row;
}

// ── ACS tick context, fairness, campaign cursor (PLAN r13 §6) ───────────────

export interface AcsTickContext {
  config: AcsRoutingConfig;
  /** Ids of the orgs named in ACS_EMAIL_ORG_SLUGS (empty when the endpoint is unset). */
  orgIds: string[];
}

export async function loadAcsTickContext(): Promise<AcsTickContext> {
  const config = readAcsRoutingConfig();
  if (!config.endpoint || config.orgSlugs.length === 0) return { config, orgIds: [] };
  const rows = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(inArray(sql`lower(${orgs.slug})`, config.orgSlugs));
  return { config, orgIds: rows.map((r) => r.id) };
}

/**
 * While the ACS send cooldown is active, keep only items whose effective
 * sender does NOT route to ACS. NULL-safe: an item with no effective sender
 * routes to the connected mailbox and must stay selected. The expression is
 * `effectiveMarketingSender` in SQL, built from the same `WS` set.
 */
function acsCooldownExclusion(
  orgIdCol: AnyColumn,
  itemFromCol: AnyColumn,
  ctx: AcsTickContext,
): SQL | undefined {
  if (!ctx.config.endpoint || ctx.orgIds.length === 0 || ctx.config.senders.length === 0) return undefined;
  if (!acsCooldownActive()) return undefined;
  const effective = sql`lower(coalesce(nullif(regexp_replace(${itemFromCol}, ${WS_SQL_PATTERN}, '', 'g'), ''), regexp_replace(${brands.fromEmail}, ${WS_SQL_PATTERN}, '', 'g')))`;
  const senders = sql.join(ctx.config.senders.map((s) => sql`${s}`), sql`, `);
  return sql`((${inArray(orgIdCol, ctx.orgIds)}) AND ${effective} IN (${senders})) IS NOT TRUE`;
}

// Keyset cursor over due campaigns, so campaigns with nothing to dispatch
// (all recipients pending at the provider) cannot hold the 50-row window.
// Per process; a restart starts from the beginning.
let campaignCursor: { sendAt: Date; id: string } | null = null;

export function resetCampaignCursorForTests(): void {
  campaignCursor = null;
}

function retryPolicyFor(policy: OrgRetryPolicy, attemptNumber: number): RetryPolicyForAttempt {
  return { maxAttempts: policy.maxAttempts, backoffMs: computeBackoffMs(attemptNumber, policy.baseMs) };
}

async function hasAcceptedCampaignAttempt(campaignId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailSendAttempts.id })
    .from(emailSendAttempts)
    .where(and(eq(emailSendAttempts.campaignId, campaignId), eq(emailSendAttempts.status, "accepted")))
    .limit(1);
  return !!row;
}

export async function processScheduledCampaigns(
  now: Date = new Date(),
  acsCtx?: AcsTickContext,
): Promise<{ processed: number; sent: number; errors: number }> {
  const ctx = acsCtx ?? (await loadAcsTickContext());
  const cursor = campaignCursor;
  const page = await db
    .select({ campaign: marketingCampaigns })
    .from(marketingCampaigns)
    .leftJoin(brands, eq(brands.id, marketingCampaigns.brandId))
    .where(and(
      isNull(marketingCampaigns.sentAt),
      isNotNull(marketingCampaigns.sendAt),
      lte(marketingCampaigns.sendAt, now),
      cursor
        ? or(
            gt(marketingCampaigns.sendAt, cursor.sendAt),
            and(eq(marketingCampaigns.sendAt, cursor.sendAt), gt(marketingCampaigns.id, cursor.id)),
          )
        : undefined,
      acsCooldownExclusion(marketingCampaigns.orgId, marketingCampaigns.fromEmail, ctx),
    ))
    .orderBy(asc(marketingCampaigns.sendAt), asc(marketingCampaigns.id))
    .limit(CAMPAIGN_PAGE);
  const due = page.map((r) => r.campaign);

  let processed = 0;
  let sent = 0;
  let errors = 0;

  // Task #271 — Resolve each org's retry policy at most once per tick.
  const policyCache = new Map<string, OrgRetryPolicy>();
  const orgCache = new Map<string, Awaited<ReturnType<typeof storage.getOrg>>>();
  async function getOrg(orgId: string) {
    if (!orgCache.has(orgId)) orgCache.set(orgId, await storage.getOrg(orgId));
    return orgCache.get(orgId);
  }
  async function getPolicy(orgId: string): Promise<OrgRetryPolicy> {
    const hit = policyCache.get(orgId);
    if (hit) return hit;
    const org = await getOrg(orgId);
    const policy = resolveOrgRetryPolicy(org ?? null);
    policyCache.set(orgId, policy);
    return policy;
  }

  const brandCache = new Map<string, Awaited<ReturnType<typeof storage.getBrand>>>();
  async function getBrand(brandId: string, orgId: string) {
    if (!brandCache.has(brandId)) brandCache.set(brandId, await storage.getBrand(brandId, orgId));
    return brandCache.get(brandId);
  }

  const deadline = Date.now() + CAMPAIGN_BUDGET_MS;
  let lastTransport: string | null = null;
  // The cursor moves to the last campaign this tick fully visited; one left
  // mid-way (out of time) is resumed from the same place next tick.
  let lastVisited: MarketingCampaign | null = null;
  let pageFinished = true;

  for (const campaign of due) {
    if (Date.now() >= deadline) {
      pageFinished = false;
      break;
    }
    const recipients = await resolveCampaignRecipients(campaign);
    const policy = await getPolicy(campaign.orgId);
    const brand = await getBrand(campaign.brandId, campaign.orgId);
    const org = await getOrg(campaign.orgId);
    const fromName = (campaign.fromName || brand?.fromName || "").trim() || null;
    const fromEmail = (campaign.fromEmail || brand?.fromEmail || "").trim() || null;
    const replyTo = (campaign.replyTo || brand?.replyTo || "").trim() || null;
    const effectiveFrom = effectiveMarketingSender(campaign.fromEmail, brand?.fromEmail);
    const route = resolveMarketingRoute(org, effectiveFrom, ctx.config);
    const latestAttempts = await getLatestCampaignAttempts(campaign.orgId, campaign.id);

    let mailboxMissing = false;
    let outOfTime = false;
    let stopped = false;
    let dispatchedThisCampaign = 0;
    let pendingRetries = 0;

    for (const r of recipients) {
      if (!r.email) continue;
      if (Date.now() >= deadline) {
        outOfTime = true;
        break;
      }
      const decision = decideRecipientAction(latestAttempts.get(r.id) ?? null, now, policy.maxAttempts);
      if (decision.action === "skip-done") continue;
      if (decision.action === "skip-pending") {
        pendingRetries++;
        continue;
      }
      // During a known ACS cooldown nothing is written and ACS is not called.
      if (route === "acs" && acsCooldownActive()) {
        pendingRetries++;
        stopped = true;
        break;
      }

      // A long campaign spans many minutes: someone who unsubscribed from an
      // earlier email in the meantime must not get this one.
      if (!(await isStillMailable(r.id))) continue;
      if (route === "connected" && lastTransport === "graph") await sleep(GRAPH_SEND_INTERVAL_MS);
      const attemptNumber = decision.attemptNumber;
      const attemptId = randomUUID();
      let outcome: AttemptOutcome;
      let trackingToken: string | null = null;
      try {
        if (route === "acs") {
          const suppression = await isRecipientSuppressed(campaign.orgId, r.email);
          if (suppression) {
            recordSuppressedSend(campaign.orgId, "acs", r.email);
            throw new RecipientSuppressedError(suppression.hash, suppression.reason);
          }
        }
        const tracked = await trackedHtml(
          campaign.body ?? "",
          { orgId: campaign.orgId, kind: "campaign", campaignId: campaign.id, prospectId: r.id, attemptId },
          `campaign=${campaign.id} contact=${r.id}`,
        );
        trackingToken = tracked.token;
        const html = tracked.html;
        const footer = { token: r.unsubscribeToken, org };

        if (route === "acs") {
          await sleep(acsSendWaitMs());
          const result = await dispatchAcs({
            endpoint: ctx.config.endpoint!,
            intent: {
              kind: "campaign",
              campaignId: campaign.id,
              attemptId,
              orgId: campaign.orgId,
              prospectId: r.id,
              recipientEmail: r.email,
              attemptNumber,
            },
            senderAddress: effectiveFrom!,
            message: {
              to: r.email,
              subject: campaign.subject || campaign.name,
              html: withUnsubscribeFooter(html, footer),
              text: (campaign.body ?? "") + unsubscribeFooterText(footer),
              replyTo,
              headers: listUnsubscribeHeaders(r.unsubscribeToken),
            },
            trackingToken,
            deadline,
            retry: retryPolicyFor(policy, attemptNumber),
          });
          lastTransport = "acs";
          if (result.kind === "aborted") {
            // The campaign was sent or deleted under the lock: nothing more to do here.
            stopped = true;
            break;
          }
          if (result.kind === "accepted") {
            sent++;
            dispatchedThisCampaign++;
            pendingRetries++;
          } else if (result.kind === "deferred") {
            pendingRetries++;
            stopped = true;
            break;
          } else {
            errors++;
          }
          // dispatchAcs owns the row from its intent insert on.
          continue;
        }

        const result = await sendViaConnectedMailbox({
          orgId: campaign.orgId,
          to: r.email,
          subject: campaign.subject || campaign.name,
          html: withUnsubscribeFooter(html, footer),
          text: (campaign.body ?? "") + unsubscribeFooterText(footer),
          replyTo,
          fromName,
          fromEmail,
          headers: listUnsubscribeHeaders(r.unsubscribeToken),
        });
        lastTransport = result.transport;
        outcome = classifySuccess(result);
        // The email is out: a timeline write failing here must not turn the
        // attempt into a failure, which would send it again next tick.
        await storage.createActivity({
          orgId: campaign.orgId,
          brandId: campaign.brandId,
          // Sprint 2o.0 (5b1b): scheduled-send recipients are marketing prospects.
          prospectId: r.id,
          type: "email_sent",
          payload: {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            subject: campaign.subject || campaign.name,
            transport: result.transport,
            provider_message_id: result.providerMessageId,
            attempt_number: attemptNumber,
          },
          actorId: null,
        }).catch((err) => console.error(
          `[marketing-scheduled-send] campaign=${campaign.id} contact=${r.id}: email_sent activity failed:`,
          err instanceof Error ? err.message : err,
        ));
        sent++;
        dispatchedThisCampaign++;
      } catch (err) {
        if (err instanceof MissingMailboxError) {
          mailboxMissing = true;
          // No attempt row is written on this path, and the campaign retries
          // every tick until a mailbox is connected: drop the unsent link row.
          if (trackingToken) {
            await dropTrackingLinks(trackingToken);
          }
          break;
        }
        outcome = classifyFailure(err, attemptNumber, now, policy.maxAttempts, policy.baseMs);
        if (outcome.status === "failed") pendingRetries++;
        errors++;
        console.error(
          `[marketing-scheduled-send] campaign=${campaign.id} contact=${r.id} ` +
          `attempt=${attemptNumber} ${outcome.status} (${outcome.errorCode}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await db.insert(emailSendAttempts).values({
        id: attemptId,
        orgId: campaign.orgId,
        kind: "campaign",
        campaignId: campaign.id,
        prospectId: r.id,
        recipientEmail: r.email,
        attemptNumber,
        status: outcome.status,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        transport: outcome.transport,
        providerMessageId: outcome.providerMessageId,
        attemptedAt: now,
        nextRetryAt: outcome.nextRetryAt,
      });
    }

    if (outOfTime) {
      console.log(
        `[marketing-scheduled-send] campaign=${campaign.id} dispatched=${dispatchedThisCampaign} — ` +
        `tick budget spent, resuming next tick.`,
      );
      pageFinished = false;
      break;
    }
    lastVisited = campaign;

    if (mailboxMissing) {
      console.warn(
        `[marketing-scheduled-send] campaign=${campaign.id} org=${campaign.orgId}: ` +
        `mailbox not connected — leaving campaign pending.`,
      );
      continue;
    }

    if (stopped || pendingRetries > 0) {
      console.log(
        `[marketing-scheduled-send] campaign=${campaign.id} ` +
        `dispatched=${dispatchedThisCampaign} pending_retries=${pendingRetries} — ` +
        `leaving campaign pending until retries are resolved.`,
      );
      continue;
    }

    // An ACS operation still unresolved keeps the campaign open (PLAN §4).
    if (await hasAcceptedCampaignAttempt(campaign.id)) continue;

    await db
      .update(marketingCampaigns)
      .set({ sentAt: now, updatedAt: now })
      .where(eq(marketingCampaigns.id, campaign.id));
    processed++;
    console.log(
      `[marketing-scheduled-send] campaign=${campaign.id} dispatched=${dispatchedThisCampaign} recipients=${recipients.length}`,
    );

    // Task #269: fire-and-forget admin digest summarising recipients
    // that permanently failed. Errors inside the helper are swallowed
    // so they cannot mask the campaign-finalize success.
    void notifyAdminsOfCampaignFailures(campaign, recipients.length).catch(
      (e) =>
        console.error(
          `[marketing-scheduled-send] failure-notify campaign=${campaign.id} failed:`,
          e,
        ),
    );
  }

  if (pageFinished && due.length < CAMPAIGN_PAGE) {
    campaignCursor = null;
  } else if (lastVisited?.sendAt) {
    campaignCursor = { sendAt: lastVisited.sendAt, id: lastVisited.id };
  }

  return { processed, sent, errors };
}

export async function processScheduledSequenceEnrollments(
  now: Date = new Date(),
  acsCtx?: AcsTickContext,
): Promise<{ processed: number; sent: number; completed: number; errors: number }> {
  const ctx = acsCtx ?? (await loadAcsTickContext());
  // Sprint 2o.0: enrollments now reference marketing_prospects (HR4).
  // Joining marketing_prospects (not client_contacts) for the recipient
  // email + soft-delete check.
  const due = await db
    .select({
      enrollment: marketingSequenceEnrollments,
      sequence: marketingSequences,
      contactEmail: marketingProspects.email,
      contactDeletedAt: marketingProspects.deletedAt,
      contactUnsubscribedAt: marketingProspects.unsubscribedAt,
      contactBouncedAt: marketingProspects.bouncedAt,
      contactUnsubscribeToken: marketingProspects.unsubscribeToken,
      brandFromEmail: brands.fromEmail,
      brandReplyTo: brands.replyTo,
    })
    .from(marketingSequenceEnrollments)
    .innerJoin(
      marketingSequences,
      eq(marketingSequences.id, marketingSequenceEnrollments.sequenceId),
    )
    .innerJoin(
      marketingProspects,
      eq(marketingProspects.id, marketingSequenceEnrollments.prospectId),
    )
    .leftJoin(brands, eq(brands.id, marketingSequences.brandId))
    .where(and(
      eq(marketingSequenceEnrollments.status, "active"),
      isNotNull(marketingSequenceEnrollments.nextSendAt),
      lte(marketingSequenceEnrollments.nextSendAt, now),
      acsCooldownExclusion(marketingSequences.orgId, marketingSequences.fromEmail, ctx),
    ))
    .orderBy(asc(marketingSequenceEnrollments.nextSendAt), asc(marketingSequenceEnrollments.id))
    .limit(200);

  let processed = 0;
  let sent = 0;
  let completed = 0;
  let errors = 0;

  // Task #271 — Per-org retry policy cache (one lookup per org per tick).
  const policyCache = new Map<string, OrgRetryPolicy>();
  const orgCache = new Map<string, Awaited<ReturnType<typeof storage.getOrg>>>();
  async function getOrg(orgId: string) {
    if (!orgCache.has(orgId)) orgCache.set(orgId, await storage.getOrg(orgId));
    return orgCache.get(orgId);
  }
  async function getPolicy(orgId: string): Promise<OrgRetryPolicy> {
    const hit = policyCache.get(orgId);
    if (hit) return hit;
    const org = await getOrg(orgId);
    const policy = resolveOrgRetryPolicy(org ?? null);
    policyCache.set(orgId, policy);
    return policy;
  }

  // Cache steps per sequence id within this tick to avoid N queries.
  const stepsCache = new Map<string, MarketingSequenceStep[]>();
  async function loadSteps(sequenceId: string, orgId: string): Promise<MarketingSequenceStep[]> {
    const hit = stepsCache.get(sequenceId);
    if (hit) return hit;
    const rows = await db
      .select()
      .from(marketingSequenceSteps)
      .where(and(
        eq(marketingSequenceSteps.sequenceId, sequenceId),
        eq(marketingSequenceSteps.orgId, orgId),
      ))
      .orderBy(asc(marketingSequenceSteps.stepOrder));
    stepsCache.set(sequenceId, rows);
    return rows;
  }

  async function removeEnrollment(enrollmentId: string): Promise<void> {
    await db
      .update(marketingSequenceEnrollments)
      .set({ status: "removed", nextSendAt: null, updatedAt: now })
      .where(eq(marketingSequenceEnrollments.id, enrollmentId));
  }

  const deadline = Date.now() + SEQUENCE_BUDGET_MS;

  for (const row of due) {
    // Unreached enrollments stay due for the next tick.
    if (Date.now() >= deadline) break;
    const enr = row.enrollment;
    const seq = row.sequence;

    // Soft-deleted, unsubscribed and bounced contacts leave the sequence.
    if (row.contactDeletedAt || !row.contactEmail || row.contactUnsubscribedAt || row.contactBouncedAt) {
      await removeEnrollment(enr.id);
      continue;
    }

    const steps = await loadSteps(enr.sequenceId, enr.orgId);
    if (steps.length === 0 || enr.currentStepIndex >= steps.length) {
      await db
        .update(marketingSequenceEnrollments)
        .set({ status: "completed", nextSendAt: null, updatedAt: now })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
      completed++;
      continue;
    }

    const step = steps[enr.currentStepIndex];
    const policy = await getPolicy(enr.orgId);
    const latest = await getLatestSequenceAttempt(
      enr.orgId,
      enr.sequenceId,
      enr.prospectId,
      enr.currentStepIndex,
    );
    const decision = decideRecipientAction(latest, now, policy.maxAttempts);

    if (decision.action === "skip-pending") {
      // An unresolved ACS operation parks the enrollment out of the due set
      // (resolution always overwrites it). Otherwise align nextSendAt with
      // the persisted retry schedule in case a manual edit advanced it
      // earlier than the backoff.
      const nextSendAt = latest?.status === "accepted"
        ? new Date(latest.attemptedAt.getTime() + PARK_PENDING_MS)
        : decision.nextRetryAt;
      await db
        .update(marketingSequenceEnrollments)
        .set({ nextSendAt, updatedAt: now })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
      continue;
    }

    if (decision.action === "skip-done") {
      // The latest attempt is terminal (written by an older worker that never
      // advanced): repair through the one finalizer.
      const result = await finalizeSequenceAttempt({
        mode: "advance",
        sequenceId: enr.sequenceId,
        enrollmentId: enr.id,
        stepIndex: enr.currentStepIndex,
        resolvedAt: now,
      });
      if (result.enrollment === "completed") completed++;
      processed++;
      continue;
    }

    // The 200-row snapshot can be minutes old.
    if (!(await isStillMailable(enr.prospectId))) {
      await removeEnrollment(enr.id);
      continue;
    }

    const org = await getOrg(enr.orgId);
    const effectiveFrom = effectiveMarketingSender(seq.fromEmail, row.brandFromEmail);
    const route = resolveMarketingRoute(org, effectiveFrom, ctx.config);
    // During a known ACS cooldown nothing is written and ACS is not called;
    // the enrollment stays due.
    if (route === "acs" && acsCooldownActive()) continue;

    const attemptNumber = decision.attemptNumber;
    const attemptId = randomUUID();
    const attemptValues = {
      id: attemptId,
      orgId: enr.orgId,
      kind: "sequence" as const,
      sequenceId: enr.sequenceId,
      enrollmentId: enr.id,
      stepIndex: enr.currentStepIndex,
      prospectId: enr.prospectId,
      recipientEmail: row.contactEmail,
      attemptNumber,
      attemptedAt: now,
    };
    let outcome: AttemptOutcome;
    let trackingToken: string | null = null;
    try {
      if (route === "acs") {
        const suppression = await isRecipientSuppressed(enr.orgId, row.contactEmail);
        if (suppression) {
          recordSuppressedSend(enr.orgId, "acs", row.contactEmail);
          throw new RecipientSuppressedError(suppression.hash, suppression.reason);
        }
      }
      const tracked = await trackedHtml(
        step.body ?? "",
        { orgId: enr.orgId, kind: "sequence", campaignId: null, prospectId: enr.prospectId, attemptId },
        `enrollment=${enr.id} step=${enr.currentStepIndex}`,
      );
      trackingToken = tracked.token;
      const footer = { token: row.contactUnsubscribeToken, org };

      if (route === "acs") {
        await sleep(acsSendWaitMs());
        const replyTo = stripWs(seq.replyTo || row.brandReplyTo || "") || null;
        const result: AcsDispatchResult = await dispatchAcs({
          endpoint: ctx.config.endpoint!,
          intent: {
            kind: "sequence",
            sequenceId: enr.sequenceId,
            enrollmentId: enr.id,
            stepIndex: enr.currentStepIndex,
            step: { id: step.id, subject: step.subject, body: step.body },
            attemptId,
            orgId: enr.orgId,
            prospectId: enr.prospectId,
            recipientEmail: row.contactEmail,
            attemptNumber,
          },
          senderAddress: effectiveFrom!,
          message: {
            to: row.contactEmail,
            subject: step.subject || seq.name,
            html: withUnsubscribeFooter(tracked.html, footer),
            text: (step.body ?? "") + unsubscribeFooterText(footer),
            replyTo,
            headers: listUnsubscribeHeaders(row.contactUnsubscribeToken),
          },
          trackingToken,
          deadline,
          retry: retryPolicyFor(policy, attemptNumber),
        });
        // aborted: the enrollment stays due and is rebuilt next tick.
        // accepted: already parked by the intent; resolved by the reconciler.
        // deferred: moved to the deferral's nextRetryAt.
        // rejected: finalized (and advanced) by dispatchAcs.
        if (result.kind === "accepted") {
          sent++;
          processed++;
        } else if (result.kind === "rejected") {
          errors++;
          processed++;
        }
        continue;
      }

      const result = await sendViaConnectedMailbox({
        orgId: enr.orgId,
        to: row.contactEmail,
        subject: step.subject || seq.name,
        html: withUnsubscribeFooter(tracked.html, footer),
        text: (step.body ?? "") + unsubscribeFooterText(footer),
        replyTo: seq.replyTo || null,
        headers: listUnsubscribeHeaders(row.contactUnsubscribeToken),
      });
      outcome = classifySuccess(result);
      // The email is out: a timeline write failing here must not turn the
      // attempt into a failure, which would send the step again next tick.
      await storage.createActivity({
        orgId: enr.orgId,
        brandId: seq.brandId,
        // Sprint 2o.0 (5b1b): sequence enrollments are keyed by prospectId.
        prospectId: enr.prospectId,
        type: "email_sent",
        payload: {
          sequence_id: seq.id,
          sequence_name: seq.name,
          step_id: step.id,
          step_index: enr.currentStepIndex,
          subject: step.subject || seq.name,
          transport: result.transport,
          provider_message_id: result.providerMessageId,
          attempt_number: attemptNumber,
        },
        actorId: null,
      }).catch((err) => console.error(
        `[marketing-scheduled-send] enrollment=${enr.id} step=${enr.currentStepIndex}: email_sent activity failed:`,
        err instanceof Error ? err.message : err,
      ));
      sent++;
    } catch (err) {
      if (err instanceof MissingMailboxError) {
        console.warn(
          `[marketing-scheduled-send] enrollment=${enr.id} org=${enr.orgId}: ` +
          `mailbox not connected — leaving enrollment pending.`,
        );
        // No attempt row is written on this path and the step retries
        // next tick: drop the unsent link row.
        if (trackingToken) {
          await dropTrackingLinks(trackingToken);
        }
        continue;
      }
      outcome = classifyFailure(err, attemptNumber, now, policy.maxAttempts, policy.baseMs);
      errors++;
      console.error(
        `[marketing-scheduled-send] enrollment=${enr.id} step=${enr.currentStepIndex} ` +
        `attempt=${attemptNumber} ${outcome.status} (${outcome.errorCode}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (outcome.status === "failed") {
      // Transient: re-schedule and stay on the same step.
      await db.insert(emailSendAttempts).values({
        ...attemptValues,
        status: outcome.status,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        transport: outcome.transport,
        providerMessageId: outcome.providerMessageId,
        nextRetryAt: outcome.nextRetryAt,
      });
      await db
        .update(marketingSequenceEnrollments)
        .set({ nextSendAt: outcome.nextRetryAt, updatedAt: now })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
      processed++;
      continue;
    }

    // success / permanent_failure: the attempt row and the enrollment's
    // advance commit together; a permanent failure queues the admin digest
    // (Task #269 / #304) from the finalizer.
    const result = await finalizeSequenceAttempt({
      mode: "insert",
      values: {
        ...attemptValues,
        transport: outcome.transport,
        providerMessageId: outcome.providerMessageId,
      },
      resolvedAt: now,
      status: outcome.status as "success" | "permanent_failure",
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    });
    if (result.enrollment === "completed") completed++;
    processed++;
  }

  return { processed, sent, completed, errors };
}

/** Reconciler retry policy: the attempt's org policy, cached for the tick. */
function makeRetryFor(): (attempt: EmailSendAttempt) => Promise<RetryPolicyForAttempt> {
  const cache = new Map<string, OrgRetryPolicy>();
  return async (attempt) => {
    let policy = cache.get(attempt.orgId);
    if (!policy) {
      policy = resolveOrgRetryPolicy((await storage.getOrg(attempt.orgId)) ?? null);
      cache.set(attempt.orgId, policy);
    }
    return retryPolicyFor(policy, attempt.attemptNumber);
  };
}

export async function runScheduledSendTick(): Promise<ScheduledSendStats | null> {
  // Task #288 — Advisory locks are session-scoped, so the unlock must
  // run on the *same* pg connection that acquired the lock. Using
  // `pool.query` would hand out an arbitrary connection for each call,
  // and a mismatched unlock is silently a no-op — the lock then stays
  // held on the original session until it idles out (~30s) or the
  // server restarts, blocking every other tick across the fleet from
  // dispatching. Check out a dedicated client and release it in
  // `finally` so the lock is guaranteed to land on the lock-holding
  // session.
  const client = await pool.connect();
  let acquired!: boolean;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [ADVISORY_LOCK_KEY],
    );
    acquired = !!lockResult.rows[0]?.acquired;
    if (!acquired) return null;
    const stats = emptyStats();
    try {
      const ctx = await loadAcsTickContext();
      // Accepted ACS operations are resolved first, whatever the routing
      // allowlists say (PLAN §4).
      if (ctx.config.endpoint) {
        checkAcsCooldownAlert(ctx.orgIds);
        await reconcileAcsOperations(ctx.config.endpoint, Date.now() + RECONCILE_BUDGET_MS, makeRetryFor())
          .catch((e) => console.error("[marketing-scheduled-send] acs reconcile failed:", e));
      }

      const now = new Date();
      const c = await processScheduledCampaigns(now, ctx).catch((e) => {
        console.error("[marketing-scheduled-send] campaigns failed:", e);
        return { processed: 0, sent: 0, errors: 1 };
      });
      stats.campaignsProcessed = c.processed;
      stats.campaignEmailsSent = c.sent;
      stats.campaignErrors = c.errors;

      const e = await processScheduledSequenceEnrollments(new Date(), ctx).catch((err) => {
        console.error("[marketing-scheduled-send] enrollments failed:", err);
        return { processed: 0, sent: 0, completed: 0, errors: 1 };
      });
      stats.enrollmentsProcessed = e.processed;
      stats.enrollmentEmailsSent = e.sent;
      stats.enrollmentsCompleted = e.completed;
      stats.enrollmentErrors = e.errors;

      if (stats.campaignEmailsSent > 0 || stats.enrollmentEmailsSent > 0 ||
          stats.campaignErrors > 0 || stats.enrollmentErrors > 0) {
        console.log(
          `[marketing-scheduled-send] campaigns(processed=${stats.campaignsProcessed} sent=${stats.campaignEmailsSent} errors=${stats.campaignErrors}) ` +
          `enrollments(processed=${stats.enrollmentsProcessed} sent=${stats.enrollmentEmailsSent} completed=${stats.enrollmentsCompleted} errors=${stats.enrollmentErrors})`,
        );
      }
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY])
        .catch(() => {});
    }
    return stats;
  } finally {
    client.release();
  }
}

let interval: ReturnType<typeof setInterval> | null = null;

export function startMarketingScheduledSendProcessor(): void {
  if (interval) return;
  if (readAcsRoutingConfig().endpoint) {
    // A token that cannot be refreshed is an ACS outage: tell each ACS org.
    startAcsTokenRefresher(() => {
      void loadAcsTickContext().then((ctx) =>
        ctx.orgIds.forEach((id) => void notifyMarketingTransportDegraded(id, "ACS_AUTH")),
      ).catch(() => {});
    });
  }
  // Fire once on boot so a campaign queued during the previous downtime
  // dispatches without waiting for the first tick.
  runScheduledSendTick().catch((e) =>
    console.error("[marketing-scheduled-send] boot tick failed:", e),
  );
  interval = setInterval(() => {
    runScheduledSendTick().catch((e) =>
      console.error("[marketing-scheduled-send] tick failed:", e),
    );
  }, TICK_MS);
  // Keep the event loop free during graceful shutdown.
  if (typeof interval.unref === "function") interval.unref();
  console.log(
    `[marketing-scheduled-send] processor started (tick=${TICK_MS}ms)`,
  );
}

export function stopMarketingScheduledSendProcessor(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  stopAcsTokenRefresher();
}

// Re-export for convenience in tests / admin views.
export { sql };
