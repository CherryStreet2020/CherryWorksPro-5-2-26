import { test, expect } from "../tests/helpers/po/fixtures";
import {
  buildIsolatedRequest,
  createIsolatedOrg,
  deleteIsolatedOrg,
} from "../tests/helpers/po/isolation";
import {
  closeRevPool,
  insertClient,
  insertSentInvoice,
  sweepOrgRevenue,
} from "./_revenue-helpers";

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

test.describe("Invoices — deep CRUD + per-org money", () => {
  test("POST /api/invoices rejects total>0 with no line items", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const today = new Date().toISOString().slice(0, 10);

    const r = await isolatedOrg.request.post("/api/invoices", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        clientId,
        issuedDate: today,
        dueDate: today,
        currency: "USD",
        total: 250,
        lines: [],
      },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toMatch(/no line items/i);
  });

  test("POST /api/invoices succeeds for blank draft (total=0, no lines)", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const today = new Date().toISOString().slice(0, 10);

    const r = await isolatedOrg.request.post("/api/invoices", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { clientId, issuedDate: today, dueDate: today, currency: "USD" },
    });
    expect(r.status(), await r.text()).toBe(200);
    const inv = await r.json();
    expect(inv.status).toBe("DRAFT");
  });

  test("AR outstanding is per-org and excludes a sibling org's invoices", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    await insertSentInvoice(isolatedOrg.orgId, clientId, "100.00");
    await insertSentInvoice(isolatedOrg.orgId, clientId, "250.50");
    await insertSentInvoice(isolatedOrg.orgId, clientId, "49.50");

    // Spin up a second isolated org with its own SENT invoices. If
    // /api/ar/outstanding ever leaks across tenants, the iso A response
    // will inflate by org B's totals — so this is a real per-org guard,
    // not just a self-sum check.
    const orgB = await createIsolatedOrg({ planTier: "BUSINESS" });
    const orgBAuth = await buildIsolatedRequest(orgB);
    try {
      const otherClient = await insertClient(orgB.orgId);
      await insertSentInvoice(orgB.orgId, otherClient, "9999.99");
      await insertSentInvoice(orgB.orgId, otherClient, "5000.00");

      const r = await isolatedOrg.request.get("/api/ar/outstanding");
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(Number(body.outstandingAR)).toBeCloseTo(400.0, 2);

      // And the inverse: org B's endpoint sees only its own invoices.
      const rB = await orgBAuth.request.get("/api/ar/outstanding");
      expect(rB.status()).toBe(200);
      expect(Number((await rB.json()).outstandingAR)).toBeCloseTo(14999.99, 2);
    } finally {
      await orgBAuth.request.dispose().catch(() => undefined);
      await sweepOrgRevenue(orgB.orgId);
      await deleteIsolatedOrg(orgB.orgId);
    }
  });
});
