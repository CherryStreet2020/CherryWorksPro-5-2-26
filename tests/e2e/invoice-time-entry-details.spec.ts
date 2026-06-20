/**
 * E2E coverage for optional invoice worklog/time-entry detail rendering.
 *
 * Covers:
 * - Org-level default off + invoice override null → public page renders
 *   no detail rows.
 * - Org-level default on → public page renders day header + per-entry
 *   row with project / ticket / description / hours / billable tag and
 *   weekly subtotal.
 * - Per-invoice override flips on a locked (sent) invoice without
 *   tripping the "Cannot edit this invoice" guard.
 * - Money totals on the public page never change as the toggle flips.
 */
import { test, expect } from "../helpers/po/fixtures";
import {
  seedClient,
  seedProject,
  addProjectMember,
  seedTimeEntry,
  generateInvoice,
  patchJson,
  postJson,
  sendInvoice,
} from "./_helpers";
import { createRequire } from "node:module";
const { PDFParse } = createRequire(import.meta.url)("pdf-parse") as {
  PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> };
};

async function buildSentInvoiceWithTwoBillableEntries(iso: any) {
  const client = await seedClient(iso);
  const project = await seedProject(iso, client.id, { name: "Acme Rebuild" });
  await addProjectMember(iso, project.id, iso.userId, 175);
  const today = new Date();
  const yday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  await seedTimeEntry(iso, project.id, {
    date: fmt(yday),
    minutes: 90,
    billable: true,
    notes: "ACME-101 wired login flow",
  });
  await seedTimeEntry(iso, project.id, {
    date: fmt(today),
    minutes: 60,
    billable: true,
    notes: "ACME-102 fixed redirect bug",
  });
  // Whitespace-only notes proves the desc cell renders blank (no project-name fallback).
  await seedTimeEntry(iso, project.id, {
    date: fmt(today),
    minutes: 30,
    billable: true,
    notes: " ",
  });
  const draft = await generateInvoice(iso, client.id);
  const sent = await sendInvoice(iso, draft.id);
  return { client, project, invoice: { ...draft, ...sent }, publicToken: sent.publicToken };
}

test("org default OFF + invoice override null renders no worklog detail rows on public page", async ({
  isolatedOrg,
  browser,
}) => {
  const { publicToken } = await buildSentInvoiceWithTwoBillableEntries(isolatedOrg);

  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  try {
    await pub.goto(`/i/${publicToken}`);
    await pub.waitForSelector('[data-testid="card-public-invoice"]', { timeout: 15000 });
    const dayRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-day-"]');
    const entryRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-entry-"]');
    expect(await dayRows.count()).toBe(0);
    expect(await entryRows.count()).toBe(0);
  } finally {
    await ctx.close();
  }
});

test("org default ON renders day headers, project+ticket+billable detail rows, and weekly subtotals on public page", async ({
  isolatedOrg,
  browser,
}) => {
  const { publicToken } = await buildSentInvoiceWithTwoBillableEntries(isolatedOrg);

  const orgPatch = await patchJson(isolatedOrg, "/api/org/settings", {
    showTimeEntryDetails: true,
  });
  expect(orgPatch.ok(), `org settings PATCH failed: ${orgPatch.status()} ${await orgPatch.text()}`).toBe(true);

  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  try {
    await pub.goto(`/i/${publicToken}`);
    await pub.waitForSelector('[data-testid="card-public-invoice"]', { timeout: 15000 });

    const dayRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-day-"]');
    expect(await dayRows.count()).toBeGreaterThanOrEqual(1);

    const entryRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-entry-"]');
    const entryCount = await entryRows.count();
    expect(entryCount).toBeGreaterThanOrEqual(1);

    const firstEntryTestId = await entryRows.first().getAttribute("data-testid");
    expect(firstEntryTestId).toBeTruthy();
    const entryId = firstEntryTestId!.split("-entry-")[1];

    const project = pub.locator(`[data-testid$="-project-${entryId}"]`).first();
    await expect(project).toBeVisible();
    expect((await project.textContent())?.trim()).toBe("Acme Rebuild");

    const ticket = pub.locator(`[data-testid$="-ticket-${entryId}"]`).first();
    await expect(ticket).toBeVisible();
    expect((await ticket.textContent())?.trim()).toMatch(/ACME-10[12]/);

    const tag = pub.locator(`[data-testid$="-tag-${entryId}"]`).first();
    await expect(tag).toBeVisible();
    expect((await tag.textContent())?.trim()).toBe("Billable");

    const weekRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-week-"]');
    expect(await weekRows.count()).toBeGreaterThanOrEqual(1);

    // Empty-notes entry must render empty desc; project name never leaks into description.
    const allDescTestIds = await pub
      .locator('[data-testid^="public-detail-"][data-testid*="-desc-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    let foundEmpty = false;
    for (const tid of allDescTestIds) {
      if (!tid) continue;
      const descText = (await pub.locator(`[data-testid="${tid}"]`).textContent()) ?? "";
      const entryId = tid.split("-desc-")[1];
      const projectText = (
        await pub.locator(`[data-testid$="-project-${entryId}"]`).textContent()
      )?.trim() ?? "";
      if (descText.trim() === "") {
        expect(projectText).toBe("Acme Rebuild");
        foundEmpty = true;
      }
    }
    expect(foundEmpty, "expected at least one entry with empty description from the empty-notes seed").toBe(true);

    const pdfRes = await pub.request.get(`/api/public/invoices/${publicToken}/pdf`);
    expect(pdfRes.status()).toBe(200);
    const ct = pdfRes.headers()["content-type"] ?? "";
    expect(ct).toContain("application/pdf");
    const pdfBuf = await pdfRes.body();
    expect(pdfBuf.length).toBeGreaterThan(1000);
    expect(pdfBuf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  } finally {
    await ctx.close();
  }
});

test("PDF pagination: many detail rows produce a multi-page PDF without throwing or orphaning headers", async ({
  isolatedOrg,
  browser,
}) => {
  // 60 entries on 60 distinct days overflow a single Letter page and exercise
  // drawDetailBlock's page-break + "TIME (cont.)" header re-emission path.
  const client = await seedClient(isolatedOrg);
  const project = await seedProject(isolatedOrg, client.id, { name: "Pagination Co" });
  await addProjectMember(isolatedOrg, project.id, isolatedOrg.userId, 150);

  const baseDate = new Date("2025-09-01T12:00:00Z");
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  for (let i = 0; i < 60; i++) {
    const d = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
    await seedTimeEntry(isolatedOrg, project.id, {
      date: fmt(d),
      minutes: 60,
      billable: true,
      notes: `PAG-${100 + i} entry ${i}`,
    });
  }
  const draft = await generateInvoice(isolatedOrg, client.id);
  const sent = await sendInvoice(isolatedOrg, draft.id);

  const flipOn = await patchJson(isolatedOrg, `/api/invoices/${draft.id}`, {
    showTimeEntryDetails: true,
  });
  expect(flipOn.ok(), `override flip failed: ${flipOn.status()} ${await flipOn.text()}`).toBe(true);

  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  try {
    const pdfRes = await pub.request.get(`/api/public/invoices/${sent.publicToken}/pdf`);
    expect(pdfRes.status()).toBe(200);
    const pdfBuf = await pdfRes.body();
    expect(pdfBuf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");

    // PDFKit emits one `/Type /Page` per page; `(?!s)` skips the catalog's `/Pages` parent.
    const raw = pdfBuf.toString("latin1");
    const pageMatches = raw.match(/\/Type\s*\/Page(?!s)/g) || [];
    expect(
      pageMatches.length,
      `expected multi-page PDF from 60 detail entries; got ${pageMatches.length} page(s) in ${pdfBuf.length}-byte PDF`,
    ).toBeGreaterThanOrEqual(2);
  } finally {
    await ctx.close();
  }
});

test("manual invoice does NOT leak unbilled client time entries to the customer-facing public view", async ({
  isolatedOrg,
  browser,
}) => {
  // Org default ON: worklog detail is enabled. Even so, a manually-created
  // invoice must NOT surface the client's OTHER unbilled time — that section
  // leaked unrelated and non-billable (internal) entries onto the customer-facing
  // invoice and drifted as new time was logged after send.
  const orgPatch = await patchJson(isolatedOrg, "/api/org/settings", {
    showTimeEntryDetails: true,
  });
  expect(orgPatch.ok(), `org settings PATCH failed: ${orgPatch.status()} ${await orgPatch.text()}`).toBe(true);

  const client = await seedClient(isolatedOrg);
  const project = await seedProject(isolatedOrg, client.id, { name: "Manual Co" });
  await addProjectMember(isolatedOrg, project.id, isolatedOrg.userId, 150);

  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  // Two unbilled entries — never linked to an invoice line via the generate flow.
  await seedTimeEntry(isolatedOrg, project.id, {
    date: fmt(today),
    minutes: 75,
    billable: true,
    notes: "MAN-201 manual prep work",
  });
  await seedTimeEntry(isolatedOrg, project.id, {
    date: fmt(today),
    minutes: 45,
    billable: true,
    notes: "MAN-202 client review",
  });

  // Manually create a draft invoice (no /api/invoices/generate).
  const issuedDate = fmt(today);
  const dueDate = fmt(new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000));
  const createRes = await postJson(isolatedOrg, "/api/invoices", {
    clientId: client.id,
    issuedDate,
    dueDate,
    currency: "USD",
    status: "DRAFT",
  });
  expect(createRes.ok(), `manual invoice create failed: ${createRes.status()} ${await createRes.text()}`).toBe(true);
  const draft = await createRes.json();

  // Add a manual line item (no time-entry link).
  const lineRes = await postJson(isolatedOrg, `/api/invoices/${draft.id}/lines`, {
    description: "Flat consulting fee",
    quantity: 1,
    unitRate: 500,
  });
  expect(lineRes.ok(), `add line failed: ${lineRes.status()} ${await lineRes.text()}`).toBe(true);

  const sent = await sendInvoice(isolatedOrg, draft.id);

  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  try {
    await pub.goto(`/i/${sent.publicToken}`);
    await pub.waitForSelector('[data-testid="card-public-invoice"]', { timeout: 15000 });

    // The unbilled-worklog section must NOT appear on the customer-facing view.
    const header = pub.locator('[data-testid="row-public-unallocated-worklog-header"]');
    expect(await header.count()).toBe(0);

    // No unallocated entry rows render.
    const entryRows = pub.locator('[data-testid^="public-detail-unallocated-"][data-testid*="-entry-"]');
    expect(await entryRows.count()).toBe(0);

    // The unbilled entries' ticket prefixes must NOT leak into the public page.
    const unallocText = (await pub.locator('[data-testid="card-public-invoice"]').textContent()) ?? "";
    expect(unallocText).not.toMatch(/MAN-20[12]/);

    // The PDF still renders cleanly (no crash now that the section is gone).
    const pdfRes = await pub.request.get(`/api/public/invoices/${sent.publicToken}/pdf`);
    expect(pdfRes.status()).toBe(200);
    const pdfBuf = await pdfRes.body();
    expect(pdfBuf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    expect(pdfBuf.length).toBeGreaterThan(1000);
  } finally {
    await ctx.close();
  }
});

// Task #467: durable org-logo storage + luxury-header collision repair.
// Uploads a tiny PNG via the org logo endpoint and asserts:
//   1. The route persists the logo in Replit Object Storage (URL contains
//      `/api/public-objects/org-logos/`, NOT the legacy
//      `/api/uploads/logos/` local-disk prefix).
//   2. GET on that public URL returns the bytes (no auth required).
//   3. The luxury-themed invoice PDF renders without throwing now that
//      the loader resolves logos through https → object storage.
//   4. DELETE on the org logo route clears the URL.
test("org logo upload persists to object storage, serves publicly, and luxury PDF renders cleanly", async ({
  isolatedOrg,
  browser,
}) => {
  // Smallest valid 1×1 transparent PNG: enough bytes for PDFKit to embed
  // without tripping the 4s loader timeout in dev.
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );

  const uploadRes = await isolatedOrg.request.post("/api/org/logo", {
    headers: { "X-CSRF-Token": isolatedOrg.csrf },
    multipart: {
      logo: {
        name: "test-logo.png",
        mimeType: "image/png",
        buffer: pngBytes,
      },
    },
  });
  expect(
    uploadRes.ok(),
    `org logo upload failed: ${uploadRes.status()} ${await uploadRes.text()}`,
  ).toBe(true);
  const uploadJson = await uploadRes.json();
  expect(typeof uploadJson.logoUrl).toBe("string");
  expect(uploadJson.logoUrl).toContain("/api/public-objects/org-logos/");
  // Critical regression guard: must not be the legacy ephemeral path.
  expect(uploadJson.logoUrl).not.toContain("/api/uploads/logos/");

  // Org settings now reflects the new URL.
  const settingsRes = await isolatedOrg.request.get("/api/org/settings");
  expect(settingsRes.ok()).toBe(true);
  const settings = await settingsRes.json();
  expect(settings.logoUrl).toBe(uploadJson.logoUrl);

  // The hosted logo is publicly readable. Use a fresh unauth context.
  const anonCtx = await browser.newContext();
  try {
    const anonPage = await anonCtx.newPage();
    const fetchRes = await anonPage.request.get(uploadJson.logoUrl);
    expect(fetchRes.status()).toBe(200);
    const fetchedBuf = await fetchRes.body();
    expect(fetchedBuf.length).toBe(pngBytes.length);
    expect(fetchedBuf.equals(pngBytes)).toBe(true);
  } finally {
    await anonCtx.close();
  }

  // Build a sent invoice and render its luxury PDF; the loader must
  // pull the logo via the absolute https URL without crashing the route.
  const client = await seedClient(isolatedOrg);
  const project = await seedProject(isolatedOrg, client.id, { name: "Logo Co" });
  await addProjectMember(isolatedOrg, project.id, isolatedOrg.userId, 150);
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  await seedTimeEntry(isolatedOrg, project.id, {
    date: fmt(today),
    minutes: 60,
    billable: true,
    notes: "LOGO-001 logo render smoke test",
  });
  const draft = await generateInvoice(isolatedOrg, client.id);
  const sent = await sendInvoice(isolatedOrg, draft.id);

  const pdfCtx = await browser.newContext();
  try {
    const pdfPage = await pdfCtx.newPage();
    const pdfRes = await pdfPage.request.get(`/api/public/invoices/${sent.publicToken}/pdf`);
    expect(
      pdfRes.status(),
      `expected 200 from PDF route with object-storage logo; got ${pdfRes.status()}`,
    ).toBe(200);
    const pdfBuf = await pdfRes.body();
    expect(pdfBuf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    // Real content (not an error stub).
    expect(pdfBuf.length).toBeGreaterThan(1000);
  } finally {
    await pdfCtx.close();
  }

  // Cleanup: DELETE clears the URL.
  const delRes = await isolatedOrg.request.delete("/api/org/logo", {
    headers: { "X-CSRF-Token": isolatedOrg.csrf },
  });
  expect(delRes.ok(), `org logo DELETE failed: ${delRes.status()} ${await delRes.text()}`).toBe(true);
  const settingsAfter = await (await isolatedOrg.request.get("/api/org/settings")).json();
  expect(settingsAfter.logoUrl ?? null).toBeNull();
});

test("flipping the per-invoice override works on a locked (sent) invoice and leaves money totals unchanged", async ({
  isolatedOrg,
  browser,
}) => {
  const { invoice, publicToken } = await buildSentInvoiceWithTwoBillableEntries(isolatedOrg);

  const ctxA = await browser.newContext();
  const pubA = await ctxA.newPage();
  let baselineTotal!: string | null;
  try {
    await pubA.goto(`/i/${publicToken}`);
    await pubA.waitForSelector('[data-testid="text-public-total"]', { timeout: 15000 });
    baselineTotal = (
      await pubA.locator('[data-testid="text-public-total"]').textContent()
    )?.trim() || null;
  } finally {
    await ctxA.close();
  }
  expect(baselineTotal).toBeTruthy();

  // Display-only PATCH must succeed on a SENT (locked) invoice.
  const flipOn = await patchJson(isolatedOrg, `/api/invoices/${invoice.id}`, {
    showTimeEntryDetails: true,
  });
  expect(
    flipOn.ok(),
    `display-only override flip on locked invoice should succeed; got ${flipOn.status()} ${await flipOn.text()}`,
  ).toBe(true);

  // Public page now renders detail rows (org default is false; override is true).
  const ctxB = await browser.newContext();
  const pubB = await ctxB.newPage();
  let totalAfterOn!: string | null;
  try {
    await pubB.goto(`/i/${publicToken}`);
    await pubB.waitForSelector('[data-testid="card-public-invoice"]', { timeout: 15000 });
    const entryRows = pubB.locator('[data-testid^="public-detail-"][data-testid*="-entry-"]');
    expect(await entryRows.count()).toBeGreaterThanOrEqual(1);
    totalAfterOn = (
      await pubB.locator('[data-testid="text-public-total"]').textContent()
    )?.trim() || null;
  } finally {
    await ctxB.close();
  }
  expect(totalAfterOn).toBe(baselineTotal);

  // Clear the override (null) — back to org default which is false.
  const clearOverride = await patchJson(isolatedOrg, `/api/invoices/${invoice.id}`, {
    showTimeEntryDetails: null,
  });
  expect(
    clearOverride.ok(),
    `clearing override on locked invoice should succeed; got ${clearOverride.status()} ${await clearOverride.text()}`,
  ).toBe(true);

  // Public page no longer renders detail rows; total still unchanged.
  const ctxC = await browser.newContext();
  const pubC = await ctxC.newPage();
  let totalAfterClear!: string | null;
  try {
    await pubC.goto(`/i/${publicToken}`);
    await pubC.waitForSelector('[data-testid="card-public-invoice"]', { timeout: 15000 });
    const entryRows = pubC.locator('[data-testid^="public-detail-"][data-testid*="-entry-"]');
    expect(await entryRows.count()).toBe(0);
    totalAfterClear = (
      await pubC.locator('[data-testid="text-public-total"]').textContent()
    )?.trim() || null;
  } finally {
    await ctxC.close();
  }
  expect(totalAfterClear).toBe(baselineTotal);
});

// Task #475: regression for PDF header collisions on multi-line org
// addresses across all non-luxury themes. Each theme renders a
// different subset of the org info column; we only check the fields
// that theme actually renders.
type HdrField = "address1" | "address2" | "address3" | "phone" | "email" | "website";
const THEMES: Array<{ name: "classic" | "modern" | "bold" | "minimal"; fields: HdrField[] }> = [
  { name: "classic", fields: ["address1", "address2", "address3", "phone", "email", "website"] },
  { name: "modern",  fields: ["phone", "email"] },
  { name: "bold",    fields: ["address1", "address2", "address3", "phone", "email"] },
  { name: "minimal", fields: ["address1", "address2", "address3", "phone"] },
];

const FIELD_NEEDLES: Record<HdrField, string> = {
  address1: "225 Cherry Street, Suite 74K",
  address2: "New York, NY, 10002",
  address3: "United States",
  phone:    "(929) 724-2979",
  email:    "hi@cherrystconsulting.com",
  website:  "https://cherrystconsulting.com",
};

async function fetchPublicPdfWithRetry(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<Buffer> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await request.get(`/api/public/invoices/${token}/pdf`);
    if (res.status() === 200) return await res.body();
    if (res.status() !== 429) {
      throw new Error(`PDF fetch failed: ${res.status()} ${await res.text()}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("PDF fetch still 429 after retries");
}

for (const { name: theme, fields: expectedFields } of THEMES) {
test(`${theme} theme: multi-line org address renders without header collisions`, async ({
  isolatedOrg,
  browser,
}) => {
  const orgPatch = await patchJson(isolatedOrg, "/api/org/settings", {
    invoiceTheme: theme,
    address: "225 Cherry Street, Suite 74K\nNew York, NY, 10002\nUnited States",
    phone: "(929) 724-2979",
    email: "hi@cherrystconsulting.com",
    website: "https://cherrystconsulting.com",
  });
  expect(orgPatch.ok(), `PATCH /api/org/settings: ${orgPatch.status()}`).toBe(true);

  const orgGet = await isolatedOrg.request.get("/api/org/settings");
  expect(orgGet.ok()).toBe(true);
  const orgName: string = (await orgGet.json()).name;
  expect(orgName.length).toBeGreaterThan(0);

  const client = await seedClient(isolatedOrg);
  const project = await seedProject(isolatedOrg, client.id, { name: "Header Co" });
  await addProjectMember(isolatedOrg, project.id, isolatedOrg.userId, 175);
  await seedTimeEntry(isolatedOrg, project.id, {
    date: new Date().toISOString().slice(0, 10),
    minutes: 60,
    billable: true,
    notes: "HDR-001 header layout seed",
  });
  const draft = await generateInvoice(isolatedOrg, client.id);
  const sent = await sendInvoice(isolatedOrg, draft.id);
  const invoiceNumber: string = sent.number ?? draft.number;
  expect(invoiceNumber.length).toBeGreaterThan(0);
  expect(typeof sent.publicToken).toBe("string");

  const ctx = await browser.newContext();
  let pdfBuf: Buffer;
  try {
    pdfBuf = await fetchPublicPdfWithRetry(ctx.request, sent.publicToken);
  } finally {
    await ctx.close();
  }
  expect(pdfBuf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  expect(pdfBuf.length).toBeGreaterThan(1000);

  const parsed = await new PDFParse({ data: pdfBuf }).getText();
  const text = parsed.text;
  const lines = text.split("\n");

  const findLine = (needle: string): number =>
    lines.findIndex((ln) => ln.includes(needle));

  const idxInvoiceNum = findLine(invoiceNumber);
  expect(idxInvoiceNum, `invoice number not found in PDF text`).toBeGreaterThanOrEqual(0);

  const fieldIdx: Partial<Record<HdrField, number>> = {};
  for (const f of expectedFields) {
    const i = findLine(FIELD_NEEDLES[f]);
    expect(i, `${theme}: missing field ${f} (needle "${FIELD_NEEDLES[f]}")`).toBeGreaterThanOrEqual(0);
    fieldIdx[f] = i;
  }

  // Each expected header field must sit on its own row, in the
  // documented order. Strict less-than catches the original bug where
  // a multi-line address overlapped the next field.
  for (let i = 0; i < expectedFields.length - 1; i++) {
    const a = expectedFields[i];
    const b = expectedFields[i + 1];
    expect(
      fieldIdx[a]!,
      `${theme}: ${a} (row ${fieldIdx[a]}) must sit above ${b} (row ${fieldIdx[b]})`,
    ).toBeLessThan(fieldIdx[b]!);
  }

  // BILL TO sits below the entire stacked header. Letter-spacing
  // makes most themes render it as "B I L L".
  const idxBillTo = lines.findIndex((ln) => /B\s*I\s*L\s*L/.test(ln));
  expect(idxBillTo, `BILL TO row not found`).toBeGreaterThanOrEqual(0);
  if (expectedFields.length > 0) {
    const last = expectedFields[expectedFields.length - 1];
    expect(idxBillTo).toBeGreaterThan(fieldIdx[last]!);
  }
  expect(idxBillTo).toBeGreaterThan(idxInvoiceNum);
});
}
