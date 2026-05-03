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
 */
import { db, pool } from "../db";
import {
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
import { and, asc, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { sendViaConnectedMailbox } from "../email/send-via-connected-mailbox";
import { MissingMailboxError } from "../email/types";
import { redactErrorCode } from "../email/failure-tracker";
import { storage } from "../storage";
import {
  notifyAdminsOfCampaignFailures,
  notifyAdminsOfSequenceStepPermanentFailure,
} from "../notifications/marketing-failures";

const ADVISORY_LOCK_KEY = 100007;
const TICK_MS = Number(process.env.MARKETING_SCHEDULED_SEND_TICK_MS) || 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Pure helper: given a sorted-by-stepOrder list of sequence steps, the
 * index of the step that was just dispatched, and the current time,
 * compute (a) the next step index and (b) the next send timestamp. When
 * the dispatched step was the final one, returns `done: true` so the
 * caller marks the enrollment completed.
 */
export function computeNextSendAt(
  steps: Array<Pick<MarketingSequenceStep, "delayDays">>,
  justDispatchedIndex: number,
  now: Date,
): { done: true } | { done: false; nextIndex: number; nextSendAt: Date } {
  const nextIndex = justDispatchedIndex + 1;
  if (nextIndex >= steps.length) return { done: true };
  const delayDays = Math.max(0, steps[nextIndex].delayDays ?? 0);
  return {
    done: false,
    nextIndex,
    nextSendAt: new Date(now.getTime() + delayDays * DAY_MS),
  };
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
): Promise<Array<{ id: string; email: string | null }>> {
  if (campaign.audienceType === "segment") {
    if (!campaign.audienceSegmentId) return [];
    const segment = await storage.getSegment(campaign.audienceSegmentId, campaign.orgId);
    if (!segment || segment.brandId !== campaign.brandId) return [];
    const filter = (segment.filter ?? {}) as { tagIds?: string[]; search?: string };
    const contacts = await storage.resolveSegmentProspects(
      campaign.orgId,
      campaign.brandId,
      { tagIds: filter.tagIds ?? [], search: filter.search ?? "" },
    );
    return contacts
      .filter((c) => !!c.email)
      .map((c) => ({ id: c.id, email: c.email }));
  }
  // HR4-FIX-5b1c.1: retargeted to marketingProspects (was clientContacts read on marketing surface).
  // The "all brand contacts" audience for a marketing campaign is the brand's
  // marketing prospects — never PSO client contacts.
  return db
    .select({ id: marketingProspects.id, email: marketingProspects.email })
    .from(marketingProspects)
    .where(and(
      eq(marketingProspects.orgId, campaign.orgId),
      eq(marketingProspects.brandId, campaign.brandId),
      isNull(marketingProspects.deletedAt),
      isNotNull(marketingProspects.email),
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
  const errorCode = redactErrorCode(err);
  const transient = isTransientErrorCode(errorCode);
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

async function getLatestCampaignAttempt(
  orgId: string,
  campaignId: string,
  prospectId: string,
): Promise<EmailSendAttempt | null> {
  const [row] = await db
    .select()
    .from(emailSendAttempts)
    .where(and(
      eq(emailSendAttempts.orgId, orgId),
      eq(emailSendAttempts.campaignId, campaignId),
      eq(emailSendAttempts.prospectId, prospectId),
    ))
    .orderBy(desc(emailSendAttempts.attemptedAt))
    .limit(1);
  return row ?? null;
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

export async function processScheduledCampaigns(
  now: Date = new Date(),
): Promise<{ processed: number; sent: number; errors: number }> {
  const due = await db
    .select()
    .from(marketingCampaigns)
    .where(and(
      isNull(marketingCampaigns.sentAt),
      isNotNull(marketingCampaigns.sendAt),
      lte(marketingCampaigns.sendAt, now),
    ))
    .limit(50);

  let processed = 0;
  let sent = 0;
  let errors = 0;

  // Task #271 — Resolve each org's retry policy at most once per tick.
  const policyCache = new Map<string, OrgRetryPolicy>();
  async function getPolicy(orgId: string): Promise<OrgRetryPolicy> {
    const hit = policyCache.get(orgId);
    if (hit) return hit;
    const org = await storage.getOrg(orgId);
    const policy = resolveOrgRetryPolicy(org ?? null);
    policyCache.set(orgId, policy);
    return policy;
  }

  for (const campaign of due) {
    const recipients = await resolveCampaignRecipients(campaign);
    const policy = await getPolicy(campaign.orgId);

    let mailboxMissing = false;
    let dispatchedThisCampaign = 0;
    let pendingRetries = 0;

    for (const r of recipients) {
      if (!r.email) continue;
      const latest = await getLatestCampaignAttempt(
        campaign.orgId,
        campaign.id,
        r.id,
      );
      const decision = decideRecipientAction(latest, now, policy.maxAttempts);
      if (decision.action === "skip-done") continue;
      if (decision.action === "skip-pending") {
        pendingRetries++;
        continue;
      }

      const attemptNumber = decision.attemptNumber;
      let outcome: AttemptOutcome;
      try {
        const result = await sendViaConnectedMailbox({
          orgId: campaign.orgId,
          to: r.email,
          subject: campaign.subject || campaign.name,
          html: campaign.body,
          text: campaign.body,
          replyTo: campaign.replyTo || null,
        });
        outcome = classifySuccess(result);
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
        });
        sent++;
        dispatchedThisCampaign++;
      } catch (err) {
        if (err instanceof MissingMailboxError) {
          mailboxMissing = true;
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

    if (mailboxMissing) {
      console.warn(
        `[marketing-scheduled-send] campaign=${campaign.id} org=${campaign.orgId}: ` +
        `mailbox not connected — leaving campaign pending.`,
      );
      continue;
    }

    if (pendingRetries > 0) {
      console.log(
        `[marketing-scheduled-send] campaign=${campaign.id} ` +
        `dispatched=${dispatchedThisCampaign} pending_retries=${pendingRetries} — ` +
        `leaving campaign pending until retries are resolved.`,
      );
      continue;
    }

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

  return { processed, sent, errors };
}

export async function processScheduledSequenceEnrollments(
  now: Date = new Date(),
): Promise<{ processed: number; sent: number; completed: number; errors: number }> {
  // Sprint 2o.0: enrollments now reference marketing_prospects (HR4).
  // Joining marketing_prospects (not client_contacts) for the recipient
  // email + soft-delete check.
  const due = await db
    .select({
      enrollment: marketingSequenceEnrollments,
      sequence: marketingSequences,
      contactEmail: marketingProspects.email,
      contactDeletedAt: marketingProspects.deletedAt,
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
    .where(and(
      eq(marketingSequenceEnrollments.status, "active"),
      isNotNull(marketingSequenceEnrollments.nextSendAt),
      lte(marketingSequenceEnrollments.nextSendAt, now),
    ))
    .limit(200);

  let processed = 0;
  let sent = 0;
  let completed = 0;
  let errors = 0;

  // Task #271 — Per-org retry policy cache (one lookup per org per tick).
  const policyCache = new Map<string, OrgRetryPolicy>();
  async function getPolicy(orgId: string): Promise<OrgRetryPolicy> {
    const hit = policyCache.get(orgId);
    if (hit) return hit;
    const org = await storage.getOrg(orgId);
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

  for (const row of due) {
    const enr = row.enrollment;
    const seq = row.sequence;

    // Skip soft-deleted contacts: pause the enrollment so it doesn't
    // keep showing up on every tick.
    if (row.contactDeletedAt || !row.contactEmail) {
      await db
        .update(marketingSequenceEnrollments)
        .set({ status: "removed", nextSendAt: null, updatedAt: now })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
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
      // Defensive: align enrollment.nextSendAt with the persisted retry
      // schedule in case a manual edit advanced it earlier than the
      // backoff. Nothing else to do this tick.
      await db
        .update(marketingSequenceEnrollments)
        .set({ nextSendAt: decision.nextRetryAt, updatedAt: now })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
      continue;
    }

    let dispatched = false;
    let advance!: boolean;
    let outcome: AttemptOutcome | null = null;
    let attemptNumber!: number;

    if (decision.action === "send") {
      attemptNumber = decision.attemptNumber;
      try {
        const result = await sendViaConnectedMailbox({
          orgId: enr.orgId,
          to: row.contactEmail,
          subject: step.subject || seq.name,
          html: step.body,
          text: step.body,
          replyTo: seq.replyTo || null,
        });
        outcome = classifySuccess(result);
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
        });
        sent++;
        dispatched = true;
        advance = true;
      } catch (err) {
        if (err instanceof MissingMailboxError) {
          console.warn(
            `[marketing-scheduled-send] enrollment=${enr.id} org=${enr.orgId}: ` +
            `mailbox not connected — leaving enrollment pending.`,
          );
          continue;
        }
        outcome = classifyFailure(err, attemptNumber, now, policy.maxAttempts, policy.baseMs);
        errors++;
        console.error(
          `[marketing-scheduled-send] enrollment=${enr.id} step=${enr.currentStepIndex} ` +
          `attempt=${attemptNumber} ${outcome.status} (${outcome.errorCode}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
        // Permanent failures (max attempts hit, or non-transient code)
        // advance the step so we don't loop forever. Transient failures
        // re-schedule and stay on the same step.
        advance = outcome.status === "permanent_failure";
      }

      await db.insert(emailSendAttempts).values({
        orgId: enr.orgId,
        kind: "sequence",
        sequenceId: enr.sequenceId,
        enrollmentId: enr.id,
        stepIndex: enr.currentStepIndex,
        prospectId: enr.prospectId,
        recipientEmail: row.contactEmail,
        attemptNumber,
        status: outcome!.status,
        errorCode: outcome!.errorCode,
        errorMessage: outcome!.errorMessage,
        transport: outcome!.transport,
        providerMessageId: outcome!.providerMessageId,
        attemptedAt: now,
        nextRetryAt: outcome!.nextRetryAt,
      });

      // Task #269 / #304: when retries are exhausted (permanent_failure)
      // for a sequence step recipient, queue the event for the per-
      // sequence hourly digest instead of firing one email per failure.
      // Fire-and-forget; failures are swallowed by the helper so they
      // cannot break the worker's enrollment-advance bookkeeping below.
      if (outcome!.status === "permanent_failure") {
        void notifyAdminsOfSequenceStepPermanentFailure(seq, {
          stepIndex: enr.currentStepIndex,
          recipientEmail: row.contactEmail,
          errorCode: outcome!.errorCode,
          errorMessage: outcome!.errorMessage,
          attemptCount: attemptNumber,
        }).catch((e) =>
          console.error(
            `[marketing-scheduled-send] failure-notify sequence=${seq.id} step=${enr.currentStepIndex} failed:`,
            e,
          ),
        );
      }
    } else {
      // skip-done: latest attempt was a terminal state (success or
      // permanent_failure). Advance the enrollment past this step so we
      // don't get stuck retrying a recipient we've already given up on.
      advance = true;
    }

    if (!advance && outcome && outcome.status === "failed" && outcome.nextRetryAt) {
      await db
        .update(marketingSequenceEnrollments)
        .set({ nextSendAt: outcome.nextRetryAt, updatedAt: now })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
      processed++;
      continue;
    }

    const next = computeNextSendAt(steps, enr.currentStepIndex, now);
    if (next.done) {
      await db
        .update(marketingSequenceEnrollments)
        .set({
          currentStepIndex: enr.currentStepIndex + 1,
          status: "completed",
          nextSendAt: null,
          updatedAt: now,
        })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
      completed++;
    } else {
      await db
        .update(marketingSequenceEnrollments)
        .set({
          currentStepIndex: next.nextIndex,
          nextSendAt: next.nextSendAt,
          updatedAt: now,
        })
        .where(eq(marketingSequenceEnrollments.id, enr.id));
    }
    processed++;
    void dispatched;
  }

  return { processed, sent, completed, errors };
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
      const now = new Date();
      const c = await processScheduledCampaigns(now).catch((e) => {
        console.error("[marketing-scheduled-send] campaigns failed:", e);
        return { processed: 0, sent: 0, errors: 1 };
      });
      stats.campaignsProcessed = c.processed;
      stats.campaignEmailsSent = c.sent;
      stats.campaignErrors = c.errors;

      const e = await processScheduledSequenceEnrollments(now).catch((err) => {
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
}

// Re-export for convenience in tests / admin views.
export { sql };
