import { test, expect } from "../helpers/po/fixtures";
import {
  postJson,
  patchJson,
  loginPageAsIso,
  seedClient,
  seedProject,
  addProjectMember,
  seedTimeEntry,
  generateInvoice,
  sendInvoice,
} from "./_helpers";

test("login, create time entry, generate invoice, verify total, check PDF", async ({
  isolatedOrg,
  page,
}) => {
  await loginPageAsIso(page, isolatedOrg);
  await expect(page.locator("text=Dashboard").first()).toBeVisible({ timeout: 15000 });

  const client = await seedClient(isolatedOrg);
  const project = await seedProject(isolatedOrg, client.id);
  await addProjectMember(isolatedOrg, project.id, isolatedOrg.userId, 150);
  await seedTimeEntry(isolatedOrg, project.id, {
    date: "2026-02-25",
    minutes: 120,
    billable: true,
    notes: "Smoke test entry",
  });

  const invoice = await generateInvoice(isolatedOrg, client.id);
  expect(invoice.id).toBeTruthy();
  expect(invoice.lines.length).toBeGreaterThan(0);

  const subtotal = Number(invoice.subtotal);
  const taxAmount = Number(invoice.taxAmount || 0);
  const discountAmount = Number(invoice.discountAmount || 0);
  const expectedTotal = subtotal - discountAmount + taxAmount;
  expect(Math.abs(expectedTotal - Number(invoice.total))).toBeLessThanOrEqual(0.01);

  const pdfRes = await isolatedOrg.request.get(`/api/invoices/${invoice.id}/pdf`);
  expect(pdfRes.ok()).toBeTruthy();
  const pdfBody = await pdfRes.body();
  expect(pdfBody.length).toBeGreaterThan(0);
});

test("invoice editor: add line, set discount+tax, send, partial+final payment", async ({
  isolatedOrg,
}) => {
  const client = await seedClient(isolatedOrg);
  const project = await seedProject(isolatedOrg, client.id);
  await addProjectMember(isolatedOrg, project.id, isolatedOrg.userId, 150);
  await seedTimeEntry(isolatedOrg, project.id, {
    date: "2026-02-26",
    minutes: 60,
    billable: true,
    notes: "E2E invoice editor test entry",
  });

  const invoice = await generateInvoice(isolatedOrg, client.id);
  const invoiceId = invoice.id;

  const addLineRes = await postJson(isolatedOrg, `/api/invoices/${invoiceId}/lines`, {
    description: "Manual consulting line",
    quantity: 5,
    unitRate: 100,
  });
  expect(addLineRes.ok()).toBeTruthy();
  const newLine = await addLineRes.json();
  expect(Number(newLine.amount)).toBe(500);

  const patchRes = await patchJson(isolatedOrg, `/api/invoices/${invoiceId}`, {
    discountType: "PERCENT",
    discountValue: 10,
    taxRate: 8,
  });
  expect(patchRes.ok()).toBeTruthy();
  const updatedInv = await patchRes.json();

  const subtotal = Number(updatedInv.subtotal);
  const discountAmount = Number(updatedInv.discountAmount);
  const taxAmount = Number(updatedInv.taxAmount);
  const total = Number(updatedInv.total);

  expect(discountAmount).toBeCloseTo(subtotal * 0.1, 1);
  const taxableBase = subtotal - discountAmount;
  expect(taxAmount).toBeCloseTo(taxableBase * 0.08, 1);
  expect(total).toBeCloseTo(taxableBase + taxAmount, 1);

  await sendInvoice(isolatedOrg, invoiceId);

  const afterSend = await isolatedOrg.request.get("/api/invoices");
  const invoiceAfterSend = (await afterSend.json()).find((i: any) => i.id === invoiceId);
  expect(invoiceAfterSend.status).toBe("SENT");

  const partialAmount = Math.floor((total / 2) * 100) / 100;
  const payRes1 = await postJson(isolatedOrg, "/api/payments", {
    invoiceId,
    amount: partialAmount,
    date: "2026-03-01",
    method: "CHECK",
  });
  expect(payRes1.ok()).toBeTruthy();

  const afterPartial = await isolatedOrg.request.get("/api/invoices");
  const invoiceAfterPartial = (await afterPartial.json()).find((i: any) => i.id === invoiceId);
  expect(invoiceAfterPartial.status).toBe("PARTIAL");
  expect(Number(invoiceAfterPartial.paidAmount)).toBeCloseTo(partialAmount, 1);

  const outstanding =
    Number(invoiceAfterPartial.total) - Number(invoiceAfterPartial.paidAmount);
  const payRes2 = await postJson(isolatedOrg, "/api/payments", {
    invoiceId,
    amount: Number(outstanding.toFixed(2)),
    date: "2026-03-02",
    method: "WIRE",
  });
  expect(payRes2.ok()).toBeTruthy();

  const afterFull = await isolatedOrg.request.get("/api/invoices");
  const invoiceAfterFull = (await afterFull.json()).find((i: any) => i.id === invoiceId);
  expect(invoiceAfterFull.status).toBe("PAID");
  expect(
    Math.abs(Number(invoiceAfterFull.paidAmount) - Number(invoiceAfterFull.total)),
  ).toBeLessThanOrEqual(0.01);

  const pdfRes = await isolatedOrg.request.get(`/api/invoices/${invoiceId}/pdf`);
  expect(pdfRes.ok()).toBeTruthy();
  expect((await pdfRes.body()).length).toBeGreaterThan(0);
});
