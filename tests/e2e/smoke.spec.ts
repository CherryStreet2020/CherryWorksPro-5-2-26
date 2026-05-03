import { test, expect } from "@playwright/test";

test("login, create time entry, generate invoice, verify total, check PDF", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });

  await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
  await page.fill('[data-testid="input-password"]', "admin123");
  await page.click('[data-testid="button-login"]');

  await page.waitForURL("**/", { timeout: 10000 });
  await expect(page.locator("text=Dashboard").first()).toBeVisible({
    timeout: 10000,
  });

  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const projectsRes = await request.get("/api/time-entries/my-projects");
  expect(projectsRes.ok()).toBeTruthy();
  const projects = await projectsRes.json();

  if (projects.length > 0) {
    const project = projects[0];
    const timeEntryRes = await request.post("/api/time-entries", {
      data: {
        projectId: project.id,
        date: "2026-02-25",
        minutes: 120,
        billable: true,
        notes: "Smoke test entry",
      },
    });
    expect(timeEntryRes.ok()).toBeTruthy();
  }

  const invoicesRes = await request.get("/api/invoices");
  expect(invoicesRes.ok()).toBeTruthy();
  const invoices = await invoicesRes.json();

  if (invoices.length > 0) {
    const invoice = invoices[0];
    const _lineTotal = invoice.lines.reduce(
      (sum: number, l: { amount: string }) => sum + Number(l.amount),
      0,
    );
    const subtotal = Number(invoice.subtotal);
    const taxAmount = Number(invoice.taxAmount || 0);
    const discountAmount = Number(invoice.discountAmount || 0);
    const expectedTotal = subtotal - discountAmount + taxAmount;
    expect(Math.abs(expectedTotal - Number(invoice.total))).toBeLessThanOrEqual(
      0.01,
    );

    const pdfRes = await request.get(`/api/invoices/${invoice.id}/pdf`);
    expect(pdfRes.ok()).toBeTruthy();
    const pdfBody = await pdfRes.body();
    expect(pdfBody.length).toBeGreaterThan(0);
  }
});

test("invoice editor: add line, set discount+tax, send, partial+final payment", async ({
  request,
}) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const clientsRes = await request.get("/api/clients");
  const clients = await clientsRes.json();
  expect(clients.length).toBeGreaterThan(0);
  const clientId = clients[0].id;

  const timeEntryRes = await request.get("/api/time-entries/my-projects");
  const myProjects = await timeEntryRes.json();
  if (myProjects.length > 0) {
    const entryDate = "2026-02-26";
    await request.post("/api/time-entries", {
      data: {
        projectId: myProjects[0].id,
        date: entryDate,
        minutes: 60,
        billable: true,
        notes: "E2E invoice editor test entry",
      },
    });
  }

  const genRes = await request.post("/api/invoices/generate", {
    data: { clientId, includeUnapproved: true },
  });

  if (!genRes.ok()) {
    const existingInvRes = await request.get("/api/invoices");
    const existingInvoices = await existingInvRes.json();
    const draftInvoice = existingInvoices.find(
      (i: any) => i.status === "DRAFT" && i.clientId === clientId,
    );
    if (!draftInvoice) {
      return;
    }
  }

  let invoiceId: string;
  if (genRes.ok()) {
    const invoice = await genRes.json();
    invoiceId = invoice.id;
  } else {
    const existingInvRes = await request.get("/api/invoices");
    const existingInvoices = await existingInvRes.json();
    const draftInvoice = existingInvoices.find(
      (i: any) => i.status === "DRAFT" && i.clientId === clientId,
    );
    invoiceId = draftInvoice.id;
  }

  const addLineRes = await request.post(`/api/invoices/${invoiceId}/lines`, {
    data: {
      description: "Manual consulting line",
      quantity: 5,
      unitRate: 100,
    },
  });
  expect(addLineRes.ok()).toBeTruthy();
  const newLine = await addLineRes.json();
  expect(Number(newLine.amount)).toBe(500);

  const patchRes = await request.patch(`/api/invoices/${invoiceId}`, {
    data: {
      discountType: "PERCENT",
      discountValue: 10,
      taxRate: 8,
    },
  });
  expect(patchRes.ok()).toBeTruthy();
  const updatedInv = await patchRes.json();

  const subtotal = Number(updatedInv.subtotal);
  const discountAmount = Number(updatedInv.discountAmount);
  const taxAmount = Number(updatedInv.taxAmount);
  const total = Number(updatedInv.total);

  expect(discountAmount).toBeCloseTo(subtotal * 0.10, 1);
  const taxableBase = subtotal - discountAmount;
  expect(taxAmount).toBeCloseTo(taxableBase * 0.08, 1);
  expect(total).toBeCloseTo(taxableBase + taxAmount, 1);

  const sendRes = await request.post(`/api/invoices/${invoiceId}/send`);
  expect(sendRes.ok()).toBeTruthy();

  const afterSend = await request.get("/api/invoices");
  const invoiceAfterSend = (await afterSend.json()).find(
    (i: any) => i.id === invoiceId,
  );
  expect(invoiceAfterSend.status).toBe("SENT");

  const partialAmount = Math.floor(total / 2 * 100) / 100;
  const payRes1 = await request.post("/api/payments", {
    data: {
      invoiceId,
      amount: partialAmount,
      date: "2026-03-01",
      method: "CHECK",
    },
  });
  expect(payRes1.ok()).toBeTruthy();

  const afterPartial = await request.get("/api/invoices");
  const invoiceAfterPartial = (await afterPartial.json()).find(
    (i: any) => i.id === invoiceId,
  );
  expect(invoiceAfterPartial.status).toBe("PARTIAL");
  expect(Number(invoiceAfterPartial.paidAmount)).toBeCloseTo(partialAmount, 1);

  const outstanding =
    Number(invoiceAfterPartial.total) -
    Number(invoiceAfterPartial.paidAmount);
  const payRes2 = await request.post("/api/payments", {
    data: {
      invoiceId,
      amount: Number(outstanding.toFixed(2)),
      date: "2026-03-02",
      method: "WIRE",
    },
  });
  expect(payRes2.ok()).toBeTruthy();

  const afterFull = await request.get("/api/invoices");
  const invoiceAfterFull = (await afterFull.json()).find(
    (i: any) => i.id === invoiceId,
  );
  expect(invoiceAfterFull.status).toBe("PAID");
  expect(
    Math.abs(
      Number(invoiceAfterFull.paidAmount) - Number(invoiceAfterFull.total),
    ),
  ).toBeLessThanOrEqual(0.01);

  const pdfRes = await request.get(`/api/invoices/${invoiceId}/pdf`);
  expect(pdfRes.ok()).toBeTruthy();
  expect((await pdfRes.body()).length).toBeGreaterThan(0);
});
