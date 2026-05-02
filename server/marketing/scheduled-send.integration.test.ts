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
  runScheduledSendTick,
} from "./scheduled-send";
import { MissingMailboxError } from "../email/types";
import { db, pool } from "../db";
import {
  orgs,
  brands,
  marketingProspects,
  contactActivities,
  marketingCampaigns,
  marketingSequences,
  marketingSequenceSteps,
  marketingSequenceEnrollments,
  expenseCategories,
  orgEntitlements,
  users,
} from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const BRAND_ID = randomUUID();

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
  await db.delete(brands).where(eq(brands.id, BRAND_ID));
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

    type Mail = { to: string; subject: string; text: string; html: string };
    const isOurs = (m: Mail) =>
      m.to === adminEmail && m.subject.includes(recipientEmail);
    await vi.waitFor(
      () => {
        const hit = sendMailMock.mock.calls.find((c) => isOurs(c[0] as Mail));
        if (!hit) throw new Error("step alert not yet sent");
      },
      { timeout: 5_000, interval: 50 },
    );

    const ours = sendMailMock.mock.calls.find((c) => isOurs(c[0] as Mail))!;
    const mail = ours[0] as Mail;
    // 1-indexed step label per buildSequenceStepAlertEmail.
    expect(mail.subject).toContain("Step 1");
    expect(mail.subject).toContain(recipientEmail);
    expect(mail.text).toContain("VALIDATION_ERROR");
    expect(mail.text).toContain(recipientEmail);
  });
});
