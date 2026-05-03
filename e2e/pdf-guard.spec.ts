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

test.describe("Invoice PDF generation guard", () => {
  test("PDF for invoice without line items returns 400 with explicit message", async ({
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

  test("PDF for invoice with line items returns 200 application/pdf", async ({
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
    const body = await r.body();
    // PDF magic header `%PDF`
    expect(body.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
