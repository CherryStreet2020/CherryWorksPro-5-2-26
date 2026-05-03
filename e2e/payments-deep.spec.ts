import { test, expect } from "../tests/helpers/po/fixtures";
import {
  buildAuthedRequest,
  closeRevPool,
  createManagerUser,
  insertClient,
  insertSentInvoice,
  revPool,
  sweepOrgRevenue,
} from "./_revenue-helpers";

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

async function recordPayment(
  iso: { request: import("@playwright/test").APIRequestContext; csrf: string },
  invoiceId: string,
  amount: number,
): Promise<{ id: string }> {
  const r = await iso.request.post("/api/payments", {
    headers: { "x-csrf-token": iso.csrf },
    data: {
      invoiceId,
      amount,
      date: new Date().toISOString().slice(0, 10),
      method: "ACH",
    },
  });
  expect(r.status(), await r.text()).toBe(200);
  return await r.json();
}

test.describe("Payments — refund $500 ADMIN gate + provider lock", () => {
  test("MANUAL refund < $500 by MANAGER succeeds", async ({ isolatedOrg }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const { invoiceId } = await insertSentInvoice(
      isolatedOrg.orgId,
      clientId,
      "200.00",
    );
    const payment = await recordPayment(isolatedOrg, invoiceId, 200);

    const mgr = await createManagerUser(isolatedOrg.orgId);
    const mgrCtx = await buildAuthedRequest(mgr.email, mgr.password);
    try {
      const r = await mgrCtx.request.post(
        `/api/payments/${payment.id}/refund`,
        {
          headers: { "x-csrf-token": mgrCtx.csrf },
          data: { amount: 100 },
        },
      );
      expect(r.status(), await r.text()).toBe(200);
      const body = await r.json();
      expect(Number(body.refund.amount)).toBeCloseTo(-100, 2);
    } finally {
      await mgrCtx.request.dispose();
    }
  });

  test("MANUAL refund ≥ $500 by MANAGER is gated 403", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const { invoiceId } = await insertSentInvoice(
      isolatedOrg.orgId,
      clientId,
      "750.00",
    );
    const payment = await recordPayment(isolatedOrg, invoiceId, 750);

    const mgr = await createManagerUser(isolatedOrg.orgId);
    const mgrCtx = await buildAuthedRequest(mgr.email, mgr.password);
    try {
      const r = await mgrCtx.request.post(
        `/api/payments/${payment.id}/refund`,
        {
          headers: { "x-csrf-token": mgrCtx.csrf },
          data: { amount: 500 },
        },
      );
      expect(r.status()).toBe(403);
      expect((await r.json()).message).toMatch(/Admin/i);
    } finally {
      await mgrCtx.request.dispose();
    }
  });

  test("MANUAL refund ≥ $500 by ADMIN succeeds", async ({ isolatedOrg }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const { invoiceId } = await insertSentInvoice(
      isolatedOrg.orgId,
      clientId,
      "750.00",
    );
    const payment = await recordPayment(isolatedOrg, invoiceId, 750);

    const r = await isolatedOrg.request.post(
      `/api/payments/${payment.id}/refund`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { amount: 500 },
      },
    );
    expect(r.status(), await r.text()).toBe(200);
    expect(Number((await r.json()).refund.amount)).toBeCloseTo(-500, 2);
  });

  test("Refund of STRIPE-provider payment is rejected (use Stripe dashboard)", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const { invoiceId } = await insertSentInvoice(
      isolatedOrg.orgId,
      clientId,
      "100.00",
    );
    const payment = await recordPayment(isolatedOrg, invoiceId, 100);

    await revPool().query(
      `UPDATE payments SET provider = 'STRIPE' WHERE id = $1 AND org_id = $2`,
      [payment.id, isolatedOrg.orgId],
    );

    const r = await isolatedOrg.request.post(
      `/api/payments/${payment.id}/refund`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { amount: 50 },
      },
    );
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toMatch(/Stripe/i);
  });

});
