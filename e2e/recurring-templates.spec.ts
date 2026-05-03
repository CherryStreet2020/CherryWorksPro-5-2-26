import { test, expect } from "../tests/helpers/po/fixtures";
import {
  closeRevPool,
  insertClient,
  revPool,
  sweepOrgRevenue,
} from "./_revenue-helpers";

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

async function createTemplate(
  iso: { request: import("@playwright/test").APIRequestContext; csrf: string },
  clientId: string,
): Promise<string> {
  const r = await iso.request.post("/api/recurring-templates", {
    headers: { "x-csrf-token": iso.csrf },
    data: {
      clientId,
      frequency: "MONTHLY",
      dayOfMonth: 1,
      nextIssueDate: new Date().toISOString().slice(0, 10),
      templateLines: [
        { description: "Retainer", quantity: 1, unitRate: 500 },
      ],
      taxRate: 0,
      discountType: "NONE",
      discountValue: 0,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id;
}

test.describe("Recurring invoice templates", () => {
  test("create + generate produces DRAFT invoice with correct total", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const tmplId = await createTemplate(isolatedOrg, clientId);

    const gen = await isolatedOrg.request.post(
      `/api/recurring-templates/${tmplId}/generate`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(gen.status(), await gen.text()).toBe(201);
    const inv = await gen.json();
    expect(inv.status).toBe("DRAFT");
    expect(Number(inv.total)).toBeCloseTo(500, 2);
  });

  test("generate is deduped by pg advisory lock 200001 (held lock → 409)", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const tmplId = await createTemplate(isolatedOrg, clientId);

    // Acquire the same advisory lock the route uses on a dedicated
    // connection. While we hold it, the route's pg_try_advisory_lock
    // call must return false → 409. This deterministically exercises
    // the dedup branch without relying on HTTP-level race timing.
    const holder = await revPool().connect();
    let acquired = false;
    try {
      const held = await holder.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(200001, hashtext($1)) AS acquired",
        [tmplId],
      );
      acquired = held.rows[0].acquired === true;
      expect(acquired).toBe(true);

      const blocked = await isolatedOrg.request.post(
        `/api/recurring-templates/${tmplId}/generate`,
        { headers: { "x-csrf-token": isolatedOrg.csrf } },
      );
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).message).toMatch(/already in progress/i);
    } finally {
      // Release the session-level lock on the same connection no matter
      // what — otherwise a thrown assertion would leave the lock held
      // and cascade 409s into later tests.
      if (acquired) {
        await holder
          .query("SELECT pg_advisory_unlock(200001, hashtext($1))", [tmplId])
          .catch(() => undefined);
      }
      holder.release();
    }

    // After release, generation succeeds again.
    const ok = await isolatedOrg.request.post(
      `/api/recurring-templates/${tmplId}/generate`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(ok.status(), await ok.text()).toBe(201);
  });

  test("PATCH updates frequency; DELETE deactivates", async ({ isolatedOrg }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const tmplId = await createTemplate(isolatedOrg, clientId);

    const patch = await isolatedOrg.request.patch(
      `/api/recurring-templates/${tmplId}`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { frequency: "QUARTERLY" },
      },
    );
    expect(patch.status()).toBe(200);
    expect((await patch.json()).frequency).toBe("QUARTERLY");

    const del = await isolatedOrg.request.delete(
      `/api/recurring-templates/${tmplId}`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(del.status()).toBe(200);

    const get = await isolatedOrg.request.get(
      `/api/recurring-templates/${tmplId}`,
    );
    expect(get.status()).toBe(200);
    expect((await get.json()).isActive).toBe(false);
  });
});
