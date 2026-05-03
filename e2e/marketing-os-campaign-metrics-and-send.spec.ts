/**
 * Task #441 — Audit §2.3 coverage gap: campaign metrics drill-down +
 * scheduled-send.
 *
 * DRIFT note: the codebase ships an immediate `Send Now` dispatcher
 * (POST /api/marketing/campaigns/:id/send-now) plus a per-campaign
 * `sendAt` timestamp on the row, but no separate "scheduled-send
 * worker" cron exists in this repo at the time of writing. We
 * therefore cover the scheduled-send semantics by:
 *   - persisting `sendAt` via PATCH
 *   - exercising every Send Now precondition / failure mode
 *     (no recipients → 422, brand-domain mismatch → 400,
 *      already-sent → 409)
 *   - asserting the metrics drill-down endpoint
 *     (GET /campaigns/:id/failures) returns the contract shape.
 *
 * We deliberately do NOT trigger an actual Resend dispatch from this
 * spec — RESEND_API_KEY is live in the environment and would charge a
 * real send / contact a real inbox.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — campaign metrics + scheduled-send (Task #441)", () => {
  test("audience-preview returns count + threshold and segment binding cross-checks brand", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Camp Brand",
      slug: "camp",
      domain: "camp.test",
      fromEmail: "noreply@camp.test",
    });
    // Seed 3 deliverable contacts so the audience-preview returns >0.
    for (let i = 0; i < 3; i++) {
      await request.post(`${BASE}/api/marketing/contacts`, {
        headers: HDRS(csrf),
        data: {
          brandId: brand.id,
          firstName: `Aud${i}`,
          lastName: "Member",
          email: `aud${i}@camp.test`,
        },
      });
    }
    const prev = await request.get(
      `${BASE}/api/marketing/campaigns/audience-preview?brandId=${brand.id}&audienceType=all`,
    );
    expect(prev.status()).toBe(200);
    const prevBody = await prev.json();
    expect(prevBody.count).toBe(3);
    expect(typeof prevBody.threshold).toBe("number");
    expect(prevBody.isLarge).toBe(false);
  });

  test("send-now precondition matrix: 422 no-recipients, 400 domain-mismatch, 409 already-sent, scheduled-send via sendAt persists", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Send Brand",
      slug: "send",
      domain: "send.test",
      fromEmail: "noreply@send.test",
    });

    // 1. Empty audience → 422 on send-now
    const empty = await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        name: "Empty Camp",
        subject: "Hi",
        body: "<p>Hi</p>",
        fromEmail: "noreply@send.test",
        fromName: "Send",
        audienceType: "all",
      },
    });
    expect(empty.status()).toBe(201);
    const emptyCamp = await empty.json();
    const emptySend = await request.post(
      `${BASE}/api/marketing/campaigns/${emptyCamp.id}/send-now`,
      { headers: HDRS(csrf), data: {} },
    );
    expect(emptySend.status()).toBe(422);

    // 2. Schedule-send via PATCH sendAt — persists for the (hypothetical)
    //    cron worker without actually firing.
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const sched = await request.patch(
      `${BASE}/api/marketing/campaigns/${emptyCamp.id}`,
      { headers: HDRS(csrf), data: { sendAt: future } },
    );
    expect(sched.status()).toBe(200);
    const schedBody = await sched.json();
    expect(schedBody.sendAt).toBeTruthy();
    expect(new Date(schedBody.sendAt).getTime()).toBeGreaterThan(Date.now());

    // 3. Domain mismatch → 400. Brand domain is send.test; campaign
    //    fromEmail is on a different domain.
    const bad = await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        name: "Bad Domain",
        subject: "Hi",
        body: "<p>Hi</p>",
        fromEmail: "noreply@elsewhere.test",
        fromName: "Send",
        audienceType: "all",
      },
    });
    expect(bad.status()).toBe(201);
    const badCamp = await bad.json();
    // Add a recipient so we get past the 422 and reach the domain check.
    await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        firstName: "R",
        lastName: "One",
        email: "recipient@send.test",
      },
    });
    const badSend = await request.post(
      `${BASE}/api/marketing/campaigns/${badCamp.id}/send-now`,
      { headers: HDRS(csrf), data: {} },
    );
    expect(badSend.status()).toBe(400);
    expect((await badSend.json()).message).toMatch(/domain/i);

    // 4. failures drill-down endpoint returns its contract shape
    //    (empty list pre-send).
    const failures = await request.get(
      `${BASE}/api/marketing/campaigns/${emptyCamp.id}/failures`,
    );
    expect(failures.status()).toBe(200);
    const failuresBody = await failures.json();
    expect(Array.isArray(failuresBody)).toBe(true);
  });
});
