import { test, expect } from "../tests/helpers/po/fixtures";
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

test.describe("PDF generation guards (invoices + estimates)", () => {
  test("Invoice PDF without line items returns 400 with explicit message", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const invoiceId = await insertDraftInvoiceNoLines(
      isolatedOrg.orgId,
      clientId,
      "0",
    );

    const r = await isolatedOrg.request.get(`/api/invoices/${invoiceId}/pdf`);
    expect(r.status()).toBe(400);
    expect((await r.json()).message).toMatch(/no line items/i);
  });

  test("Invoice PDF with line items returns application/pdf with %PDF magic header", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const { invoiceId } = await insertSentInvoice(
      isolatedOrg.orgId,
      clientId,
      "100.00",
    );

    const r = await isolatedOrg.request.get(`/api/invoices/${invoiceId}/pdf`);
    expect(r.status(), await r.text()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/application\/pdf/);
    expect(r.headers()["content-disposition"]).toMatch(/\.pdf/);
    const body = await r.body();
    expect(body.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(body.length).toBeGreaterThan(500);
  });

  test("Estimate PDF returns application/pdf with %PDF magic header", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const created = await isolatedOrg.request.post("/api/estimates", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        clientId,
        issuedDate: new Date().toISOString().slice(0, 10),
        lines: [{ description: "Pdf line", quantity: 2, unitRate: 75 }],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const est = await created.json();

    const r = await isolatedOrg.request.get(`/api/estimates/${est.id}/pdf`);
    expect(r.status(), await r.text()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/application\/pdf/);
    expect(r.headers()["content-disposition"]).toMatch(/\.pdf/);
    const body = await r.body();
    expect(body.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(body.length).toBeGreaterThan(500);
  });
});
