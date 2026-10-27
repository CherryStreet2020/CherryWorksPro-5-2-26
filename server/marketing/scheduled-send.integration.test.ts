/**
 * Task #236 — End-to-end coverage for the scheduled-send worker.
 *
 * The pure helper `computeNextSendAt` already has unit coverage in
 * `scheduled-send.test.ts`. This sibling integration test exercises the
 * actual DB-backed loops:
 *   - processScheduledCampaigns: dispatches a due campaign exactly once,
 *     records `email_sent` activities, stamps `sent_at`, and leaves the
 *     campaign untouched when the org has no connected mailbox.
 *   - processScheduledSequenceEnrollments: advances `current_step_index`
 *     and `next_send_at` after a step send, marks the enrollment
 *     `completed` once the final step dispatches, removes enrollments
 *     for soft-deleted contacts, and leaves the row alone when the org's
 *     mailbox is missing.
 *
 * Mirrors the env-handling and isolated-org pattern from
 * tests/integration/marketing-os-telemetry-cleanup.test.ts.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.MARKETING_EMAIL_TRACKING_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("../email/send-via-connected-mailbox", () => ({
  sendViaConnectedMailbox: sendMock,
}));

// Task #305 — Capture admin failure-notification emails so the
// integration test can assert that the worker's wire-up to
// `notifyAdminsOf*` actually invokes the SMTP transport with the
// expected digest content.
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "x" })));
const createEnvTransporterMock = vi.hoisted(() =>
  vi.fn(async () => ({ sendMail: sendMailMock })),
);
vi.mock("../email/smtp-transport", () => ({
  createEnvTransporter: createEnvTransporterMock,
}));

import {
  processScheduledCampaigns,
  processScheduledSequenceEnrollments,
  resolveCampaignRecipients,
  runScheduledSendTick,
} from "./scheduled-send";
import { storage } from "../storage";
import { MissingMailboxError } from "../email/types";
import { db, pool } from "../db";
import { flushSequenceFailureDigest } from "../notifications/marketing-failures";
import { recordOpen } from "./tracking-record";
import {
  orgs,
  brands,
  marketingProspects,
  contactActivities,
  marketingCampaigns,
  marketingSequences,
  marketingSequenceSteps,
  marketingSequenceEnrollments,
  emailSendAttempts,
  emailTrackingLinks,
  expenseCategories,
  orgEntitlements,
  users,
} from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const BRAND_ID = randomUUID();
// Own brand for the tracking block, so its recipients stay out of the
// counts the other blocks assert on.
const TRACK_BRAND_ID = randomUUID();

const DAY_MS = 24 * 60 * 60 * 1000;

const createdContactIds: string[] = [];
const createdCampaignIds: string[] = [];
const createdSequenceIds: string[] = [];
const createdEnrollmentIds: string[] = [];
const createdStepIds: string[] = [];
const createdUserIds: string[] = [];

function okSendResult(idSuffix = "") {
  return {
    ok: true as const,
    provider: "smtp" as const,
    transport: "noop" as const,
    senderAddress: "noop@example.com",
    providerMessageId: `mock-${idSuffix}-${Math.random().toString(36).slice(2, 8)}`,
    sentAt: new Date().toISOString(),
  };
}

async function makeContact(opts: {
  email: string | null;
  deletedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingProspects).values({
    id,
    orgId: ORG_ID,
    brandId: BRAND_ID,
    firstName: "Test",
    lastName: "Contact",
    email: opts.email,
    deletedAt: opts.deletedAt ?? null,
  });
  createdContactIds.push(id);
  return id;
}

async function makeCampaign(opts: {
  sendAt: Date | null;
  sentAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingCampaigns).values({
    id,
    orgId: ORG_ID,
    brandId: BRAND_ID,
    name: `t236 Campaign ${RUN}`,
    subject: "Hello",
    body: "<p>Hi</p>",
    sendAt: opts.sendAt,
    sentAt: opts.sentAt ?? null,
  });
  createdCampaignIds.push(id);
  return id;
}

async function makeSequence(): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingSequences).values({
    id,
    orgId: ORG_ID,
    brandId: BRAND_ID,
    name: `t236 Seq ${RUN}`,
  });
  createdSequenceIds.push(id);
  return id;
}

async function makeStep(opts: {
  sequenceId: string;
  stepOrder: number;
  delayDays: number;
  subject?: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingSequenceSteps).values({
    id,
    orgId: ORG_ID,
    sequenceId: opts.sequenceId,
    stepOrder: opts.stepOrder,
    delayDays: opts.delayDays,
    subject: opts.subject ?? `Step ${opts.stepOrder}`,
    body: `<p>Step ${opts.stepOrder} body</p>`,
  });
  createdStepIds.push(id);
  return id;
}

async function makeEnrollment(opts: {
  sequenceId: string;
  contactId: string;
  currentStepIndex: number;
  nextSendAt: Date | null;
  status?: "active" | "paused" | "completed" | "removed";
}): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingSequenceEnrollments).values({
    id,
    orgId: ORG_ID,
    sequenceId: opts.sequenceId,
    // Sprint 2o.0 5b1c.1 (Blocker B): enrollments now require prospectId
    // (not-null in DB). The opts.contactId callsites carry prospect ids
    // since makeContact returns marketing_prospects rows.
    prospectId: opts.contactId,
    currentStepIndex: opts.currentStepIndex,
    nextSendAt: opts.nextSendAt,
    status: opts.status ?? "active",
  });
  createdEnrollmentIds.push(id);
  return id;
}

beforeAll(async () => {
  await db.insert(orgs).values({
    id: ORG_ID,
    name: `t236 ${RUN}`,
    slug: `t236-${RUN}`,
  });
  await db.insert(brands).values({
    id: BRAND_ID,
    orgId: ORG_ID,
    name: `t236 Brand ${RUN}`,
    slug: `t236-brand-${RUN}`,
  });
});

afterAll(async () => {
  if (createdEnrollmentIds.length) {
    await db
      .delete(marketingSequenceEnrollments)
      .where(inArray(marketingSequenceEnrollments.id, createdEnrollmentIds));
  }
  if (createdStepIds.length) {
    await db
      .delete(marketingSequenceSteps)
      .where(inArray(marketingSequenceSteps.id, createdStepIds));
  }
  if (createdSequenceIds.length) {
    await db
      .delete(marketingSequences)
      .where(inArray(marketingSequences.id, createdSequenceIds));
  }
  if (createdCampaignIds.length) {
    await db
      .delete(marketingCampaigns)
      .where(inArray(marketingCampaigns.id, createdCampaignIds));
  }
  if (createdContactIds.length) {
    await db
      .delete(contactActivities)
      .where(inArray(contactActivities.prospectId, createdContactIds));
    await db
      .delete(marketingProspects)
      .where(inArray(marketingProspects.id, createdContactIds));
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  // Tracking rows outlive their campaign and prospect, and block the org delete.
  await db.delete(emailTrackingLinks).where(eq(emailTrackingLinks.orgId, ORG_ID));
  await db.delete(brands).where(inArray(brands.id, [BRAND_ID, TRACK_BRAND_ID]));
  // Defensive: a parallel test suite or a server-side seeder may have
  // populated rows that reference our org while the test was in flight
  // (e.g. seedExpenseCategories / seedOrgEntitlements iterate every org
  // in the DB). Clear them so the FK delete below doesn't trip.
  await db.delete(expenseCategories).where(eq(expenseCategories.orgId, ORG_ID));
  await db.delete(orgEntitlements).where(eq(orgEntitlements.orgId, ORG_ID));
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));
});

beforeEach(() => {
  sendMock.mockReset();
  sendMailMock.mockClear();
  createEnvTransporterMock.mockClear();
  createEnvTransporterMock.mockImplementation(async () => ({
    sendMail: sendMailMock,
  }));
});

async function makeAdmin(email: string): Promise<string> {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    orgId: ORG_ID,
    email,
    password: "x",
    name: "Admin",
    firstName: "Admin",
    lastName: "User",
    role: "ADMIN",
    isActive: true,
  });
  createdUserIds.push(id);
  return id;
}

describe("processScheduledCampaigns — integration", () => {
  it("dispatches a due campaign once, records activities, and stamps sent_at", async () => {
    sendMock.mockImplementation(async () => okSendResult("camp"));

    const c1 = await makeContact({ email: "a@example.com" });
    const c2 = await makeContact({ email: "b@example.com" });
    // Soft-deleted contact and one with no email — both must be skipped.
    await makeContact({ email: "deleted@example.com", deletedAt: new Date() });
    await makeContact({ email: null });

    const past = new Date(Date.now() - 60_000);
    const campaignId = await makeCampaign({ sendAt: past });

    const now = new Date();
    const result = await processScheduledCampaigns(now);

    // We share the test DB with parallel suites, so other orgs may also
    // contribute to processed/sent/errors. Pin assertions to our org.
    expect(result.sent).toBeGreaterThanOrEqual(2);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const [campRow] = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId));
    expect(campRow.sentAt).not.toBeNull();
    expect(campRow.sentAt!.getTime()).toBe(now.getTime());

    const sentCalls = sendMock.mock.calls
      .map((c) => c[0])
      .filter((arg) => arg.orgId === ORG_ID);
    const sentTo = sentCalls.map((c) => c.to).sort();
    expect(sentTo).toEqual(["a@example.com", "b@example.com"]);

    const acts = await db
      .select()
      .from(contactActivities)
      .where(and(
        eq(contactActivities.orgId, ORG_ID),
        inArray(contactActivities.prospectId, [c1, c2]),
      ));
    expect(acts).toHaveLength(2);
    for (const a of acts) {
      expect(a.type).toBe("email_sent");
      const payload = a.payload as Record<string, unknown>;
      expect(payload.campaign_id).toBe(campaignId);
      expect(payload.transport).toBe("noop");
    }

    // Second tick must not re-dispatch.
    sendMock.mockClear();
    await processScheduledCampaigns(new Date());
    const reDispatchedToOurOrg = sendMock.mock.calls
      .map((c) => c[0])
      .filter((arg) => arg.orgId === ORG_ID);
    expect(reDispatchedToOurOrg).toHaveLength(0);
  });

  it("leaves the campaign pending when the org's mailbox is missing", async () => {
    sendMock.mockImplementation(async () => {
      throw new MissingMailboxError("m365", ORG_ID);
    });

    await makeContact({ email: "x@example.com" });
    const past = new Date(Date.now() - 60_000);
    const campaignId = await makeCampaign({ sendAt: past });

    const before = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId));
    expect(before[0].sentAt).toBeNull();

    await processScheduledCampaigns(new Date());

    const after = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId));
    expect(after[0].sentAt).toBeNull();

    const acts = await db
      .select()
      .from(contactActivities)
      .where(and(
        eq(contactActivities.orgId, ORG_ID),
        eq(contactActivities.type, "email_sent"),
      ));
    // No new email_sent activity for this campaign.
    const forCampaign = acts.filter(
      (a) => (a.payload as Record<string, unknown>).campaign_id === campaignId,
    );
    expect(forCampaign).toHaveLength(0);
  });
});

describe("processScheduledCampaigns — long-running sends", () => {
  it("skips a contact who unsubscribes while the campaign is going out", async () => {
    const a = await makeContact({ email: "first@example.com" });
    const b = await makeContact({ email: "second@example.com" });
    let firstTo: string | null = null;
    sendMock.mockImplementation(async (arg: { orgId: string; to: string }) => {
      // Earlier tests' contacts share the brand; react only to this test's pair.
      const mine = arg.to === "first@example.com" || arg.to === "second@example.com";
      if (arg.orgId === ORG_ID && mine && !firstTo) {
        firstTo = arg.to;
        // The other contact unsubscribes from an earlier email mid-run.
        const other = arg.to === "first@example.com" ? b : a;
        await db
          .update(marketingProspects)
          .set({ unsubscribedAt: new Date() })
          .where(eq(marketingProspects.id, other));
      }
      return okSendResult("unsub");
    });
    const campaignId = await makeCampaign({ sendAt: new Date(Date.now() - 60_000) });

    await processScheduledCampaigns(new Date());

    const sentTo = sendMock.mock.calls
      .map((c) => c[0])
      .filter((arg) => arg.orgId === ORG_ID && ["first@example.com", "second@example.com"].includes(arg.to))
      .map((arg) => arg.to);
    // An earlier test's pending campaign targets the same brand, so firstTo
    // may appear more than once; the unsubscribed contact must not appear.
    expect(firstTo).not.toBeNull();
    expect(new Set(sentTo)).toEqual(new Set([firstTo]));
    const [campRow] = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId));
    expect(campRow.sentAt).not.toBeNull();
  });

  it("paces consecutive Microsoft 365 sends", async () => {
    await makeContact({ email: "pace1@example.com" });
    await makeContact({ email: "pace2@example.com" });
    sendMock.mockImplementation(async () => ({ ...okSendResult("graph"), transport: "graph" as const }));
    const sleeps: number[] = [];
    (global as any).__emailTestSleep = async (ms: number) => { sleeps.push(ms); };
    try {
      await makeCampaign({ sendAt: new Date(Date.now() - 60_000) });
      await processScheduledCampaigns(new Date());
    } finally {
      delete (global as any).__emailTestSleep;
    }
    const ours = sendMock.mock.calls
      .map((c) => c[0])
      .filter((arg) => arg.orgId === ORG_ID && arg.to.startsWith("pace"));
    expect(ours).toHaveLength(2);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps.every((ms) => ms === 2_100)).toBe(true);
  });
});

describe("resolveCampaignRecipients — segments", () => {
  it("walks every page of a large segment, not just the first 50", async () => {
    const all = Array.from({ length: 1_203 }, (_, i) => ({
      id: `p${i}`,
      email: `s${i}@example.com`,
      unsubscribeToken: `t${i}`,
      unsubscribedAt: null,
      bouncedAt: null,
    }));
    const segSpy = vi.spyOn(storage, "getSegment").mockResolvedValue({
      id: "seg",
      orgId: ORG_ID,
      brandId: BRAND_ID,
      filter: { tagIds: [], search: "" },
    } as any);
    const pageSpy = vi.spyOn(storage, "resolveSegmentProspects").mockImplementation(
      async (_o, _b, _f, page = {}) =>
        all.slice(page.offset ?? 0, (page.offset ?? 0) + (page.limit ?? 50)) as any,
    );
    try {
      const recipients = await resolveCampaignRecipients({
        orgId: ORG_ID,
        brandId: BRAND_ID,
        audienceType: "segment",
        audienceSegmentId: "seg",
      });
      expect(recipients).toHaveLength(1_203);
      expect(pageSpy).toHaveBeenCalledTimes(3);
    } finally {
      segSpy.mockRestore();
      pageSpy.mockRestore();
    }
  });
});

describe("processScheduledSequenceEnrollments — integration", () => {
  it("advances the step index and schedules the next send by delayDays", async () => {
    sendMock.mockImplementation(async () => okSendResult("seq"));

    const seqId = await makeSequence();
    await makeStep({ sequenceId: seqId, stepOrder: 0, delayDays: 0 });
    await makeStep({ sequenceId: seqId, stepOrder: 1, delayDays: 5 });

    const contactId = await makeContact({ email: "step@example.com" });
    const past = new Date(Date.now() - 60_000);
    const enrId = await makeEnrollment({
      sequenceId: seqId,
      contactId,
      currentStepIndex: 0,
      nextSendAt: past,
    });

    const now = new Date();
    await processScheduledSequenceEnrollments(now);

    const [row] = await db
      .select()
      .from(marketingSequenceEnrollments)
      .where(eq(marketingSequenceEnrollments.id, enrId));
    expect(row.status).toBe("active");
    expect(row.currentStepIndex).toBe(1);
    expect(row.nextSendAt).not.toBeNull();
    expect(row.nextSendAt!.getTime()).toBe(now.getTime() + 5 * DAY_MS);

    const ourSends = sendMock.mock.calls
      .map((c) => c[0])
      .filter((arg) => arg.to === "step@example.com");
    expect(ourSends).toHaveLength(1);

    const acts = await db
      .select()
      .from(contactActivities)
      .where(and(
        eq(contactActivities.orgId, ORG_ID),
        eq(contactActivities.prospectId, contactId),
      ));
    expect(acts).toHaveLength(1);
    const payload = acts[0].payload as Record<string, unknown>;
    expect(payload.sequence_id).toBe(seqId);
    expect(payload.step_index).toBe(0);
  });

  it("marks the enrollment completed when the final step dispatches", async () => {
    sendMock.mockImplementation(async () => okSendResult("seq-final"));

    const seqId = await makeSequence();
    await makeStep({ sequenceId: seqId, stepOrder: 0, delayDays: 0 });
    await makeStep({ sequenceId: seqId, stepOrder: 1, delayDays: 0 });

    const contactId = await makeContact({ email: "final@example.com" });
    const enrId = await makeEnrollment({
      sequenceId: seqId,
      contactId,
      currentStepIndex: 1,
      nextSendAt: new Date(Date.now() - 60_000),
    });

    await processScheduledSequenceEnrollments(new Date());

    const [row] = await db
      .select()
      .from(marketingSequenceEnrollments)
      .where(eq(marketingSequenceEnrollments.id, enrId));
    expect(row.status).toBe("completed");
    expect(row.nextSendAt).toBeNull();
    expect(row.currentStepIndex).toBe(2);
  });

  it("removes enrollments for soft-deleted contacts without dispatching", async () => {
    sendMock.mockImplementation(async () => okSendResult("seq-deleted"));

    const seqId = await makeSequence();
    await makeStep({ sequenceId: seqId, stepOrder: 0, delayDays: 0 });

    const contactId = await makeContact({
      email: "gone@example.com",
      deletedAt: new Date(),
    });
    const enrId = await makeEnrollment({
      sequenceId: seqId,
      contactId,
      currentStepIndex: 0,
      nextSendAt: new Date(Date.now() - 60_000),
    });

    await processScheduledSequenceEnrollments(new Date());

    const [row] = await db
      .select()
      .from(marketingSequenceEnrollments)
      .where(eq(marketingSequenceEnrollments.id, enrId));
    expect(row.status).toBe("removed");
    expect(row.nextSendAt).toBeNull();

    const ourSends = sendMock.mock.calls
      .map((c) => c[0])
      .filter((arg) => arg.to === "gone@example.com");
    expect(ourSends).toHaveLength(0);
  });

  it("advances past a step that throws a non-transient error so it can't loop forever (Task #259)", async () => {
    sendMock.mockImplementation(async () => {
      // VALIDATION_ERROR is classified as non-transient by `redactErrorCode`,
      // so the very first attempt becomes a permanent failure and the
      // worker must advance the enrollment instead of retrying forever.
      throw new Error("invalid email address");
    });

    const seqId = await makeSequence();
    await makeStep({ sequenceId: seqId, stepOrder: 0, delayDays: 0 });
    await makeStep({ sequenceId: seqId, stepOrder: 1, delayDays: 4 });

    const contactId = await makeContact({ email: "broken@example.com" });
    const enrId = await makeEnrollment({
      sequenceId: seqId,
      contactId,
      currentStepIndex: 0,
      nextSendAt: new Date(Date.now() - 60_000),
    });

    const now = new Date();
    const result = await processScheduledSequenceEnrollments(now);

    // Other parallel suites may contribute to the counter — pin to >=1.
    expect(result.errors).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(marketingSequenceEnrollments)
      .where(eq(marketingSequenceEnrollments.id, enrId));
    expect(row.status).toBe("active");
    expect(row.currentStepIndex).toBe(1);
    expect(row.nextSendAt).not.toBeNull();
    expect(row.nextSendAt!.getTime()).toBe(now.getTime() + 4 * DAY_MS);

    // No `email_sent` activity should have been recorded for the failed
    // dispatch — only successful sends create activities.
    const acts = await db
      .select()
      .from(contactActivities)
      .where(eq(contactActivities.prospectId, contactId));
    expect(acts).toHaveLength(0);
  });

  it("completes the enrollment when the failing step was the final one (Task #259)", async () => {
    sendMock.mockImplementation(async () => {
      throw new Error("invalid email address");
    });

    const seqId = await makeSequence();
    await makeStep({ sequenceId: seqId, stepOrder: 0, delayDays: 0 });

    const contactId = await makeContact({ email: "broken-final@example.com" });
    const enrId = await makeEnrollment({
      sequenceId: seqId,
      contactId,
      currentStepIndex: 0,
      nextSendAt: new Date(Date.now() - 60_000),
    });

    const result = await processScheduledSequenceEnrollments(new Date());
    expect(result.errors).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(marketingSequenceEnrollments)
      .where(eq(marketingSequenceEnrollments.id, enrId));
    expect(row.status).toBe("completed");
    expect(row.nextSendAt).toBeNull();
    expect(row.currentStepIndex).toBe(1);
  });

  it("leaves the enrollment untouched when the org's mailbox is missing", async () => {
    sendMock.mockImplementation(async () => {
      throw new MissingMailboxError("m365", ORG_ID);
    });

    const seqId = await makeSequence();
    await makeStep({ sequenceId: seqId, stepOrder: 0, delayDays: 0 });
    await makeStep({ sequenceId: seqId, stepOrder: 1, delayDays: 3 });

    const contactId = await makeContact({ email: "noinbox@example.com" });
    const dueAt = new Date(Date.now() - 60_000);
    const enrId = await makeEnrollment({
      sequenceId: seqId,
      contactId,
      currentStepIndex: 0,
      nextSendAt: dueAt,
    });

    await processScheduledSequenceEnrollments(new Date());

    const [row] = await db
      .select()
      .from(marketingSequenceEnrollments)
      .where(eq(marketingSequenceEnrollments.id, enrId));
    expect(row.status).toBe("active");
    expect(row.currentStepIndex).toBe(0);
    expect(row.nextSendAt).not.toBeNull();
    expect(row.nextSendAt!.getTime()).toBe(dueAt.getTime());

    const acts = await db
      .select()
      .from(contactActivities)
      .where(eq(contactActivities.prospectId, contactId));
    expect(acts).toHaveLength(0);
  });
});

/**
 * Task #258 — Two parallel `runScheduledSendTick()` callers must not both
 * dispatch the same campaign. The pg advisory lock guarantees only one
 * tick does the work; the other returns null without sending anything.
 *
 * Task #288 — The worker now acquires the advisory lock on a dedicated
 * client checked out from the pool and releases it on the same client
 * before returning, so unlock is guaranteed to land on the lock-holding
 * session. The cross-session lock-leak workaround that previous revs
 * needed in afterAll is no longer required.
 */
describe("runScheduledSendTick — advisory lock", () => {
  it("only one of two parallel ticks acquires the lock and dispatches the campaign", async () => {
    // Slow each send so the first tick is still in flight when the
    // second calls pg_try_advisory_lock — otherwise the first might
    // finish (and unlock) before the second checks, masking the lock.
    sendMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return okSendResult("parallel");
    });

    const c1 = await makeContact({ email: "p1@example.com" });
    const c2 = await makeContact({ email: "p2@example.com" });
    const campaignId = await makeCampaign({
      sendAt: new Date(Date.now() - 60_000),
    });

    const [a, b] = await Promise.all([
      runScheduledSendTick(),
      runScheduledSendTick(),
    ]);

    const results = [a, b];
    const acquired = results.filter((r) => r !== null);
    const denied = results.filter((r) => r === null);
    expect(acquired).toHaveLength(1);
    expect(denied).toHaveLength(1);
    // The acquiring tick must report having actually done work — the
    // null-returning tick alone could otherwise mask a regression where
    // both ticks return early without dispatching anything.
    expect(acquired[0]!.campaignEmailsSent).toBeGreaterThanOrEqual(2);

    // Campaign was dispatched exactly once: sent_at stamped, exactly one
    // email_sent activity per recipient for this campaign id. (We scope
    // by campaign_id because earlier tests in this file leave other
    // pending campaigns in the same org that the winning tick will also
    // sweep — those don't count toward our double-send check.)
    const [campRow] = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId));
    expect(campRow.sentAt).not.toBeNull();

    const acts = await db
      .select()
      .from(contactActivities)
      .where(and(
        eq(contactActivities.orgId, ORG_ID),
        inArray(contactActivities.prospectId, [c1, c2]),
        eq(contactActivities.type, "email_sent"),
      ));
    const forCampaign = acts.filter(
      (a) => (a.payload as Record<string, unknown>).campaign_id === campaignId,
    );
    expect(forCampaign).toHaveLength(2);
    const recipientsHit = forCampaign.map((a) => a.prospectId).sort();
    expect(recipientsHit).toEqual([c1, c2].sort());
  });

  /**
   * Task #288 regression — Before the fix, the lock was acquired with
   * `pool.query()` (which returns a connection to the pool immediately
   * after the query completes) and released with another `pool.query()`,
   * meaning the unlock often landed on a *different* pg session and was
   * silently a no-op. The lock then leaked on the original session
   * until it idled out, blocking every other tick across the fleet.
   *
   * After the fix the worker checks out a dedicated client for the
   * lifetime of the tick. This regression test asserts that once the
   * tick returns, no pg session in the pool still holds the advisory
   * key — i.e. a fresh tick can immediately acquire it again.
   */
  it("releases the advisory lock on the same session, so no pool connection leaks the lock", async () => {
    sendMock.mockImplementation(async () => okSendResult("noleak"));

    // Run a real tick so the lock is acquired and (must be) released.
    const result = await runScheduledSendTick();
    expect(result).not.toBeNull();

    // Nobody anywhere should still be holding the advisory key.
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1",
      [100007],
    );
    expect(rows[0].n).toBe(0);

    // And a fresh tick can immediately re-acquire and run (would
    // return null with the leak bug if a stale pooled session still
    // held the key).
    const second = await runScheduledSendTick();
    expect(second).not.toBeNull();

    const { rows: rows2 } = await pool.query(
      "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1",
      [100007],
    );
    expect(rows2[0].n).toBe(0);
  });
});

/**
 * Task #305 — End-to-end coverage for the failure-notification wiring.
 *
 * The pure helpers in `server/notifications/marketing-failures.ts` have
 * unit coverage, but no test asserts that the scheduled-send worker
 * actually invokes them when a real campaign / sequence step ends in a
 * permanent failure. This block seeds an opted-in admin in the test
 * org, forces a non-transient send error, runs the worker, and waits
 * for the SMTP transporter mock to receive the digest email.
 */
describe("admin failure notifications — integration (Task #305)", () => {
  // Earlier tests in this file populate the shared org+brand with many
  // contacts, so a campaign here would fan out to all of them. Use a
  // dedicated brand for the notification tests so the recipient set is
  // isolated to a single (failing) contact.
  const NOTIFY_BRAND_ID = randomUUID();
  const notifyContactIds: string[] = [];
  const notifyCampaignIds: string[] = [];

  beforeAll(async () => {
    await db.insert(brands).values({
      id: NOTIFY_BRAND_ID,
      orgId: ORG_ID,
      name: `t305 Brand ${RUN}`,
      slug: `t305-brand-${RUN}`,
    });
  });

  afterAll(async () => {
    if (notifyCampaignIds.length) {
      await db
        .delete(marketingCampaigns)
        .where(inArray(marketingCampaigns.id, notifyCampaignIds));
    }
    if (notifyContactIds.length) {
      await db
        .delete(contactActivities)
        .where(inArray(contactActivities.prospectId, notifyContactIds));
      await db
        .delete(marketingProspects)
        .where(inArray(marketingProspects.id, notifyContactIds));
    }
    await db.delete(brands).where(eq(brands.id, NOTIFY_BRAND_ID));
  });

  async function makeNotifyContact(email: string): Promise<string> {
    const id = randomUUID();
    await db.insert(marketingProspects).values({
      id,
      orgId: ORG_ID,
      brandId: NOTIFY_BRAND_ID,
      firstName: "Test",
      lastName: "Contact",
      email,
    });
    notifyContactIds.push(id);
    return id;
  }

  async function makeNotifyCampaign(): Promise<string> {
    const id = randomUUID();
    await db.insert(marketingCampaigns).values({
      id,
      orgId: ORG_ID,
      brandId: NOTIFY_BRAND_ID,
      name: `t305 Campaign ${RUN}-${id.slice(0, 4)}`,
      subject: "Hello",
      body: "<p>Hi</p>",
      sendAt: new Date(Date.now() - 60_000),
    });
    notifyCampaignIds.push(id);
    return id;
  }

  it("emails opted-in admins when a campaign finalizes with a permanent failure", async () => {
    const adminEmail = `admin-camp-${RUN}@example.com`;
    await makeAdmin(adminEmail);

    // VALIDATION_ERROR is non-transient → permanent_failure on first
    // attempt, so the campaign finalizes (sentAt stamped) and the
    // notify hook fires.
    sendMock.mockImplementation(async () => {
      throw new Error("invalid email address");
    });

    const recipientEmail = `bad-${RUN}@example.com`;
    await makeNotifyContact(recipientEmail);
    const campaignId = await makeNotifyCampaign();

    await processScheduledCampaigns(new Date());

    // Campaign was stamped sent_at — required precondition for the
    // notify call to fire.
    const [campRow] = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.id, campaignId));
    expect(campRow.sentAt).not.toBeNull();

    // The notification is fire-and-forget (`void notify...`), so wait
    // for the transporter to receive the digest. Earlier tests in this
    // file may have left other campaigns in the same org which the
    // worker also finalizes on this tick (also triggering notify), so
    // match on this campaign's unique recipient address rather than
    // the global call count.
    type Mail = { to: string; subject: string; text: string; html: string };
    const isOurs = (m: Mail) =>
      m.to === adminEmail && m.text.includes(recipientEmail);
    await vi.waitFor(
      () => {
        const hit = sendMailMock.mock.calls.find((c) => isOurs(c[0] as Mail));
        if (!hit) throw new Error("admin digest not yet sent");
      },
      { timeout: 5_000, interval: 50 },
    );

    const ours = sendMailMock.mock.calls.find((c) => isOurs(c[0] as Mail))!;
    const mail = ours[0] as Mail;
    expect(mail.subject).toContain(`t305 Campaign ${RUN}`);
    expect(mail.subject).toContain("1 recipient did not receive");
    expect(mail.text).toContain(recipientEmail);
    expect(mail.text).toContain("VALIDATION_ERROR");
  });

  it("emails opted-in admins when a sequence step exhausts retries", async () => {
    const adminEmail = `admin-seq-${RUN}@example.com`;
    await makeAdmin(adminEmail);

    sendMock.mockImplementation(async () => {
      throw new Error("invalid email address");
    });

    const seqId = await makeSequence();
    await makeStep({
      sequenceId: seqId,
      stepOrder: 0,
      delayDays: 0,
      subject: `t305 Step Subject ${RUN}`,
    });

    const recipientEmail = `seq-bad-${RUN}@example.com`;
    const contactId = await makeContact({ email: recipientEmail });
    await makeEnrollment({
      sequenceId: seqId,
      contactId,
      currentStepIndex: 0,
      nextSendAt: new Date(Date.now() - 60_000),
    });

    await processScheduledSequenceEnrollments(new Date());

    // Task #269 / #304: a step failure is queued into the per-sequence digest
    // (flushed on an interval), not emailed one-per-failure. The notify call is
    // fire-and-forget, so wait until the failure is queued, then flush it.
    await vi.waitFor(
      async () => {
        const r = await flushSequenceFailureDigest(seqId);
        if (!r || !("failureCount" in r) || r.failureCount === 0) throw new Error("step failure not yet queued");
      },
      { timeout: 5_000, interval: 50 },
    );

    type Mail = { to: string; subject: string; text: string; html: string };
    const isOurs = (m: Mail) =>
      m.to === adminEmail && m.text.includes(recipientEmail);
    await vi.waitFor(
      () => {
        const hit = sendMailMock.mock.calls.find((c) => isOurs(c[0] as Mail));
        if (!hit) throw new Error("step digest not yet sent");
      },
      { timeout: 5_000, interval: 50 },
    );

    const ours = sendMailMock.mock.calls.find((c) => isOurs(c[0] as Mail))!;
    const mail = ours[0] as Mail;
    expect(mail.text).toContain("VALIDATION_ERROR");
    expect(mail.text).toContain(recipientEmail);
  });
});

describe("processScheduledCampaigns — open / click tracking", () => {
  beforeAll(async () => {
    await db.insert(brands).values({
      id: TRACK_BRAND_ID,
      orgId: ORG_ID,
      name: `t236 Track Brand ${RUN}`,
      slug: `t236-track-${RUN}`,
    });
  });

  async function trackContact(): Promise<string> {
    const id = randomUUID();
    await db.insert(marketingProspects).values({
      id,
      orgId: ORG_ID,
      brandId: TRACK_BRAND_ID,
      firstName: "Track",
      lastName: "Contact",
      email: `track-${id.slice(0, 8)}@example.com`,
    });
    createdContactIds.push(id);
    return id;
  }

  async function trackCampaign(body: string): Promise<string> {
    const id = randomUUID();
    await db.insert(marketingCampaigns).values({
      id,
      orgId: ORG_ID,
      brandId: TRACK_BRAND_ID,
      name: `t236 Track Campaign ${RUN}`,
      subject: "Hello",
      body,
      sendAt: new Date(Date.now() - 60_000),
    });
    createdCampaignIds.push(id);
    return id;
  }

  it("writes the link row before delivery, rewrites links, keeps unsubscribe raw, and counts an early pixel", async () => {
    const prospectId = await trackContact();
    const [prospect] = await db.select().from(marketingProspects).where(eq(marketingProspects.id, prospectId));
    const campaignId = await trackCampaign(
      `<html><body><p>Read <a href="https://example.com/post?a=1&amp;b=2">this</a></p></body></html>`,
    );

    let seen: { html: string; row: typeof emailTrackingLinks.$inferSelect | undefined } | null = null;
    sendMock.mockImplementation(async (input: { html: string; to: string }) => {
      if (input.to !== prospect.email) return okSendResult("track");
      const [row] = await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.campaignId, campaignId));
      seen = { html: input.html, row };
      // An image proxy fetching the pixel before the attempt row exists.
      expect(await recordOpen(row!.token)).toBe(true);
      return okSendResult("track");
    });

    await processScheduledCampaigns(new Date());

    expect(seen).not.toBeNull();
    const { html, row } = seen!;
    expect(row!.links).toEqual(["https://example.com/post?a=1&b=2"]);
    expect(row!.prospectId).toBe(prospectId);
    expect(html).toContain(`/api/public/email/c/${row!.token}/0"`);
    expect(html).toContain(`/api/public/email/o/${row!.token}.gif"`);
    expect(html).not.toContain("https://example.com/post");
    expect(html).toContain(`/unsubscribe/${prospect.unsubscribeToken}"`);

    const [attempt] = await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.campaignId, campaignId));
    expect(attempt.status).toBe("success");
    expect(attempt.id).toBe(row!.attemptId);

    const metrics = await storage.getCampaignSendMetrics(ORG_ID, campaignId);
    expect(metrics).toMatchObject({ sent: 1, opened: 1, clicked: 0, opens: 1, clicks: 0 });
  });

  it("with tracking off, sends the body as written, and links already delivered still redirect", async () => {
    // A tracked send while the flag is on: its link is out in someone's inbox.
    const deliveredId = await trackCampaign(`<p><a href="https://example.com/earlier">earlier</a></p>`);
    sendMock.mockImplementation(async () => okSendResult("track"));
    await processScheduledCampaigns(new Date());
    const [delivered] = await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.campaignId, deliveredId));
    expect(delivered.links).toEqual(["https://example.com/earlier"]);

    process.env.MARKETING_EMAIL_TRACKING_ENABLED = "false";
    try {
      const body = `<p><a href="https://example.com/plain">plain</a></p>`;
      const campaignId = await trackCampaign(body);
      const htmls: string[] = [];
      sendMock.mockImplementation(async (input: { html: string }) => {
        htmls.push(input.html);
        return okSendResult("track");
      });
      await processScheduledCampaigns(new Date());
      expect(htmls.length).toBeGreaterThan(0);
      for (const html of htmls) {
        expect(html.startsWith(body)).toBe(true);
        expect(html).not.toContain("/api/public/email/");
      }
      expect(await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.campaignId, campaignId))).toEqual([]);

      // The routes do not depend on the flag: the earlier link still resolves.
      const express = (await import("express")).default;
      const { registerMarketingTrackingRoutes } = await import("../routes/marketing/tracking");
      const app = express();
      registerMarketingTrackingRoutes(app);
      const server = app.listen(0);
      try {
        const port = (server.address() as { port: number }).port;
        const res = await fetch(`http://127.0.0.1:${port}/api/public/email/c/${delivered.token}/0`, { redirect: "manual" });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://example.com/earlier");
      } finally {
        server.close();
      }
    } finally {
      process.env.MARKETING_EMAIL_TRACKING_ENABLED = "true";
    }
  });

  it("does not count engagement on a send that ends up failed", async () => {
    const campaignId = await trackCampaign("<p>Hi</p>");
    sendMock.mockImplementation(async () => {
      const rows = await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.campaignId, campaignId));
      for (const r of rows) await recordOpen(r.token);
      throw Object.assign(new Error("ETIMEDOUT upstream"), { code: "ETIMEDOUT" });
    });

    await processScheduledCampaigns(new Date());

    const attempts = await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.campaignId, campaignId));
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((a) => a.status !== "success")).toBe(true);
    const metrics = await storage.getCampaignSendMetrics(ORG_ID, campaignId);
    expect(metrics).toMatchObject({ sent: 0, opened: 0, clicked: 0 });
  });

  it("keeps a delivered send `success` when the email_sent activity write fails", async () => {
    const campaignId = await trackCampaign("<p>Hi</p>");
    sendMock.mockImplementation(async () => okSendResult("track"));
    const real = storage.createActivity.bind(storage);
    const spy = vi.spyOn(storage, "createActivity").mockImplementation(async (data, opts) => {
      if (data.type === "email_sent" && data.orgId === ORG_ID) throw new Error("timeline down");
      return real(data, opts);
    });
    try {
      await processScheduledCampaigns(new Date());
    } finally {
      spy.mockRestore();
    }

    const rows = await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.campaignId, campaignId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "success")).toBe(true);
  });

  it("sends untracked when the body cannot be parsed or tracking throws", async () => {
    const tracking = await import("./tracking");
    // parse5 overflows its stack on this (50k chars, inside the body limit).
    const deep = "<template>".repeat(4999);
    const injectedMark = `inject-${randomUUID()}`;
    const injected = `<p data-mark="${injectedMark}"><a href="https://example.com/i">i</a></p>`;

    const deepId = await trackContact();
    const injectedId = await trackContact();
    const deepCampaign = await trackCampaign(deep);
    const injectedCampaign = await trackCampaign(injected);
    const emails = new Map(
      (await db.select().from(marketingProspects).where(inArray(marketingProspects.id, [deepId, injectedId])))
        .map((p) => [p.email, p]),
    );
    const delivered: { html: string; to: string }[] = [];
    sendMock.mockImplementation(async (input: { html: string; to: string }) => {
      if (emails.has(input.to)) delivered.push(input);
      return okSendResult("track");
    });
    const original = tracking.withTracking;
    const inject = vi.spyOn(tracking, "withTracking").mockImplementation((html, token) => {
      if (html === injected) throw new Error("injected tracking failure");
      return original(html, token);
    });
    try {
      await processScheduledCampaigns(new Date());
    } finally {
      inject.mockRestore();
    }

    for (const [campaignId, body] of [[deepCampaign, deep], [injectedCampaign, injected]] as const) {
      const mine = delivered.filter((d) => d.html.startsWith(body));
      expect(mine.length, campaignId).toBeGreaterThan(0);
      for (const d of mine) {
        expect(d.html).not.toContain("/api/public/email/");
        expect(d.html).toContain(`/unsubscribe/${emails.get(d.to)!.unsubscribeToken}"`);
      }
      expect(await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.campaignId, campaignId))).toEqual([]);
      const attempts = await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.campaignId, campaignId));
      expect(attempts.length).toBeGreaterThan(0);
      expect(attempts.every((a) => a.status === "success")).toBe(true);
    }
  });

  it("sends untracked, promptly, when the link row cannot be written in time, and keeps going", async () => {
    const ids = [await trackContact(), await trackContact()];
    const mark = `lock-${randomUUID()}`;
    const campaignId = await trackCampaign(`<p data-mark="${mark}"><a href="https://example.com/x">x</a></p>`);
    const emails = (await db.select().from(marketingProspects).where(inArray(marketingProspects.id, ids)))
      .map((p) => p.email);
    let sends = 0;
    const htmls: string[] = [];
    sendMock.mockImplementation(async (input: { html: string; to: string }) => {
      sends++;
      if (emails.includes(input.to) && input.html.includes(mark)) htmls.push(input.html);
      return okSendResult("track");
    });

    // Something else holds a lock this campaign's link-row inserts wait on. Only
    // this campaign: a table lock would also stall tracking-record's tests,
    // which run in parallel against the same table.
    const fn = `t236_wait_${RUN.replace(/\W/g, "")}`;
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.campaign_id = '${campaignId}' THEN PERFORM pg_advisory_xact_lock(hashtext('${campaignId}')); END IF;
      RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON email_tracking_links
      FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    const client = await pool.connect();
    const started = Date.now();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [campaignId]);
      await processScheduledCampaigns(new Date());
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [campaignId]);
      client.release();
      await pool.query(`DROP TRIGGER ${fn} ON email_tracking_links`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    // Earlier tests' campaigns and contacts go out in the same run. Each send of
    // this campaign waits at most the 1s lock timeout on its link row.
    expect(Date.now() - started).toBeLessThan(sends * 1_500 + 3_000);
    expect(htmls).toHaveLength(2);
    for (const html of htmls) {
      expect(html).toContain(`href="https://example.com/x"`);
      expect(html).not.toContain("/api/public/email/");
    }
    const attempts = await db.select().from(emailSendAttempts)
      .where(and(eq(emailSendAttempts.campaignId, campaignId), inArray(emailSendAttempts.prospectId, ids)));
    expect(attempts.map((x) => x.status)).toEqual(["success", "success"]);
    const links = await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.campaignId, campaignId));
    expect(links).toHaveLength(0);
  });

  it("sends untracked when the link-row insert is rejected", async () => {
    const id = await trackContact();
    const [contact] = await db.select().from(marketingProspects).where(eq(marketingProspects.id, id));
    const campaignId = await trackCampaign(`<p><a href="https://example.com/y">y</a></p>`);
    // The real insert fails, for this campaign only, as a DB error would.
    const fn = `t236_reject_${RUN.replace(/\W/g, "")}`;
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.campaign_id = '${campaignId}' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON email_tracking_links
      FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    let html: string | undefined;
    sendMock.mockImplementation(async (input: { html: string; to: string }) => {
      if (input.to === contact.email) html = input.html;
      return okSendResult("track");
    });
    try {
      await processScheduledCampaigns(new Date());
    } finally {
      await pool.query(`DROP TRIGGER ${fn} ON email_tracking_links`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    expect(html).toContain(`href="https://example.com/y"`);
    expect(html).not.toContain("/api/public/email/");
    const [attempt] = await db.select().from(emailSendAttempts)
      .where(and(eq(emailSendAttempts.campaignId, campaignId), eq(emailSendAttempts.prospectId, id)));
    expect(attempt.status).toBe("success");
  });

  it("drops the link row when the org has no connected mailbox", async () => {
    await trackContact();
    const campaignId = await trackCampaign("<p><a href=\"https://example.com/x\">x</a></p>");
    sendMock.mockImplementation(async () => {
      throw new MissingMailboxError("m365", ORG_ID);
    });

    await processScheduledCampaigns(new Date());

    const rows = await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.campaignId, campaignId));
    expect(rows).toHaveLength(0);
  });
});
