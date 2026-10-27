/**
 * ACS marketing transport (PLAN r13 §2–§6, §11): the DB-backed send loop and
 * reconciler against a stubbed ACS endpoint.
 *
 *   - 202 + inline Succeeded ⇒ success; the campaign completes next visit.
 *   - An ambiguous POST stays `accepted`, is never POSTed again, and the
 *     reconciler's Succeeded resolves it: exactly one POST per message.
 *   - The reconciler's outcome table (pending, failed, recipient, quota,
 *     24 h unresolved).
 *   - A sequence enrollment is parked while its operation is pending and
 *     advanced when it resolves.
 *   - writeAcsIntent refuses when the step changed under it.
 *   - Cooldown fairness: an ACS item writes nothing and calls nothing, while
 *     a connected-mailbox item in the same tick still sends.
 *
 * Own org whose slug is the only one in ACS_EMAIL_ORG_SLUGS, so other suites'
 * rows (sharing the test DB) always route to the mocked connected mailbox.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { acquireSendLoopSuiteLock } from "../../tests/helpers/send-loop-lock";
import { and, eq, inArray } from "drizzle-orm";
import type { AccessToken } from "@azure/identity";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("../email/send-via-connected-mailbox", () => ({
  sendViaConnectedMailbox: sendMock,
}));
// Degraded-transport and failure digests go to admins by SMTP: capture, don't send.
vi.mock("../email/smtp-transport", () => ({
  createEnvTransporter: vi.fn(async () => ({ sendMail: vi.fn(async () => ({ messageId: "x" })) })),
}));

import {
  loadAcsTickContext,
  processScheduledCampaigns,
  processScheduledSequenceEnrollments,
  resetCampaignCursorForTests,
} from "./scheduled-send";
import { reconcileAcsOperations, resetAcsSendStateForTests, writeAcsIntent } from "./acs-send";
import {
  acsCooldownActive,
  extendAcsCooldown,
  refreshAcsTokenIfNeeded,
  resetAcsStateForTests,
  setAcsCredentialForTests,
} from "../email/acs-transport";
import { db } from "../db";
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
} from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const ORG_SLUG = `acs-it-${RUN}`;
const BRAND_ID = randomUUID();
const SENDER = "hello@news.acs-it.test";
const ENDPOINT = "https://acs-it.unitedstates.communication.azure.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RETRY = { maxAttempts: 3, backoffMs: 10 * 60_000 };

const contactIds: string[] = [];
const campaignIds: string[] = [];
const sequenceIds: string[] = [];

// ── ACS stub ─────────────────────────────────────────────────────────────────

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
let postReply: Reply = { status: 202 };
/** Operation-Id → reply for its GET; missing ⇒ Running. */
const getReplies = new Map<string, Reply>();
const posts: Array<{ operationId: string; body: any }> = [];
const gets: string[] = [];
const realFetch = globalThis.fetch;

function reply(r: Reply): Response {
  return new Response(r.body == null ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: r.headers ?? {},
  });
}

async function acsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (!url.startsWith(ENDPOINT)) return realFetch(input, init);
  const path = new URL(url).pathname;
  if (init?.method === "POST" && path === "/emails:send") {
    const operationId = (init.headers as Record<string, string>)["Operation-Id"];
    posts.push({ operationId, body: JSON.parse(String(init.body)) });
    return reply(postReply);
  }
  const m = path.match(/^\/emails\/operations\/(.+)$/);
  if (init?.method === "GET" && m) {
    const id = decodeURIComponent(m[1]);
    gets.push(id);
    return reply(getReplies.get(id) ?? { status: 200, body: { id, status: "Running" } });
  }
  return reply({ status: 500 });
}

const succeeded = (id: string): Reply => ({ status: 200, body: { id, status: "Succeeded" } });
const failed = (id: string, code: string): Reply => ({
  status: 200,
  body: { id, status: "Failed", error: { code, message: "x" } },
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function makeContact(email = `acs-${randomUUID()}@example.com`): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingProspects).values({
    id, orgId: ORG_ID, brandId: BRAND_ID, firstName: "Acs", lastName: "Test", email,
  });
  contactIds.push(id);
  return id;
}

/** A due campaign to exactly one new contact (the brand's other contacts are opted out per test). */
async function makeCampaign(opts: { fromEmail?: string; sendAt?: Date | null } = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingCampaigns).values({
    id,
    orgId: ORG_ID,
    brandId: BRAND_ID,
    name: `acs-it ${RUN}`,
    subject: "Hello",
    body: "<p>Hi</p>",
    fromEmail: opts.fromEmail ?? "",
    sendAt: opts.sendAt === undefined ? new Date(Date.now() - 60_000) : opts.sendAt,
  });
  campaignIds.push(id);
  return id;
}

async function makeSequence(delays: number[]): Promise<{ id: string; stepIds: string[] }> {
  const id = randomUUID();
  await db.insert(marketingSequences).values({ id, orgId: ORG_ID, brandId: BRAND_ID, name: `acs-it seq ${RUN}` });
  sequenceIds.push(id);
  const stepIds: string[] = [];
  for (const [i, delayDays] of delays.entries()) {
    const sid = randomUUID();
    await db.insert(marketingSequenceSteps).values({
      id: sid, orgId: ORG_ID, sequenceId: id, stepOrder: i, delayDays, subject: `S${i}`, body: `<p>${i}</p>`,
    });
    stepIds.push(sid);
  }
  return { id, stepIds };
}

async function makeEnrollment(sequenceId: string, prospectId: string, nextSendAt = new Date(Date.now() - 60_000)) {
  const id = randomUUID();
  await db.insert(marketingSequenceEnrollments).values({
    id, orgId: ORG_ID, sequenceId, prospectId, currentStepIndex: 0, nextSendAt, status: "active",
  });
  return id;
}

/** Leave only `keep` mailable in the brand, so a campaign's audience is exactly it. */
async function onlyMailable(keep: string[]): Promise<void> {
  const others = contactIds.filter((id) => !keep.includes(id));
  if (others.length) {
    await db.update(marketingProspects).set({ deletedAt: new Date() }).where(inArray(marketingProspects.id, others));
  }
}

async function attemptsFor(where: { campaignId?: string; enrollmentId?: string }) {
  return db
    .select()
    .from(emailSendAttempts)
    .where(where.campaignId
      ? eq(emailSendAttempts.campaignId, where.campaignId)
      : eq(emailSendAttempts.enrollmentId, where.enrollmentId!));
}

async function makeDue(attemptId: string, attemptedAt?: Date): Promise<void> {
  await db
    .update(emailSendAttempts)
    .set({ nextRetryAt: new Date(Date.now() - 1000), ...(attemptedAt ? { attemptedAt } : {}) })
    .where(eq(emailSendAttempts.id, attemptId));
}

async function reconcile() {
  return reconcileAcsOperations(ENDPOINT, Date.now() + 60_000, async () => RETRY);
}

async function tickCampaigns() {
  return processScheduledCampaigns(new Date(), await loadAcsTickContext());
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let releaseSuiteLock: (() => Promise<void>) | null = null;

beforeAll(async () => {
  releaseSuiteLock = await acquireSendLoopSuiteLock();
  process.env.ACS_EMAIL_ENDPOINT = ENDPOINT;
  process.env.ACS_EMAIL_ORG_SLUGS = ORG_SLUG;
  process.env.ACS_EMAIL_SENDERS = SENDER;
  await db.insert(orgs).values({ id: ORG_ID, name: `acs-it ${RUN}`, slug: ORG_SLUG });
  await db.insert(brands).values({
    id: BRAND_ID, orgId: ORG_ID, name: `acs-it ${RUN}`, slug: `acs-it-brand-${RUN}`, fromEmail: SENDER,
  });
}, 180_000);

afterAll(async () => {
  try {
    delete process.env.ACS_EMAIL_ENDPOINT;
    delete process.env.ACS_EMAIL_ORG_SLUGS;
    delete process.env.ACS_EMAIL_SENDERS;
    await db.delete(emailSendAttempts).where(eq(emailSendAttempts.orgId, ORG_ID));
    if (sequenceIds.length) {
      await db.delete(marketingSequenceEnrollments).where(inArray(marketingSequenceEnrollments.sequenceId, sequenceIds));
      await db.delete(marketingSequenceSteps).where(inArray(marketingSequenceSteps.sequenceId, sequenceIds));
      await db.delete(marketingSequences).where(inArray(marketingSequences.id, sequenceIds));
    }
    if (campaignIds.length) await db.delete(marketingCampaigns).where(inArray(marketingCampaigns.id, campaignIds));
    if (contactIds.length) {
      await db.delete(contactActivities).where(inArray(contactActivities.prospectId, contactIds));
      await db.delete(marketingProspects).where(inArray(marketingProspects.id, contactIds));
    }
    await db.delete(emailTrackingLinks).where(eq(emailTrackingLinks.orgId, ORG_ID));
    await db.delete(brands).where(eq(brands.id, BRAND_ID));
    await db.delete(expenseCategories).where(eq(expenseCategories.orgId, ORG_ID));
    await db.delete(orgEntitlements).where(eq(orgEntitlements.orgId, ORG_ID));
    await db.delete(orgs).where(eq(orgs.id, ORG_ID));
  } finally {
    await releaseSuiteLock?.();
  }
}, 180_000);

beforeEach(async () => {
  resetAcsStateForTests();
  resetAcsSendStateForTests();
  resetCampaignCursorForTests();
  const token: AccessToken = { token: "tok-it", expiresOnTimestamp: Date.now() + HOUR_MS };
  setAcsCredentialForTests({ getToken: async () => token });
  await refreshAcsTokenIfNeeded({ force: true });
  (global as any).__emailTestSleep = async () => {};
  vi.stubGlobal("fetch", vi.fn(acsFetch));
  postReply = { status: 202 };
  getReplies.clear();
  posts.length = 0;
  gets.length = 0;
  sendMock.mockReset();
  sendMock.mockImplementation(async (args: { to: string }) => ({
    ok: true,
    provider: "smtp",
    transport: "noop",
    senderAddress: "noop@example.com",
    providerMessageId: `mock-${args.to}`,
    sentAt: new Date().toISOString(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (global as any).__emailTestSleep;
  setAcsCredentialForTests(null);
  resetAcsStateForTests();
});

// ── Campaigns ────────────────────────────────────────────────────────────────

describe("campaign send through ACS", () => {
  it("202 + inline Succeeded ⇒ success, one POST, campaign completes on its next visit", async () => {
    const contact = await makeContact();
    await onlyMailable([contact]);
    const campaignId = await makeCampaign();
    // The inline GET finds it already done.
    getReplies.set("*", succeeded("*"));
    const origGet = getReplies.get.bind(getReplies);
    getReplies.get = (id: string) => origGet(id) ?? succeeded(id);

    await tickCampaigns();
    const ours = posts.filter((p) => p.body.senderAddress === SENDER);
    expect(ours).toHaveLength(1);
    expect(ours[0].body.userEngagementTrackingDisabled).toBe(true);
    const [a] = await attemptsFor({ campaignId });
    expect(a).toMatchObject({ status: "success", transport: "acs", providerMessageId: ours[0].operationId });
    expect(gets).toContain(ours[0].operationId);
    expect(sendMock.mock.calls.filter((c) => c[0].orgId === ORG_ID)).toHaveLength(0);

    await tickCampaigns();
    const [camp] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
    expect(camp.sentAt).not.toBeNull();
    expect(posts.filter((p) => p.body.senderAddress === SENDER)).toHaveLength(1);

    const acts = await db.select().from(contactActivities).where(eq(contactActivities.prospectId, contact));
    expect(acts.map((x) => x.type)).toEqual(["email_sent"]);
    getReplies.get = origGet;
  });

  it("an ambiguous POST is never POSTed again; the reconciler resolves it (exactly one POST)", async () => {
    const contact = await makeContact();
    await onlyMailable([contact]);
    const campaignId = await makeCampaign();
    postReply = { status: 500 };

    await tickCampaigns();
    let [a] = await attemptsFor({ campaignId });
    expect(a).toMatchObject({ status: "accepted", errorCode: "ACS_POST_AMBIGUOUS" });
    expect(a.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());

    // Later ticks skip it: still one POST, one row, campaign still open.
    postReply = { status: 202 };
    await tickCampaigns();
    await makeDue(a.id);
    await tickCampaigns();
    expect(posts.filter((p) => p.operationId === a.id)).toHaveLength(1);
    expect(posts.filter((p) => p.body.senderAddress === SENDER)).toHaveLength(1);
    expect(await attemptsFor({ campaignId })).toHaveLength(1);
    let [camp] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
    expect(camp.sentAt).toBeNull();

    getReplies.set(a.id, succeeded(a.id));
    await reconcile();
    [a] = await attemptsFor({ campaignId });
    expect(a.status).toBe("success");

    await tickCampaigns();
    [camp] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
    expect(camp.sentAt).not.toBeNull();
    expect(posts.filter((p) => p.body.senderAddress === SENDER)).toHaveLength(1);
  });

  it("POST 429 ⇒ deferred + cooldown; the campaign waits and makes no further POST", async () => {
    const contact = await makeContact();
    await onlyMailable([contact]);
    const campaignId = await makeCampaign();
    postReply = { status: 429, headers: { "retry-after": "120" } };

    await tickCampaigns();
    const [a] = await attemptsFor({ campaignId });
    expect(a).toMatchObject({ status: "deferred", errorCode: "ACS_THROTTLED" });
    expect(acsCooldownActive()).toBe(true);

    await tickCampaigns();
    expect(posts.filter((p) => p.body.senderAddress === SENDER)).toHaveLength(1);
    expect(await attemptsFor({ campaignId })).toHaveLength(1);
  });

  it("POST 400 ⇒ permanent_failure with the sanitized provider code", async () => {
    const contact = await makeContact();
    await onlyMailable([contact]);
    const campaignId = await makeCampaign();
    postReply = { status: 400, body: { error: { code: "Invalid<Sender>", message: "x" } } };

    await tickCampaigns();
    const [a] = await attemptsFor({ campaignId });
    expect(a).toMatchObject({ status: "permanent_failure", errorCode: "ACS_REJECTED" });
    expect(a.errorMessage).toContain("InvalidSender");
  });
});

// ── Reconciler table ─────────────────────────────────────────────────────────

describe("reconciler outcomes", () => {
  /** An `accepted` row as dispatchAcs leaves it after an ambiguous POST. */
  async function pending(attemptedAt = new Date()): Promise<string> {
    const contact = await makeContact();
    const campaignId = await makeCampaign({ sendAt: null });
    const id = randomUUID();
    await db.insert(emailSendAttempts).values({
      id,
      orgId: ORG_ID,
      kind: "campaign",
      campaignId,
      prospectId: contact,
      recipientEmail: "r@example.com",
      status: "accepted",
      errorCode: "ACS_POST_AMBIGUOUS",
      transport: "acs",
      providerMessageId: id,
      attemptedAt,
      nextRetryAt: new Date(Date.now() - 1000),
    });
    return id;
  }
  const row = async (id: string) =>
    (await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.id, id)))[0];

  it("Running ⇒ stays accepted, pollCount 1, next poll a minute out", async () => {
    const id = await pending();
    await reconcile();
    const r = await row(id);
    expect(r).toMatchObject({ status: "accepted", pollCount: 1 });
    expect(r.nextRetryAt!.getTime()).toBeGreaterThanOrEqual(Date.now() + 55_000);
  });

  it("404 (not known yet) ⇒ stays accepted and is polled again later", async () => {
    const id = await pending();
    getReplies.set(id, { status: 404 });
    await reconcile();
    expect(await row(id)).toMatchObject({ status: "accepted", pollCount: 1 });
  });

  it("Failed with an unknown code ⇒ failed, retried after the policy backoff", async () => {
    const id = await pending();
    getReplies.set(id, failed(id, "ServiceUnavailable"));
    await reconcile();
    const r = await row(id);
    expect(r).toMatchObject({ status: "failed", errorCode: "ACS_ServiceUnavailable" });
    expect(r.nextRetryAt!.getTime()).toBeGreaterThanOrEqual(Date.now() + RETRY.backoffMs - 5000);
  });

  it("Failed with a recipient code ⇒ permanent_failure", async () => {
    const id = await pending();
    getReplies.set(id, failed(id, "RecipientMailboxFull"));
    await reconcile();
    expect(await row(id)).toMatchObject({ status: "permanent_failure", errorCode: "ACS_RecipientMailboxFull" });
  });

  it("Failed with a quota code ⇒ deferred, and the send cooldown starts", async () => {
    const id = await pending();
    getReplies.set(id, failed(id, "QuotaExceeded"));
    await reconcile();
    expect(await row(id)).toMatchObject({ status: "deferred", errorCode: "ACS_THROTTLED" });
    expect(acsCooldownActive()).toBe(true);
  });

  it("older than 24 h ⇒ permanent_failure ACS_OPERATION_UNRESOLVED without a GET", async () => {
    const id = await pending(new Date(Date.now() - 25 * HOUR_MS));
    await reconcile();
    expect(await row(id)).toMatchObject({ status: "permanent_failure", errorCode: "ACS_OPERATION_UNRESOLVED" });
    expect(gets).not.toContain(id);
  });

  it("a GET 429 stops the pass and closes the poll gate", async () => {
    const first = await pending();
    const second = await pending();
    getReplies.set(first, { status: 429, headers: { "retry-after": "30" } });
    getReplies.set(second, { status: 429, headers: { "retry-after": "30" } });
    const stats = await reconcile();
    expect(stats.polled).toBe(1);
    const polled = gets.filter((g) => g === first || g === second);
    expect(polled).toHaveLength(1);
    // Both still accepted; the next pass makes no GET while the gate is shut.
    expect((await row(first)).status).toBe("accepted");
    expect((await row(second)).status).toBe("accepted");
    gets.length = 0;
    await reconcile();
    expect(gets).toHaveLength(0);
  });
});

// ── Sequences ────────────────────────────────────────────────────────────────

describe("sequence send through ACS", () => {
  it("parks the enrollment while pending; advances it when the reconciler resolves", async () => {
    const contact = await makeContact();
    const seq = await makeSequence([0, 3]);
    const enr = await makeEnrollment(seq.id, contact);
    postReply = { status: 503 };

    await processScheduledSequenceEnrollments(new Date(), await loadAcsTickContext());
    let [a] = await attemptsFor({ enrollmentId: enr });
    expect(a).toMatchObject({ status: "accepted", stepIndex: 0, errorCode: "ACS_POST_AMBIGUOUS" });
    let [e] = await db.select().from(marketingSequenceEnrollments).where(eq(marketingSequenceEnrollments.id, enr));
    expect(e.currentStepIndex).toBe(0);
    expect(e.nextSendAt!.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR_MS);

    // Not due, so another tick sends nothing.
    await processScheduledSequenceEnrollments(new Date(), await loadAcsTickContext());
    expect(posts.filter((p) => p.operationId === a.id)).toHaveLength(1);
    expect(await attemptsFor({ enrollmentId: enr })).toHaveLength(1);

    await makeDue(a.id);
    getReplies.set(a.id, succeeded(a.id));
    await reconcile();
    [a] = await attemptsFor({ enrollmentId: enr });
    expect(a.status).toBe("success");
    [e] = await db.select().from(marketingSequenceEnrollments).where(eq(marketingSequenceEnrollments.id, enr));
    expect(e.currentStepIndex).toBe(1);
    expect(e.status).toBe("active");
    expect(e.nextSendAt!.getTime()).toBeGreaterThan(Date.now() + 3 * DAY_MS - 60_000);
    expect(e.nextSendAt!.getTime()).toBeLessThan(Date.now() + 3 * DAY_MS + 60_000);
  });

  it("writeAcsIntent refuses when the step changed under it (nothing written)", async () => {
    const contact = await makeContact();
    const seq = await makeSequence([0]);
    const enr = await makeEnrollment(seq.id, contact);
    const base = {
      kind: "sequence" as const,
      orgId: ORG_ID,
      prospectId: contact,
      recipientEmail: "x@example.com",
      attemptNumber: 1,
      sequenceId: seq.id,
      enrollmentId: enr,
      stepIndex: 0,
    };
    expect(await writeAcsIntent({
      ...base, attemptId: randomUUID(), step: { id: seq.stepIds[0], subject: "S0", body: "<p>edited</p>" },
    })).toBe(false);
    expect(await writeAcsIntent({
      ...base, attemptId: randomUUID(), step: { id: randomUUID(), subject: "S0", body: "<p>0</p>" },
    })).toBe(false);
    expect(await attemptsFor({ enrollmentId: enr })).toHaveLength(0);
    const [e] = await db.select().from(marketingSequenceEnrollments).where(eq(marketingSequenceEnrollments.id, enr));
    expect(e.nextSendAt!.getTime()).toBeLessThan(Date.now());

    // The unchanged step goes through and parks the enrollment.
    expect(await writeAcsIntent({
      ...base, attemptId: randomUUID(), step: { id: seq.stepIds[0], subject: "S0", body: "<p>0</p>" },
    })).toBe(true);
    expect(await attemptsFor({ enrollmentId: enr })).toHaveLength(1);
  });
});

// ── Cooldown fairness ────────────────────────────────────────────────────────

describe("ACS cooldown", () => {
  it("ACS items write nothing and call nothing; a connected-mailbox item still sends", async () => {
    const contact = await makeContact();
    await onlyMailable([contact]);
    const acsCampaign = await makeCampaign();
    // Same org, a sender outside the ACS allowlist ⇒ the connected mailbox.
    const connectedCampaign = await makeCampaign({ fromEmail: "dean@acs-it.test" });
    const seq = await makeSequence([0]);
    const seqContact = await makeContact();
    const enr = await makeEnrollment(seq.id, seqContact);
    extendAcsCooldown(Date.now() + 10 * 60_000);

    await tickCampaigns();
    await processScheduledSequenceEnrollments(new Date(), await loadAcsTickContext());

    expect(posts).toHaveLength(0);
    expect(await attemptsFor({ campaignId: acsCampaign })).toHaveLength(0);
    expect(await attemptsFor({ enrollmentId: enr })).toHaveLength(0);
    const ours = sendMock.mock.calls.map((c) => c[0]).filter((a) => a.orgId === ORG_ID);
    // The connected campaign mails both live contacts; nothing ACS-bound leaks to the mailbox.
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.every((a) => a.fromEmail === "dean@acs-it.test")).toBe(true);
    const [conn] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, connectedCampaign));
    expect(conn.sentAt).not.toBeNull();
    const [acs] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, acsCampaign));
    expect(acs.sentAt).toBeNull();
    const [e] = await db.select().from(marketingSequenceEnrollments).where(eq(marketingSequenceEnrollments.id, enr));
    expect(e.currentStepIndex).toBe(0);
  });
});
