import { test, expect } from "@playwright/test";

test("Record payment → verify PAID → refund → verify status reverts", async ({
  request,
}) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const clientsRes = await request.get("/api/clients");
  expect(clientsRes.ok()).toBeTruthy();
  const clients = await clientsRes.json();
  expect(clients.length).toBeGreaterThan(0);
  const _clientId = clients[0].id;

  const invoicesRes = await request.get("/api/invoices");
  const allInvoices = await invoicesRes.json();
  let sentInvoice = allInvoices.find(
    (inv: any) => inv.status === "SENT" && Number(inv.paidAmount) === 0 && Number(inv.total) > 0
  );

  if (!sentInvoice) {
    const unpaidRes = await request.get("/api/invoices/unpaid");
    const unpaid = await unpaidRes.json();
    sentInvoice = unpaid.find((inv: any) => Number(inv.total) > 0);
  }

  if (!sentInvoice) {
    test.skip();
    return;
  }

  const invoiceTotal = Number(sentInvoice.total);
  const outstanding = invoiceTotal - Number(sentInvoice.paidAmount);

  const paymentRes = await request.post("/api/payments", {
    data: {
      invoiceId: sentInvoice.id,
      amount: outstanding,
      date: "2026-03-01",
      method: "CHECK",
      notes: "E2E test payment",
    },
  });
  expect(paymentRes.ok()).toBeTruthy();
  const payment = await paymentRes.json();
  expect(payment.id).toBeTruthy();

  const afterPayInvoices = await request.get("/api/invoices");
  const afterPayList = await afterPayInvoices.json();
  const paidInvoice = afterPayList.find((inv: any) => inv.id === sentInvoice.id);
  expect(paidInvoice.status).toBe("PAID");

  const refundRes = await request.post(`/api/payments/${payment.id}/refund`);
  expect(refundRes.ok()).toBeTruthy();
  const refundData = await refundRes.json();
  expect(Number(refundData.refund.amount)).toBeLessThan(0);

  const afterRefundInvoices = await request.get("/api/invoices");
  const afterRefundList = await afterRefundInvoices.json();
  const refundedInvoice = afterRefundList.find((inv: any) => inv.id === sentInvoice.id);
  expect(["SENT", "PARTIAL"]).toContain(refundedInvoice.status);

  const paymentsRes = await request.get("/api/payments");
  const paymentsList = await paymentsRes.json();
  const refundPayment = paymentsList.find((p: any) => Number(p.amount) < 0 && p.invoiceId === sentInvoice.id);
  expect(refundPayment).toBeTruthy();
});

test("Stripe payment refund is rejected", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const paymentsRes = await request.get("/api/payments");
  const payments = await paymentsRes.json();
  const stripePayment = payments.find((p: any) => p.provider === "STRIPE");

  if (!stripePayment) {
    test.skip();
    return;
  }

  const refundRes = await request.post(`/api/payments/${stripePayment.id}/refund`);
  expect(refundRes.status()).toBe(400);
  const body = await refundRes.json();
  expect(body.message).toContain("Stripe");
});
