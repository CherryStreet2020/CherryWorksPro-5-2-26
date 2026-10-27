/**
 * The ACS half of the marketing send path (PLAN §2–§4): the intent row
 * written before the POST, what each POST outcome does to it, and the
 * reconciler that resolves `accepted` operations on later ticks.
 *
 * Invariant: a message whose fate is unknown is never POSTed again. Its
 * attempt row is `accepted` from before the POST until a GET (inline or in
 * the reconciler) or the 24 h guard ends it.
 *
 * Transport details live in `server/email/acs-transport.ts`; terminal writes
 * go through `send-finalize.ts`.
 */
import { db } from "../db";
import {
  emailSendAttempts,
  marketingCampaigns,
  marketingSequenceEnrollments,
  marketingSequences,
  marketingSequenceSteps,
  type EmailSendAttempt,
} from "@shared/schema";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { SendableMessage } from "../email/types";
import {
  ACS_SEND_INTERVAL_MS,
  ACS_UNRESOLVED_AFTER_MS,
  acquireAcsPollSlot,
  acsCooldownActive,
  acsGetOperation,
  acsPollBackoffMs,
  acsSend,
  extendAcsCooldown,
  type AcsOperationOutcome,
} from "../email/acs-transport";
import { dropTrackingLinks, dropTrackingLinksForAttempt } from "./tracking-record";
import { finalizeCampaignAttempt, finalizeSequenceAttempt, type TerminalWrite } from "./send-finalize";
import { notifyMarketingTransportDegraded } from "../notifications/marketing-failures";

const MIN_ACCEPTED_RETRY_MS = 60_000;
/** A pending enrollment is parked this long; resolution always overwrites it. */
const PARK_MS = ACS_UNRESOLVED_AFTER_MS;
const INLINE_WINDOW_MS = 10_000;
const INLINE_MAX_RETRY_AFTER_MS = 5_000;
const COOLDOWN_ALERT_AFTER_MS = 60 * 60 * 1000;
const THROTTLED_COOLDOWN_MS = 60_000;

function sleep(ms: number): Promise<void> {
  // Tests inject an instant sleep; production waits for real.
  const override = (global as any).__emailTestSleep as ((ms: number) => Promise<void>) | undefined;
  return override ? override(ms) : new Promise((r) => setTimeout(r, ms));
}

// ── Pacing + cooldown alert (per process, like the cooldown itself) ─────────

let lastAcsPostAt = 0;
let acsCooldownSince: number | null = null;

/** How long to wait before the next POST so ACS sends stay ≈28/min. */
export function acsSendWaitMs(now: number = Date.now()): number {
  return lastAcsPostAt ? Math.max(0, lastAcsPostAt + ACS_SEND_INTERVAL_MS - now) : 0;
}

function extendCooldownTracked(untilMs: number): void {
  if (!acsCooldownActive()) acsCooldownSince = Date.now();
  extendAcsCooldown(untilMs);
}

/**
 * Called at the start of each tick. Alerts each ACS org once the send
 * cooldown has been active without a break for over an hour.
 */
export function checkAcsCooldownAlert(acsOrgIds: string[], now: number = Date.now()): void {
  if (!acsCooldownActive(now)) {
    acsCooldownSince = null;
    return;
  }
  if (acsCooldownSince !== null && now - acsCooldownSince > COOLDOWN_ALERT_AFTER_MS) {
    for (const orgId of acsOrgIds) void notifyMarketingTransportDegraded(orgId, "ACS_THROTTLED");
  }
}

export function resetAcsSendStateForTests(): void {
  lastAcsPostAt = 0;
  acsCooldownSince = null;
}

// ── Intent ──────────────────────────────────────────────────────────────────

export type AcsIntent = {
  attemptId: string;
  orgId: string;
  prospectId: string;
  recipientEmail: string;
  attemptNumber: number;
} & (
  | { kind: "campaign"; campaignId: string }
  | {
      kind: "sequence";
      sequenceId: string;
      enrollmentId: string;
      stepIndex: number;
      /** The step the body was built from; compared under the lock. */
      step: { id: string; subject: string | null; body: string | null };
    }
);

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

/**
 * One transaction: lock the parent(s) FOR SHARE (and the enrollment FOR
 * UPDATE), re-check that the send is still wanted and, for a sequence, that
 * the step at `stepIndex` is still the one the body was built from; then
 * insert the `accepted` row and park the enrollment. False ⇒ nothing written.
 */
export async function writeAcsIntent(intent: AcsIntent): Promise<boolean> {
  return db.transaction(async (tx) => {
    const createdAt = new Date();
    if (intent.kind === "campaign") {
      const parent = rowsOf<{ id: string }>(await tx.execute(sql`
        SELECT id FROM ${marketingCampaigns}
        WHERE id = ${intent.campaignId} AND sent_at IS NULL
        FOR SHARE`));
      if (parent.length === 0) return false;
    } else {
      const seq = rowsOf<{ id: string }>(await tx.execute(sql`
        SELECT id FROM ${marketingSequences} WHERE id = ${intent.sequenceId} FOR SHARE`));
      if (seq.length === 0) return false;
      const enr = rowsOf<{ id: string }>(await tx.execute(sql`
        SELECT id FROM ${marketingSequenceEnrollments}
        WHERE id = ${intent.enrollmentId} AND status = 'active'
          AND current_step_index = ${intent.stepIndex}
        FOR UPDATE`));
      if (enr.length === 0) return false;
      const steps = await tx
        .select({
          id: marketingSequenceSteps.id,
          subject: marketingSequenceSteps.subject,
          body: marketingSequenceSteps.body,
        })
        .from(marketingSequenceSteps)
        .where(eq(marketingSequenceSteps.sequenceId, intent.sequenceId))
        .orderBy(asc(marketingSequenceSteps.stepOrder));
      const current = steps[intent.stepIndex];
      if (
        !current ||
        current.id !== intent.step.id ||
        (current.subject ?? null) !== (intent.step.subject ?? null) ||
        (current.body ?? null) !== (intent.step.body ?? null)
      ) {
        return false;
      }
    }
    await tx.insert(emailSendAttempts).values({
      id: intent.attemptId,
      orgId: intent.orgId,
      kind: intent.kind,
      campaignId: intent.kind === "campaign" ? intent.campaignId : null,
      sequenceId: intent.kind === "sequence" ? intent.sequenceId : null,
      enrollmentId: intent.kind === "sequence" ? intent.enrollmentId : null,
      stepIndex: intent.kind === "sequence" ? intent.stepIndex : null,
      prospectId: intent.prospectId,
      recipientEmail: intent.recipientEmail,
      attemptNumber: intent.attemptNumber,
      status: "accepted",
      errorCode: "ACS_SUBMITTING",
      errorMessage: null,
      transport: "acs",
      providerMessageId: intent.attemptId,
      attemptedAt: createdAt,
      nextRetryAt: new Date(createdAt.getTime() + MIN_ACCEPTED_RETRY_MS),
    });
    if (intent.kind === "sequence") {
      await tx
        .update(marketingSequenceEnrollments)
        .set({ nextSendAt: new Date(createdAt.getTime() + PARK_MS), updatedAt: createdAt })
        .where(eq(marketingSequenceEnrollments.id, intent.enrollmentId));
    }
    return true;
  });
}

// ── Outcomes ────────────────────────────────────────────────────────────────

export interface RetryPolicyForAttempt {
  maxAttempts: number;
  /** Backoff for a `failed` outcome of this attempt (by its attemptNumber). */
  backoffMs: number;
}

async function finalizeAttempt(attempt: EmailSendAttempt, write: TerminalWrite): Promise<boolean> {
  if (attempt.kind === "sequence") {
    const r = await finalizeSequenceAttempt({
      mode: "resolve",
      attemptId: attempt.id,
      resolvedAt: new Date(),
      ...write,
    });
    return r.applied;
  }
  return finalizeCampaignAttempt(attempt.id, write);
}

async function moveEnrollmentTo(attempt: EmailSendAttempt, nextSendAt: Date): Promise<void> {
  if (attempt.kind !== "sequence" || !attempt.enrollmentId || attempt.stepIndex == null) return;
  await db
    .update(marketingSequenceEnrollments)
    .set({ nextSendAt, updatedAt: new Date() })
    .where(and(
      eq(marketingSequenceEnrollments.id, attempt.enrollmentId),
      eq(marketingSequenceEnrollments.currentStepIndex, attempt.stepIndex),
    ));
}

/**
 * `accepted` → `deferred`: the provider did not take the message. Does not
 * consume an attempt; starts (or extends) the shared send cooldown and drops
 * the tracking links of the unsent body.
 */
async function deferAttempt(
  attempt: EmailSendAttempt,
  code: "ACS_AUTH" | "ACS_THROTTLED",
  retryAfterMs: number,
): Promise<boolean> {
  const nextRetryAt = new Date(Date.now() + retryAfterMs);
  const [moved] = await db
    .update(emailSendAttempts)
    .set({
      status: "deferred",
      errorCode: code,
      errorMessage: code === "ACS_AUTH" ? "ACS authorization unavailable" : "ACS throttled",
      nextRetryAt,
    })
    .where(and(eq(emailSendAttempts.id, attempt.id), eq(emailSendAttempts.status, "accepted")))
    .returning({ id: emailSendAttempts.id });
  if (!moved) return false;
  extendCooldownTracked(nextRetryAt.getTime());
  await dropTrackingLinksForAttempt(attempt.id);
  await moveEnrollmentTo(attempt, nextRetryAt);
  if (code === "ACS_AUTH") void notifyMarketingTransportDegraded(attempt.orgId, "ACS_AUTH");
  return true;
}

async function updateAccepted(
  attemptId: string,
  set: Partial<typeof emailSendAttempts.$inferInsert>,
): Promise<boolean> {
  const [moved] = await db
    .update(emailSendAttempts)
    .set(set)
    .where(and(eq(emailSendAttempts.id, attemptId), eq(emailSendAttempts.status, "accepted")))
    .returning({ id: emailSendAttempts.id });
  return !!moved;
}

/**
 * Apply one GET result to an `accepted` row (PLAN §4 table). Shared by the
 * inline poll and the reconciler. `stop` tells the reconciler to issue no
 * further GET this tick.
 */
export async function applyOperationOutcome(
  attempt: EmailSendAttempt,
  outcome: AcsOperationOutcome,
  retry: RetryPolicyForAttempt,
): Promise<{ stop: boolean }> {
  const now = Date.now();
  switch (outcome.kind) {
    case "succeeded":
      await finalizeAttempt(attempt, { status: "success", errorCode: null, errorMessage: null });
      return { stop: false };
    case "permanent":
      await finalizeAttempt(attempt, {
        status: "permanent_failure",
        errorCode: outcome.code,
        errorMessage: `ACS operation failed (${outcome.code})`,
      });
      return { stop: false };
    case "throttled":
      await deferAttempt(attempt, "ACS_THROTTLED", THROTTLED_COOLDOWN_MS);
      return { stop: false };
    case "failed": {
      if (attempt.attemptNumber >= retry.maxAttempts) {
        await finalizeAttempt(attempt, {
          status: "permanent_failure",
          errorCode: outcome.code,
          errorMessage: `ACS operation failed (${outcome.code})`,
        });
        return { stop: false };
      }
      const nextRetryAt = new Date(now + retry.backoffMs);
      const moved = await updateAccepted(attempt.id, {
        status: "failed",
        errorCode: outcome.code,
        errorMessage: `ACS operation failed (${outcome.code})`,
        nextRetryAt,
      });
      if (moved) await moveEnrollmentTo(attempt, nextRetryAt);
      return { stop: false };
    }
    case "pending":
    case "not_found":
    case "error": {
      const pollCount = attempt.pollCount + 1;
      const ra = outcome.kind === "pending" ? outcome.retryAfterMs ?? 0 : 0;
      await updateAccepted(attempt.id, {
        pollCount,
        nextRetryAt: new Date(now + Math.max(ra, acsPollBackoffMs(pollCount))),
      });
      return { stop: false };
    }
    case "poll_throttled":
      await updateAccepted(attempt.id, { nextRetryAt: new Date(now + outcome.retryAfterMs) });
      return { stop: true };
  }
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export type AcsDispatchResult =
  /** The parent or step changed under the lock: nothing written, nothing sent. */
  | { kind: "aborted" }
  /** Taken (or possibly taken); resolved inline or left for the reconciler. */
  | { kind: "accepted" }
  | { kind: "deferred"; code: "ACS_AUTH" | "ACS_THROTTLED" }
  | { kind: "rejected" };

/**
 * Intent row → POST → outcome. The caller has already checked the cooldown,
 * the suppression list and built the tracked body (whose links are saved
 * under `trackingToken`, if any).
 */
export async function dispatchAcs(args: {
  endpoint: string;
  intent: AcsIntent;
  senderAddress: string;
  message: SendableMessage;
  trackingToken: string | null;
  deadline: number;
  retry: RetryPolicyForAttempt;
}): Promise<AcsDispatchResult> {
  const { intent } = args;
  if (!(await writeAcsIntent(intent))) {
    if (args.trackingToken) await dropTrackingLinks(args.trackingToken);
    return { kind: "aborted" };
  }

  const start = Date.now();
  lastAcsPostAt = start;
  const outcome = await acsSend({
    endpoint: args.endpoint,
    operationId: intent.attemptId,
    senderAddress: args.senderAddress,
    message: args.message,
  });

  const [row] = await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.id, intent.attemptId));
  if (!row) return { kind: "accepted" };

  switch (outcome.kind) {
    case "deferred":
      await deferAttempt(row, outcome.code, outcome.retryAfterMs);
      return { kind: "deferred", code: outcome.code };
    case "rejected":
      await finalizeAttempt(row, {
        status: "permanent_failure",
        errorCode: outcome.code,
        errorMessage: outcome.providerCode ? `ACS rejected the message (${outcome.providerCode})` : "ACS rejected the message",
      });
      return { kind: "rejected" };
    case "ambiguous":
      // Keeps the intent's 60 s nextRetryAt: the reconciler polls it; never re-POSTed.
      await updateAccepted(row.id, { errorCode: "ACS_POST_AMBIGUOUS" });
      return { kind: "accepted" };
    case "accepted": {
      const ra = outcome.retryAfterMs;
      await updateAccepted(row.id, {
        errorCode: null,
        nextRetryAt: new Date(Date.now() + Math.max(ra, MIN_ACCEPTED_RETRY_MS)),
      });
      const windowEnd = Math.min(args.deadline, start + INLINE_WINDOW_MS);
      if (ra <= INLINE_MAX_RETRY_AFTER_MS && Date.now() + ra < windowEnd) {
        await sleep(ra);
        if (await acquireAcsPollSlot(windowEnd)) {
          const op = await acsGetOperation(args.endpoint, intent.attemptId);
          const [fresh] = await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.id, row.id));
          if (fresh?.status === "accepted") await applyOperationOutcome(fresh, op, args.retry);
        }
      }
      return { kind: "accepted" };
    }
  }
}

// ── Reconciler ──────────────────────────────────────────────────────────────

export interface ReconcileStats {
  polled: number;
  unresolved: number;
}

/**
 * Resolve due `accepted` rows (PLAN §4). Runs first in every tick while
 * `ACS_EMAIL_ENDPOINT` is set, whatever the routing allowlists say. Stops at
 * `deadline`, when the poll gate refuses a GET, or after a GET 429.
 */
export async function reconcileAcsOperations(
  endpoint: string,
  deadline: number,
  retryFor: (attempt: EmailSendAttempt) => Promise<RetryPolicyForAttempt>,
): Promise<ReconcileStats> {
  const stats: ReconcileStats = { polled: 0, unresolved: 0 };
  const due = await db
    .select()
    .from(emailSendAttempts)
    .where(and(eq(emailSendAttempts.status, "accepted"), lte(emailSendAttempts.nextRetryAt, new Date())))
    .orderBy(asc(emailSendAttempts.nextRetryAt))
    .limit(100);

  for (const row of due) {
    if (Date.now() >= deadline) break;
    if (Date.now() - row.attemptedAt.getTime() > ACS_UNRESOLVED_AFTER_MS) {
      // A missed mail beats a duplicate: never re-sent.
      const applied = await finalizeAttempt(row, {
        status: "permanent_failure",
        errorCode: "ACS_OPERATION_UNRESOLVED",
        errorMessage: "ACS did not confirm the send within 24 hours",
      });
      if (applied) {
        stats.unresolved++;
        void notifyMarketingTransportDegraded(row.orgId, "ACS_OPERATION_UNRESOLVED");
      }
      continue;
    }
    if (!(await acquireAcsPollSlot(deadline))) break;
    const op = await acsGetOperation(endpoint, row.providerMessageId ?? row.id);
    stats.polled++;
    const { stop } = await applyOperationOutcome(row, op, await retryFor(row));
    if (stop) break;
  }
  return stats;
}
