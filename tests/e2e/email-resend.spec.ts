import { test, expect } from "@playwright/test";

test("send invoice and resend returns ok", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const invoicesRes = await request.get("/api/invoices");
  expect(invoicesRes.ok()).toBeTruthy();
  const invoices = await invoicesRes.json();

  let sentInvoice = invoices.find(
    (inv: any) => inv.status === "SENT" && inv.publicToken,
  );

  if (!sentInvoice) {
    const draftInvoice = invoices.find(
      (inv: any) => inv.status === "DRAFT" && inv.lines?.length > 0,
    );
    if (!draftInvoice) return;

    const sendRes = await request.post(`/api/invoices/${draftInvoice.id}/send`);
    expect(sendRes.ok()).toBeTruthy();

    const refreshed = await (await request.get("/api/invoices")).json();
    sentInvoice = refreshed.find((inv: any) => inv.id === draftInvoice.id);
  }

  if (!sentInvoice) return;

  const resendRes = await request.post(`/api/invoices/${sentInvoice.id}/resend`);
  expect(resendRes.ok()).toBeTruthy();
  const resendBody = await resendRes.json();
  expect(resendBody.ok).toBe(true);
});

test("resend rejects DRAFT invoice with 400", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const invoices = await (await request.get("/api/invoices")).json();
  const draftInvoice = invoices.find((inv: any) => inv.status === "DRAFT");

  if (!draftInvoice) return;

  const resendRes = await request.post(
    `/api/invoices/${draftInvoice.id}/resend`,
  );
  expect(resendRes.status()).toBe(400);
  const body = await resendRes.json();
  expect(body.message).toContain("SENT");
});
