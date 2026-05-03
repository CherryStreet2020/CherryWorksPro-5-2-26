import { test, expect } from "../helpers/po/fixtures";
import { postJson, seedDraftInvoice, seedSentInvoice } from "./_helpers";

test("send invoice and resend returns ok", async ({ isolatedOrg }) => {
  const { invoice } = await seedSentInvoice(isolatedOrg);

  const resendRes = await postJson(isolatedOrg, `/api/invoices/${invoice.id}/resend`, {});
  expect(resendRes.ok()).toBeTruthy();
  const resendBody = await resendRes.json();
  expect(resendBody.ok).toBe(true);
});

test("resend rejects DRAFT invoice with 400", async ({ isolatedOrg }) => {
  const { invoice } = await seedDraftInvoice(isolatedOrg);
  expect(invoice.status).toBe("DRAFT");

  const resendRes = await postJson(isolatedOrg, `/api/invoices/${invoice.id}/resend`, {});
  expect(resendRes.status()).toBe(400);
  const body = await resendRes.json();
  expect(body.message).toContain("SENT");
});
