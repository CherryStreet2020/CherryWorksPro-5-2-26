/**
 * First-party open / click tracking — DB-backed coverage.
 *
 * Send-time coverage (link row before delivery, rewritten HTML) lives in
 * ./scheduled-send.integration.test.ts: the dispatcher is global, so two
 * files running it in parallel would deliver each other's campaigns.
 *
 *   - recording (recordOpen / recordClick): first open yields one activity
 *     under concurrency, click activities are capped, an activity failure
 *     rolls the counter back, suppressed recipients and failed sends never
 *     count, and an unsubscribe that commits first wins the race;
 *   - metrics: only delivered sends count.
 *
 * Same isolated-org pattern as ./scheduled-send.integration.test.ts.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";

import {
  findTrackedLinks,
  recordClick,
  recordOpen,
  MAX_CLICK_ACTIVITIES,
  MAX_IN_FLIGHT,
  DEADLINE_MS,
  TrackingUnavailableError,
} from "./tracking-record";
import { newTrackingToken } from "./tracking";
import { storage } from "../storage";
import { db, pool } from "../db";
import {
  orgs,
  brands,
  marketingProspects,
  contactActivities,
  marketingCampaigns,
  marketingSequences,
  emailSendAttempts,
  emailTrackingLinks,
  expenseCategories,
  orgEntitlements,
} from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const BRAND_ID = randomUUID();

const createdContactIds: string[] = [];
const createdCampaignIds: string[] = [];

async function makeContact(opts: Partial<typeof marketingProspects.$inferInsert> = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingProspects).values({
    id,
    orgId: ORG_ID,
    brandId: BRAND_ID,
    firstName: "Track",
    lastName: "Contact",
    email: `track-${id.slice(0, 8)}@example.com`,
    ...opts,
  });
  createdContactIds.push(id);
  return id;
}

async function makeCampaign(): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingCampaigns).values({
    id,
    orgId: ORG_ID,
    brandId: BRAND_ID,
    name: `track Campaign ${RUN}`,
    subject: "Hello",
    body: "<p>Hi</p>",
    sendAt: null,
  });
  createdCampaignIds.push(id);
  return id;
}

/** A delivered (or not) campaign email with its link row, built directly. */
async function makeSend(opts: {
  prospectId?: string;
  status?: "success" | "failed" | "permanent_failure" | null;
  attemptKind?: "campaign" | "sequence";
  links?: string[];
} = {}) {
  const prospectId = opts.prospectId ?? (await makeContact());
  const campaignId = await makeCampaign();
  const attemptId = randomUUID();
  const token = newTrackingToken();
  await db.insert(emailTrackingLinks).values({
    token,
    orgId: ORG_ID,
    campaignId,
    prospectId,
    attemptId,
    links: opts.links ?? ["https://example.com/a"],
  });
  if (opts.status !== null) {
    await db.insert(emailSendAttempts).values({
      id: attemptId,
      orgId: ORG_ID,
      kind: opts.attemptKind ?? "campaign",
      campaignId,
      prospectId,
      recipientEmail: "x@example.com",
      attemptNumber: 1,
      status: opts.status ?? "success",
    });
  }
  return { token, campaignId, prospectId, attemptId };
}

/** A sequence-step email: link row `kind='sequence'` (no campaign), attempt named by its sequence. */
async function makeSequenceSend(opts: {
  status?: "success" | "failed" | null;
  attemptKind?: "campaign" | "sequence";
  linkKind?: string;
} = {}) {
  const prospectId = await makeContact();
  const sequenceId = randomUUID();
  await db.insert(marketingSequences).values({ id: sequenceId, orgId: ORG_ID, brandId: BRAND_ID, name: `track Seq ${RUN}` });
  const attemptId = randomUUID();
  const token = newTrackingToken();
  await db.insert(emailTrackingLinks).values({
    token,
    orgId: ORG_ID,
    kind: opts.linkKind ?? "sequence",
    campaignId: null,
    prospectId,
    attemptId,
    links: ["https://example.com/s"],
  });
  if (opts.status !== null) {
    await db.insert(emailSendAttempts).values({
      id: attemptId,
      orgId: ORG_ID,
      kind: opts.attemptKind ?? "sequence",
      sequenceId,
      stepIndex: 2,
      prospectId,
      recipientEmail: "x@example.com",
      attemptNumber: 1,
      status: opts.status ?? "success",
    });
  }
  return { token, sequenceId, prospectId, attemptId };
}

async function linkRow(token: string) {
  const [row] = await db.select().from(emailTrackingLinks).where(eq(emailTrackingLinks.token, token));
  return row;
}

async function activities(prospectId: string, type: string) {
  return db
    .select()
    .from(contactActivities)
    .where(and(eq(contactActivities.prospectId, prospectId), eq(contactActivities.type, type)));
}

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: `track ${RUN}`, slug: `track-${RUN}` });
  await db.insert(brands).values({
    id: BRAND_ID,
    orgId: ORG_ID,
    name: `track Brand ${RUN}`,
    slug: `track-brand-${RUN}`,
  });
});

afterAll(async () => {
  await db.delete(emailTrackingLinks).where(eq(emailTrackingLinks.orgId, ORG_ID));
  await db.delete(emailSendAttempts).where(eq(emailSendAttempts.orgId, ORG_ID));
  await db.delete(marketingSequences).where(eq(marketingSequences.orgId, ORG_ID));
  if (createdCampaignIds.length) {
    await db.delete(marketingCampaigns).where(inArray(marketingCampaigns.id, createdCampaignIds));
  }
  if (createdContactIds.length) {
    await db.delete(contactActivities).where(inArray(contactActivities.prospectId, createdContactIds));
    await db.delete(marketingProspects).where(inArray(marketingProspects.id, createdContactIds));
  }
  await db.delete(brands).where(eq(brands.id, BRAND_ID));
  await db.delete(expenseCategories).where(eq(expenseCategories.orgId, ORG_ID));
  await db.delete(orgEntitlements).where(eq(orgEntitlements.orgId, ORG_ID));
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("recording — recordOpen / recordClick", () => {
  it("counts every open but writes the email_opened activity once, under concurrency", async () => {
    const { token, prospectId } = await makeSend();
    const results = await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, () => recordOpen(token)));
    expect(results.every(Boolean)).toBe(true);
    const row = await linkRow(token);
    expect(row.openCount).toBe(MAX_IN_FLIGHT);
    expect(row.openedAt).not.toBeNull();
    expect(await activities(prospectId, "email_opened")).toHaveLength(1);
  });

  it("caps click activities, still counts every click, and implies an open", async () => {
    const { token, prospectId } = await makeSend({ links: ["https://example.com/a"] });
    const n = MAX_CLICK_ACTIVITIES + 3;
    for (let done = 0; done < n; done += MAX_IN_FLIGHT) {
      const batch = Math.min(MAX_IN_FLIGHT, n - done);
      const ok = await Promise.all(Array.from({ length: batch }, () => recordClick(token, "https://example.com/a")));
      expect(ok.every(Boolean)).toBe(true);
    }
    const row = await linkRow(token);
    expect(row.clickCount).toBe(n);
    expect(row.clickedAt).not.toBeNull();
    expect(row.openedAt).not.toBeNull();
    const clicks = await activities(prospectId, "email_clicked");
    expect(clicks).toHaveLength(MAX_CLICK_ACTIVITIES);
    expect((clicks[0].payload as { url?: string }).url).toBe("https://example.com/a");
  });

  it("rolls the counter back with a failed activity write, so the next hit records the first open", async () => {
    const { token, prospectId } = await makeSend();
    const real = storage.createActivity.bind(storage);
    const spy = vi.spyOn(storage, "createActivity").mockImplementationOnce(async () => {
      throw new Error("timeline down");
    });
    expect(await recordOpen(token)).toBe(false);
    expect((await linkRow(token)).openCount).toBe(0);
    spy.mockImplementation((data, opts) => real(data, opts));
    expect(await recordOpen(token)).toBe(true);
    expect((await linkRow(token)).openCount).toBe(1);
    expect(await activities(prospectId, "email_opened")).toHaveLength(1);
  });

  it("records nothing for unsubscribed, bounced or deleted recipients, or failed / non-campaign sends", async () => {
    const cases = [
      await makeSend({ prospectId: await makeContact({ unsubscribedAt: new Date() }) }),
      await makeSend({ prospectId: await makeContact({ bouncedAt: new Date() }) }),
      await makeSend({ prospectId: await makeContact({ deletedAt: new Date() }) }),
      await makeSend({ status: "failed" }),
      await makeSend({ status: "permanent_failure" }),
      await makeSend({ attemptKind: "sequence" }),
    ];
    for (const c of cases) {
      expect(await recordOpen(c.token)).toBe(false);
      expect(await recordClick(c.token, "https://example.com/a")).toBe(false);
      const row = await linkRow(c.token);
      expect(row.openCount).toBe(0);
      expect(row.clickCount).toBe(0);
      expect(await activities(c.prospectId, "email_opened")).toHaveLength(0);
    }
  });

  it("records a sequence-step send's open and click, naming the sequence and step", async () => {
    const { token, sequenceId, prospectId, attemptId } = await makeSequenceSend();
    expect(await recordOpen(token)).toBe(true);
    expect(await recordClick(token, "https://example.com/s")).toBe(true);
    const row = await linkRow(token);
    expect(row.openCount).toBe(1);
    expect(row.clickCount).toBe(1);
    const source = { sequence_id: sequenceId, sequence_name: `track Seq ${RUN}`, step_index: 2, attempt_id: attemptId };
    const [opened] = await activities(prospectId, "email_opened");
    expect(opened.payload).toEqual(source);
    const [clicked] = await activities(prospectId, "email_clicked");
    expect(clicked.payload).toEqual({ ...source, url: "https://example.com/s" });
  });

  it("records a sequence-step hit that lands before its attempt row, without sequence fields", async () => {
    const { token, prospectId, attemptId } = await makeSequenceSend({ status: null });
    expect(await recordOpen(token)).toBe(true);
    const [opened] = await activities(prospectId, "email_opened");
    expect(opened.payload).toEqual({ sequence_id: null, sequence_name: null, step_index: null, attempt_id: attemptId });
  });

  it("records nothing for a failed sequence send, a kind mismatch, or an unknown link kind", async () => {
    const cases = [
      await makeSequenceSend({ status: "failed" }),
      await makeSequenceSend({ attemptKind: "campaign" }),
      await makeSequenceSend({ linkKind: "other" }),
    ];
    for (const c of cases) {
      expect(await recordOpen(c.token)).toBe(false);
      expect(await recordClick(c.token, "https://example.com/s")).toBe(false);
      const row = await linkRow(c.token);
      expect(row.openCount).toBe(0);
      expect(row.clickCount).toBe(0);
      expect(await activities(c.prospectId, "email_opened")).toHaveLength(0);
    }
  });

  it("records nothing for an unsubscribed recipient of a sequence send", async () => {
    const { token, prospectId } = await makeSequenceSend();
    await db.update(marketingProspects).set({ unsubscribedAt: new Date() }).where(eq(marketingProspects.id, prospectId));
    expect(await recordOpen(token)).toBe(false);
    expect((await linkRow(token)).openCount).toBe(0);
  });

  it("an unsubscribe that commits while a hit waits on the prospect lock wins", async () => {
    const { token, prospectId } = await makeSend();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM marketing_prospects WHERE id = $1 FOR UPDATE", [prospectId]);
      await client.query("UPDATE marketing_prospects SET unsubscribed_at = now() WHERE id = $1", [prospectId]);
      const pending = recordOpen(token);
      await new Promise((r) => setTimeout(r, 150));
      await client.query("COMMIT");
      expect(await pending).toBe(false);
    } finally {
      client.release();
    }
    expect((await linkRow(token)).openCount).toBe(0);
  });

  it("gives up on a lock held past the timeout, leaving counters unchanged and the pool usable", async () => {
    const { token, prospectId } = await makeSend();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM marketing_prospects WHERE id = $1 FOR UPDATE", [prospectId]);
      const started = Date.now();
      expect(await recordOpen(token)).toBe(false);
      expect(Date.now() - started).toBeLessThan(2_500);
      expect((await linkRow(token)).openCount).toBe(0);
      expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(await recordOpen(token)).toBe(true);
  });

  it("serves past the in-flight cap without recording, instead of queueing on the pool", async () => {
    const { token, prospectId } = await makeSend();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM marketing_prospects WHERE id = $1 FOR UPDATE", [prospectId]);
      const held = Array.from({ length: MAX_IN_FLIGHT }, () => recordOpen(token));
      await new Promise((r) => setTimeout(r, 100));
      const started = Date.now();
      expect(await recordOpen(token)).toBe(false);
      expect(Date.now() - started).toBeLessThan(100);
      await client.query("ROLLBACK");
      expect((await Promise.all(held)).every(Boolean)).toBe(true);
    } finally {
      client.release();
    }
    expect((await linkRow(token)).openCount).toBe(MAX_IN_FLIGHT);
  });

  it("stops waiting for an exhausted pool at the deadline, then records once connections return", async () => {
    const { token } = await makeSend();
    const held = await Promise.all(
      Array.from({ length: (pool as unknown as { options: { max: number } }).options.max }, () => pool.connect()),
    );
    try {
      const started = Date.now();
      expect(await recordOpen(token)).toBe(false);
      await expect(findTrackedLinks(token)).rejects.toBeInstanceOf(TrackingUnavailableError);
      expect(Date.now() - started).toBeLessThan(2 * DEADLINE_MS + 1_000);
    } finally {
      for (const c of held) c.release();
    }
    // The abandoned attempts keep their slots until they settle, then free them.
    await new Promise((r) => setTimeout(r, 500));
    expect(await findTrackedLinks(token)).toEqual(expect.any(Array));
    expect(await recordOpen(token)).toBe(true);
  });

  it("refuses a lookup past the in-flight cap instead of queueing on the pool", async () => {
    const { token, prospectId } = await makeSend();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM marketing_prospects WHERE id = $1 FOR UPDATE", [prospectId]);
      const held = Array.from({ length: MAX_IN_FLIGHT }, () => recordOpen(token));
      await new Promise((r) => setTimeout(r, 100));
      const started = Date.now();
      await expect(findTrackedLinks(token)).rejects.toBeInstanceOf(TrackingUnavailableError);
      expect(Date.now() - started).toBeLessThan(100);
      await client.query("ROLLBACK");
      await Promise.all(held);
    } finally {
      client.release();
    }
    expect(await findTrackedLinks(token)).toEqual(expect.any(Array));
  });

  it("rejects unknown and malformed tokens without touching the database", async () => {
    expect(await recordOpen(newTrackingToken())).toBe(false);
    expect(await recordOpen("not-a-token")).toBe(false);
    expect(await findTrackedLinks(newTrackingToken())).toBeNull();
    expect(await findTrackedLinks("../x")).toBeNull();
  });

  it("keeps the stored destinations after the campaign is deleted", async () => {
    const { token, campaignId } = await makeSend({ links: ["https://example.com/kept"] });
    await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
    expect(await findTrackedLinks(token)).toEqual(["https://example.com/kept"]);
  });
});

describe("metrics", () => {
  it("per-campaign and per-brand engagement count delivered sends only", async () => {
    const delivered = await makeSend();
    await recordOpen(delivered.token);
    await recordClick(delivered.token, "https://example.com/a");
    await recordClick(delivered.token, "https://example.com/a");

    const m = await storage.getCampaignSendMetrics(ORG_ID, delivered.campaignId);
    expect(m).toMatchObject({ sent: 1, opened: 1, clicked: 1, opens: 1, clicks: 2 });

    const byBrand = await storage.getCampaignEngagementByBrand(ORG_ID, BRAND_ID);
    expect(byBrand[delivered.campaignId]).toEqual({ sent: 1, opened: 1, clicked: 1 });

    const failed = await makeSend({ status: "failed" });
    expect(byBrand[failed.campaignId]).toBeUndefined();
    expect((await storage.getCampaignEngagementByBrand(ORG_ID, BRAND_ID))[failed.campaignId]).toBeUndefined();
    expect(await storage.getCampaignEngagementByBrand(ORG_ID, randomUUID())).toEqual({});
  });
});
