/**
 * The one place a marketing send attempt becomes terminal (`success` /
 * `permanent_failure`), together with what has to move with it.
 *
 * A sequence attempt and its enrollment's advance commit in one transaction,
 * for every transport: the connected mailbox (insert mode: the row is new),
 * an ACS operation resolved later (resolve mode: the pre-written `accepted`
 * row is moved with `UPDATE … WHERE status = 'accepted'`), and the repair of a
 * terminal row written by an older worker that never advanced (advance mode).
 *
 * Lock order everywhere: sequence, then enrollment, then prospect.
 *
 * Side effects (the `email_sent` activity for a resolved ACS operation, the
 * admin digest for a permanent sequence failure) run after commit and only for
 * the caller whose write was applied, so reconciling a resolved row twice does
 * nothing. Their errors are logged and swallowed: they never change the
 * attempt or cause a re-send.
 */
import { db } from "../db";
import {
  emailSendAttempts,
  marketingCampaigns,
  marketingProspects,
  marketingSequenceEnrollments,
  marketingSequences,
  marketingSequenceSteps,
  type EmailSendAttempt,
  type MarketingSequence,
  type MarketingSequenceStep,
} from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { storage } from "../storage";
import { notifyAdminsOfSequenceStepPermanentFailure } from "../notifications/marketing-failures";

const DAY_MS = 24 * 60 * 60 * 1000;

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

type TerminalStatus = "success" | "permanent_failure";

export interface TerminalWrite {
  status: TerminalStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

type AttemptValues = Omit<typeof emailSendAttempts.$inferInsert, "status" | "errorCode" | "errorMessage" | "nextRetryAt">;

export type FinalizeSequenceInput =
  | ({ mode: "resolve"; attemptId: string; resolvedAt: Date } & TerminalWrite)
  | ({ mode: "insert"; values: AttemptValues; resolvedAt: Date } & TerminalWrite)
  | { mode: "advance"; sequenceId: string; enrollmentId: string; stepIndex: number; resolvedAt: Date };

export interface FinalizeSequenceResult {
  /** False when the attempt was no longer `accepted` (resolve) or nothing moved (advance). */
  applied: boolean;
  attempt: EmailSendAttempt | null;
  /** What happened to the enrollment in the same commit. */
  enrollment: "advanced" | "completed" | "removed" | "unchanged";
}

/**
 * Lock the sequence, enrollment and prospect; write the terminal attempt; and,
 * if the enrollment is still on that step (any status), move it past the step
 * with `nextSendAt` from `computeNextSendAt`. Status changes only from
 * `active`: to `removed` when the prospect is no longer mailable, else to
 * `completed` after the last step. Nothing is ever reactivated.
 */
export async function finalizeSequenceAttempt(
  input: FinalizeSequenceInput,
): Promise<FinalizeSequenceResult> {
  // Resolve mode reads the row first only to learn which parents to lock; the
  // conditional update below is what decides whether this call applies.
  let sequenceId: string;
  let enrollmentId: string | null;
  if (input.mode === "resolve") {
    const [row] = await db
      .select({ sequenceId: emailSendAttempts.sequenceId, enrollmentId: emailSendAttempts.enrollmentId })
      .from(emailSendAttempts)
      .where(eq(emailSendAttempts.id, input.attemptId));
    if (!row?.sequenceId) return { applied: false, attempt: null, enrollment: "unchanged" };
    sequenceId = row.sequenceId;
    enrollmentId = row.enrollmentId;
  } else if (input.mode === "insert") {
    sequenceId = input.values.sequenceId!;
    enrollmentId = input.values.enrollmentId ?? null;
  } else {
    sequenceId = input.sequenceId;
    enrollmentId = input.enrollmentId;
  }

  let sequence: MarketingSequence | undefined;
  const result = await db.transaction(async (tx): Promise<FinalizeSequenceResult> => {
    [sequence] = await tx
      .select()
      .from(marketingSequences)
      .where(eq(marketingSequences.id, sequenceId))
      .for("update");
    const [enrollment] = enrollmentId
      ? await tx
          .select()
          .from(marketingSequenceEnrollments)
          .where(eq(marketingSequenceEnrollments.id, enrollmentId))
          .for("update")
      : [];

    let attempt: EmailSendAttempt | null = null;
    let stepIndex: number;
    if (input.mode === "resolve") {
      const [moved] = await tx
        .update(emailSendAttempts)
        .set({ status: input.status, errorCode: input.errorCode, errorMessage: input.errorMessage, nextRetryAt: null })
        .where(and(eq(emailSendAttempts.id, input.attemptId), eq(emailSendAttempts.status, "accepted")))
        .returning();
      if (!moved) return { applied: false, attempt: null, enrollment: "unchanged" };
      attempt = moved;
      stepIndex = moved.stepIndex ?? -1;
    } else if (input.mode === "insert") {
      const [inserted] = await tx
        .insert(emailSendAttempts)
        .values({
          ...input.values,
          status: input.status,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          nextRetryAt: null,
        })
        .returning();
      attempt = inserted;
      stepIndex = inserted.stepIndex ?? -1;
    } else {
      stepIndex = input.stepIndex;
    }

    if (!sequence || !enrollment || enrollment.currentStepIndex !== stepIndex) {
      return { applied: input.mode !== "advance", attempt, enrollment: "unchanged" };
    }

    const [prospect] = await tx
      .select({
        email: marketingProspects.email,
        deletedAt: marketingProspects.deletedAt,
        unsubscribedAt: marketingProspects.unsubscribedAt,
        bouncedAt: marketingProspects.bouncedAt,
      })
      .from(marketingProspects)
      .where(eq(marketingProspects.id, enrollment.prospectId))
      .for("share");
    const mailable = !!prospect && !!prospect.email &&
      !prospect.deletedAt && !prospect.unsubscribedAt && !prospect.bouncedAt;

    const steps = await tx
      .select({ delayDays: marketingSequenceSteps.delayDays })
      .from(marketingSequenceSteps)
      .where(eq(marketingSequenceSteps.sequenceId, sequenceId))
      .orderBy(asc(marketingSequenceSteps.stepOrder));
    const next = computeNextSendAt(steps, stepIndex, input.resolvedAt);

    let status = enrollment.status;
    let outcome: FinalizeSequenceResult["enrollment"] = "advanced";
    let nextSendAt = next.done ? null : next.nextSendAt;
    if (enrollment.status === "active" && !mailable) {
      status = "removed";
      nextSendAt = null;
      outcome = "removed";
    } else if (enrollment.status === "active" && next.done) {
      status = "completed";
      outcome = "completed";
    }
    await tx
      .update(marketingSequenceEnrollments)
      .set({ currentStepIndex: stepIndex + 1, nextSendAt, status, updatedAt: input.resolvedAt })
      .where(eq(marketingSequenceEnrollments.id, enrollment.id));
    return { applied: true, attempt, enrollment: outcome };
  });

  if (result.applied && result.attempt && sequence) {
    await sequenceSideEffects(sequence, result.attempt, input.mode === "resolve");
  }
  return result;
}

async function sequenceSideEffects(
  sequence: MarketingSequence,
  attempt: EmailSendAttempt,
  writeActivity: boolean,
): Promise<void> {
  const stepIndex = attempt.stepIndex ?? 0;
  if (attempt.status === "success" && writeActivity && attempt.prospectId) {
    // Connected sends write this inline, at the moment of delivery; an ACS
    // operation writes it here, once the provider confirmed it.
    const [step] = await db
      .select({ id: marketingSequenceSteps.id, subject: marketingSequenceSteps.subject })
      .from(marketingSequenceSteps)
      .where(eq(marketingSequenceSteps.sequenceId, sequence.id))
      .orderBy(asc(marketingSequenceSteps.stepOrder))
      .offset(stepIndex)
      .limit(1)
      .catch(() => [] as Array<{ id: string; subject: string }>);
    await storage.createActivity({
      orgId: sequence.orgId,
      brandId: sequence.brandId,
      prospectId: attempt.prospectId,
      type: "email_sent",
      payload: {
        sequence_id: sequence.id,
        sequence_name: sequence.name,
        step_id: step?.id ?? null,
        step_index: stepIndex,
        subject: step?.subject || sequence.name,
        transport: attempt.transport,
        provider_message_id: attempt.providerMessageId,
        attempt_number: attempt.attemptNumber,
      },
      actorId: null,
    }).catch((err) => console.error(
      `[marketing-scheduled-send] attempt=${attempt.id}: email_sent activity failed:`,
      err instanceof Error ? err.message : err,
    ));
  }
  if (attempt.status === "permanent_failure") {
    // Task #269 / #304: queued for the per-sequence hourly digest.
    void notifyAdminsOfSequenceStepPermanentFailure(sequence, {
      stepIndex,
      recipientEmail: attempt.recipientEmail ?? "",
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
      attemptCount: attempt.attemptNumber,
    }).catch((e) =>
      console.error(
        `[marketing-scheduled-send] failure-notify sequence=${sequence.id} step=${stepIndex} failed:`,
        e,
      ),
    );
  }
}

/**
 * Move a campaign's `accepted` ACS attempt to its terminal status. The
 * campaign itself is finalized (`sentAt`) by the campaign loop on its next
 * visit. On `success`, writes the `email_sent` activity after the update.
 * Returns false when the row was no longer `accepted`.
 */
// Campaigns whose ACS operation was resolved since the campaign worker last
// looked. The worker re-checks them even while the send cooldown hides their
// sender, so a campaign with nothing left to send is marked sent (and its
// failure digest goes out) without waiting for the cooldown to end. Per
// process; after a restart that check waits for the cooldown instead.
const resolvedCampaignIds = new Set<string>();

export function takeResolvedCampaignIds(): string[] {
  const ids = [...resolvedCampaignIds];
  resolvedCampaignIds.clear();
  return ids;
}

export async function finalizeCampaignAttempt(
  attemptId: string,
  write: TerminalWrite,
): Promise<boolean> {
  const [moved] = await db
    .update(emailSendAttempts)
    .set({ status: write.status, errorCode: write.errorCode, errorMessage: write.errorMessage, nextRetryAt: null })
    .where(and(eq(emailSendAttempts.id, attemptId), eq(emailSendAttempts.status, "accepted")))
    .returning();
  if (!moved) return false;
  if (moved.campaignId) resolvedCampaignIds.add(moved.campaignId);
  if (moved.status === "success" && moved.campaignId && moved.prospectId) {
    try {
      const [campaign] = await db
        .select()
        .from(marketingCampaigns)
        .where(eq(marketingCampaigns.id, moved.campaignId));
      if (campaign) {
        await storage.createActivity({
          orgId: campaign.orgId,
          brandId: campaign.brandId,
          prospectId: moved.prospectId,
          type: "email_sent",
          payload: {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            subject: campaign.subject || campaign.name,
            transport: moved.transport,
            provider_message_id: moved.providerMessageId,
            attempt_number: moved.attemptNumber,
          },
          actorId: null,
        });
      }
    } catch (err) {
      console.error(
        `[marketing-scheduled-send] attempt=${attemptId}: email_sent activity failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return true;
}
