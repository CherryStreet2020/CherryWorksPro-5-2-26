/**
 * ACS marketing transport (PLAN §4a/§4b/§11): while an attempt is `accepted`
 * (the provider has the message but has not confirmed it), the routes that
 * would erase the reconciler's row or swap the step under it answer 409
 * PENDING_DELIVERY and change nothing. Once the row resolves they work.
 *
 * Also covers reactivation through the real status PATCH: `active` on an
 * enrollment with a step left and no `nextSendAt` schedules it; `active` past
 * the last step completes it.
 *
 * Rows are written straight to the DB (the shapes are not what is under test);
 * every guarded operation goes through HTTP on the test server.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";

import { TEST_BASE as BASE_URL } from "../helpers/base";
import { db, pool } from "../../server/db";
import {
  brands,
  emailSendAttempts,
  marketingCampaigns,
  marketingProspects,
  marketingSequenceEnrollments,
  marketingSequences,
  marketingSequenceSteps,
  orgs,
} from "@shared/schema";

interface Ctx { cookies: string; csrfToken: string }
interface ApiResp<T> { status: number; body: T }

async function loginAs(email: string, password: string): Promise<Ctx> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const csrfCookies = csrfRes.headers.getSetCookie();
  const csrfToken = csrfRes.headers.get("x-csrf-token")!;
  const cookieJar = csrfCookies.map((c) => c.split(";")[0]).join("; ");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieJar, "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  expect(loginRes.status).toBe(200);
  const allCookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");
  return { cookies: allCookies, csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken };
}

async function api<T = any>(
  ctx: Ctx,
  method: "GET" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ApiResp<T>> {
  const headers: Record<string, string> = { Cookie: ctx.cookies };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = ctx.csrfToken;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json as T };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let admin: Ctx;
let orgId: string;
const brandId = randomUUID();
const prospectIds: string[] = [];
const campaignIds: string[] = [];
const sequenceIds: string[] = [];
const attemptIds: string[] = [];

async function makeProspect(): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingProspects).values({
    id, orgId, brandId, firstName: "Pending", lastName: "Delivery", email: `pd-${id}@example.com`,
  });
  prospectIds.push(id);
  return id;
}

async function makeSequence(steps: number[]): Promise<{ id: string; stepIds: string[] }> {
  const id = randomUUID();
  await db.insert(marketingSequences).values({ id, orgId, brandId, name: `pd-seq-${stamp}` });
  sequenceIds.push(id);
  const stepIds: string[] = [];
  for (const [i, delayDays] of steps.entries()) {
    const sid = randomUUID();
    await db.insert(marketingSequenceSteps).values({
      id: sid, orgId, sequenceId: id, stepOrder: i, delayDays, subject: `S${i}`, body: `<p>${i}</p>`,
    });
    stepIds.push(sid);
  }
  return { id, stepIds };
}

async function makeEnrollment(sequenceId: string, opts: {
  currentStepIndex: number; nextSendAt: Date | null; status: "active" | "paused" | "completed" | "removed";
}): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingSequenceEnrollments).values({
    id, orgId, sequenceId, prospectId: await makeProspect(), ...opts,
  });
  return id;
}

async function accepted(fields: {
  kind: "campaign" | "sequence";
  campaignId?: string;
  sequenceId?: string;
  enrollmentId?: string;
  stepIndex?: number;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(emailSendAttempts).values({
    id,
    orgId,
    prospectId: await makeProspect(),
    recipientEmail: "pending@example.com",
    status: "accepted",
    transport: "acs",
    providerMessageId: id,
    nextRetryAt: new Date(Date.now() + 60_000),
    ...fields,
  });
  attemptIds.push(id);
  return id;
}

async function resolve(attemptId: string): Promise<void> {
  await db.update(emailSendAttempts).set({ status: "success" }).where(eq(emailSendAttempts.id, attemptId));
}

beforeAll(async () => {
  // Same entitlement shim as the sibling marketing route tests.
  await pool.query(`
    INSERT INTO org_entitlements (org_id, feature, active, activated_at)
    SELECT id, 'marketing_os', true, now() FROM orgs WHERE slug = 'cwpro-dev-qa'
    ON CONFLICT (org_id, feature) DO UPDATE SET active = true
  `);
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, "cwpro-dev-qa"));
  orgId = org.id;
  await db.insert(brands).values({ id: brandId, orgId, name: `PD ${stamp}`, slug: `pd-${stamp}` });
  admin = await loginAs("admin.test@cwpro.dev", "admin123");
}, 60_000);

afterAll(async () => {
  if (attemptIds.length) await db.delete(emailSendAttempts).where(inArray(emailSendAttempts.id, attemptIds));
  if (sequenceIds.length) {
    await db.delete(marketingSequenceEnrollments).where(inArray(marketingSequenceEnrollments.sequenceId, sequenceIds));
    await db.delete(marketingSequenceSteps).where(inArray(marketingSequenceSteps.sequenceId, sequenceIds));
    await db.delete(marketingSequences).where(inArray(marketingSequences.id, sequenceIds));
  }
  if (campaignIds.length) await db.delete(marketingCampaigns).where(inArray(marketingCampaigns.id, campaignIds));
  if (prospectIds.length) await db.delete(marketingProspects).where(inArray(marketingProspects.id, prospectIds));
  await db.delete(brands).where(eq(brands.id, brandId));
}, 30_000);

function expectPending(r: ApiResp<any>) {
  expect(r.status).toBe(409);
  expect(r.body).toMatchObject({ code: "PENDING_DELIVERY", pending: 1 });
  expect(r.body.message).toMatch(/still being confirmed/);
}

describe("409 PENDING_DELIVERY while an ACS attempt is accepted", () => {
  it("DELETE campaign", async () => {
    const id = randomUUID();
    await db.insert(marketingCampaigns).values({ id, orgId, brandId, name: `pd-c-${stamp}`, subject: "s", body: "b" });
    campaignIds.push(id);
    const a = await accepted({ kind: "campaign", campaignId: id });

    expectPending(await api(admin, "DELETE", `/api/marketing/campaigns/${id}`));
    expect(await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id))).toHaveLength(1);
    expect((await db.select().from(emailSendAttempts).where(eq(emailSendAttempts.id, a)))[0].status).toBe("accepted");

    await resolve(a);
    expect((await api(admin, "DELETE", `/api/marketing/campaigns/${id}`)).status).toBe(200);
  });

  it("DELETE sequence", async () => {
    const seq = await makeSequence([0, 3]);
    const enr = await makeEnrollment(seq.id, { currentStepIndex: 0, nextSendAt: null, status: "active" });
    const a = await accepted({ kind: "sequence", sequenceId: seq.id, enrollmentId: enr, stepIndex: 0 });

    expectPending(await api(admin, "DELETE", `/api/marketing/sequences/${seq.id}`));
    expect(await db.select().from(marketingSequences).where(eq(marketingSequences.id, seq.id))).toHaveLength(1);

    await resolve(a);
    expect((await api(admin, "DELETE", `/api/marketing/sequences/${seq.id}`)).status).toBe(200);
  });

  it("PUT steps, whatever the enrollment's status; steps unchanged", async () => {
    const seq = await makeSequence([0, 3]);
    const enr = await makeEnrollment(seq.id, { currentStepIndex: 1, nextSendAt: null, status: "completed" });
    const a = await accepted({ kind: "sequence", sequenceId: seq.id, enrollmentId: enr, stepIndex: 1 });
    const newSteps = { steps: [{ stepOrder: 0, delayDays: 1, subject: "New", body: "<p>new</p>" }] };

    expectPending(await api(admin, "PUT", `/api/marketing/sequences/${seq.id}/steps`, newSteps));
    const kept = await db.select().from(marketingSequenceSteps).where(eq(marketingSequenceSteps.sequenceId, seq.id));
    expect(kept.map((s) => s.id).sort()).toEqual([...seq.stepIds].sort());

    await resolve(a);
    expect((await api(admin, "PUT", `/api/marketing/sequences/${seq.id}/steps`, newSteps)).status).toBe(200);
  });

  it("DELETE enrollment", async () => {
    const seq = await makeSequence([0]);
    const enr = await makeEnrollment(seq.id, { currentStepIndex: 0, nextSendAt: null, status: "paused" });
    const a = await accepted({ kind: "sequence", sequenceId: seq.id, enrollmentId: enr, stepIndex: 0 });

    expectPending(await api(admin, "DELETE", `/api/marketing/sequences/${seq.id}/enrollments/${enr}`));
    expect(await db.select().from(marketingSequenceEnrollments).where(eq(marketingSequenceEnrollments.id, enr)))
      .toHaveLength(1);

    await resolve(a);
    expect((await api(admin, "DELETE", `/api/marketing/sequences/${seq.id}/enrollments/${enr}`)).status).toBe(200);
  });

  it("an accepted row on ANOTHER sequence does not block this one", async () => {
    const mine = await makeSequence([0]);
    const other = await makeSequence([0]);
    const enr = await makeEnrollment(other.id, { currentStepIndex: 0, nextSendAt: null, status: "active" });
    await accepted({ kind: "sequence", sequenceId: other.id, enrollmentId: enr, stepIndex: 0 });
    expect((await api(admin, "DELETE", `/api/marketing/sequences/${mine.id}`)).status).toBe(200);
  });
});

describe("reactivation through the status PATCH", () => {
  async function patchStatus(seqId: string, enrId: string, status: string) {
    return api(admin, "PATCH", `/api/marketing/sequences/${seqId}/enrollments/${enrId}`, { status });
  }

  it("paused → active with a step left and no nextSendAt ⇒ scheduled by that step's delay", async () => {
    const seq = await makeSequence([0, 5]);
    const enr = await makeEnrollment(seq.id, { currentStepIndex: 1, nextSendAt: null, status: "paused" });
    const before = Date.now();
    const r = await patchStatus(seq.id, enr, "active");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("active");
    const at = new Date(r.body.nextSendAt).getTime();
    expect(at).toBeGreaterThanOrEqual(before + 5 * DAY_MS - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 5 * DAY_MS + 1000);
  });

  it("an existing nextSendAt is kept", async () => {
    const seq = await makeSequence([0, 5]);
    const future = new Date(Date.now() + 2 * DAY_MS);
    const enr = await makeEnrollment(seq.id, { currentStepIndex: 1, nextSendAt: future, status: "paused" });
    const r = await patchStatus(seq.id, enr, "active");
    expect(new Date(r.body.nextSendAt).getTime()).toBe(future.getTime());
  });

  it("past the last step ⇒ completed, nextSendAt null", async () => {
    const seq = await makeSequence([0, 1]);
    const enr = await makeEnrollment(seq.id, { currentStepIndex: 2, nextSendAt: null, status: "paused" });
    const r = await patchStatus(seq.id, enr, "active");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("completed");
    expect(r.body.nextSendAt).toBeNull();
  });

  it("pausing leaves nextSendAt alone", async () => {
    const seq = await makeSequence([0, 1]);
    const future = new Date(Date.now() + DAY_MS);
    const enr = await makeEnrollment(seq.id, { currentStepIndex: 1, nextSendAt: future, status: "active" });
    const r = await patchStatus(seq.id, enr, "paused");
    expect(r.body.status).toBe("paused");
    expect(new Date(r.body.nextSendAt).getTime()).toBe(future.getTime());
  });
});
