import { test, expect } from "../tests/helpers/po/fixtures";
import {
  buildIsolatedRequest,
  createIsolatedOrg,
  deleteIsolatedOrg,
} from "../tests/helpers/po/isolation";
import {
  closeRevPool,
  insertClient,
  insertDraftInvoiceNoLines,
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

  test("/send rejects DRAFT invoice without line items, sends with lines (DRAFT → SENT + publicToken)", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);

    const blankId = await insertDraftInvoiceNoLines(
      isolatedOrg.orgId,
      clientId,
      "0",
    );
    const blocked = await isolatedOrg.request.post(
      `/api/invoices/${blankId}/send`,
      { headers: { "x-csrf-token": isolatedOrg.csrf }, data: {} },
    );
    expect(blocked.status()).toBe(400);
    expect((await blocked.json()).message).toMatch(/no line items/i);

    const today = new Date().toISOString().slice(0, 10);
    const created = await isolatedOrg.request.post("/api/invoices", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { clientId, issuedDate: today, dueDate: today, currency: "USD" },
    });
    expect(created.status(), await created.text()).toBe(200);
    const draft = await created.json();

    const lineRes = await isolatedOrg.request.post(
      `/api/invoices/${draft.id}/lines`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { description: "Work", quantity: 1, unitRate: 100 },
      },
    );
    expect(lineRes.status(), await lineRes.text()).toBe(200);

    const sent = await isolatedOrg.request.post(
      `/api/invoices/${draft.id}/send`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { emailTo: "" },
      },
    );
    expect(sent.status(), await sent.text()).toBe(200);

    const refetched = await isolatedOrg.request.get(`/api/invoices/${draft.id}`);
    const fresh = await refetched.json();
    expect(fresh.status).toBe("SENT");
    expect(typeof fresh.publicToken).toBe("string");
    expect(fresh.publicToken.length).toBe(64);
  });

  test("VOID invoice cannot accept further payments", async ({ isolatedOrg }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const { invoiceId } = await insertSentInvoice(
      isolatedOrg.orgId,
      clientId,
      "300.00",
    );

    const voided = await isolatedOrg.request.post(
      `/api/invoices/${invoiceId}/void`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(voided.status()).toBe(200);

    const pay = await isolatedOrg.request.post("/api/payments", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        invoiceId,
        amount: 50,
        date: new Date().toISOString().slice(0, 10),
        method: "ACH",
      },
    });
    expect(pay.status()).toBe(400);
    expect((await pay.json()).message).toMatch(/voided/i);
  });

  test("Payment over outstanding balance is rejected (no over-allocation)", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const { invoiceId } = await insertSentInvoice(
      isolatedOrg.orgId,
      clientId,
      "100.00",
    );

    const ok = await isolatedOrg.request.post("/api/payments", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        invoiceId,
        amount: 60,
        date: new Date().toISOString().slice(0, 10),
        method: "ACH",
      },
    });
    expect(ok.status(), await ok.text()).toBe(200);

    const over = await isolatedOrg.request.post("/api/payments", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        invoiceId,
        amount: 50,
        date: new Date().toISOString().slice(0, 10),
        method: "ACH",
      },
    });
    expect(over.status()).toBe(400);
    expect((await over.json()).message).toMatch(
      /exceeds outstanding|already.*paid/i,
    );

    const inv = await isolatedOrg.request
      .get(`/api/invoices/${invoiceId}`)
      .then((r) => r.json());
    expect(Number(inv.paidAmount)).toBeCloseTo(60, 2);
    expect(inv.status).toBe("PARTIAL");
  });

  test("AR outstanding is per-org and excludes a sibling org's invoices", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    await insertSentInvoice(isolatedOrg.orgId, clientId, "100.00");
    await insertSentInvoice(isolatedOrg.orgId, clientId, "250.50");
    await insertSentInvoice(isolatedOrg.orgId, clientId, "49.50");

    const orgB = await createIsolatedOrg({ planTier: "BUSINESS" });
    const orgBAuth = await buildIsolatedRequest(orgB);
    try {
      const otherClient = await insertClient(orgB.orgId);
      await insertSentInvoice(orgB.orgId, otherClient, "9999.99");
      await insertSentInvoice(orgB.orgId, otherClient, "5000.00");

      const r = await isolatedOrg.request.get("/api/ar/outstanding");
      expect(r.status()).toBe(200);
      expect(Number((await r.json()).outstandingAR)).toBeCloseTo(400.0, 2);

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
