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
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("manual invoice shows 'Additional worklog' section with unbilled client time entries when org default ON", async ({
  isolatedOrg,
  browser,
}) => {
  // Org default ON so manual invoices auto-show worklog detail.
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

    // The unallocated section header appears.
    const header = pub.locator('[data-testid="row-public-unallocated-worklog-header"]');
    await expect(header).toBeVisible();

    // At least one entry row from the unallocated bucket renders.
    const entryRows = pub.locator('[data-testid^="public-detail-unallocated-"][data-testid*="-entry-"]');
    expect(await entryRows.count()).toBeGreaterThanOrEqual(1);

    // The MAN-201/MAN-202 ticket prefixes appear somewhere in the unallocated rows.
    const unallocText = (await pub.locator('[data-testid="card-public-invoice"]').textContent()) ?? "";
    expect(unallocText).toMatch(/MAN-20[12]/);

    // The PDF still renders cleanly.
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
  let baselineTotal: string | null = null;
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
  let totalAfterOn: string | null = null;
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
  let totalAfterClear: string | null = null;
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

// Task #475: regression for "PDF header collisions" — repro'd from the
// reported CSC-INV-0001 layout (multi-line address "225 Cherry Street,
// Suite 74K\nNew York, NY, 10002\nUnited States" + phone + email +
// website). For each non-luxury theme we assert:
//
//   1. The fields the theme actually renders all appear in the PDF text.
//   2. They stack in the correct row order (address line 1 → 2 → 3 →
//      phone → email → website), so multi-line addresses no longer
//      collide with the next field.
//   3. No left-column word's bbox xMax crosses into the right-meta
//      column's bbox xMin (the *real* visual collision the user saw).
//   4. The "BILL TO" block sits below the entire stacked header, so a
//      tall multi-line header doesn't bleed into the client block.
//
// Per-theme `fields` map: each non-luxury theme intentionally renders
// a different subset of the org info column. This matches the
// PRE-existing rendering choices (modern is a compact bar, minimal
// hides email/website, bold drops the website) — Task #475 is purely
// about layout collisions for whichever fields the theme renders, NOT
// about adding/removing fields per theme. Adjust this map only when
// the source-of-truth render order in `server/pdf.ts` actually changes.
type HdrField = "address1" | "address2" | "address3" | "phone" | "email" | "website";
const THEMES: Array<{ name: "classic" | "modern" | "bold" | "minimal"; fields: HdrField[] }> = [
  { name: "classic", fields: ["address1", "address2", "address3", "phone", "email", "website"] },
  { name: "modern",  fields: ["phone", "email"] },
  { name: "bold",    fields: ["address1", "address2", "address3", "phone", "email"] },
  { name: "minimal", fields: ["address1", "address2", "address3", "phone"] },
];
for (const { name: theme, fields: expectedFields } of THEMES) {
test(`${theme} theme: multi-line org address + phone + email + right meta render without header collisions`, async ({
  isolatedOrg,
}) => {
  // Note: /api/org/settings does not accept org `name`. The isolated
  // fixture's org name (E2E Iso ...) is fine for this test — the bug
  // we're regressing is purely about the address/phone/email/website
  // stack vs. the right-side meta column, not the org-name line.
  const orgPatch = await patchJson(isolatedOrg, "/api/org/settings", {
    invoiceTheme: theme,
    // Reproduce the user's exact 3-line address shape.
    address: "225 Cherry Street, Suite 74K\nNew York, NY, 10002\nUnited States",
    phone: "(929) 724-2979",
    email: "hi@cherrystconsulting.com",
    website: "https://cherrystconsulting.com",
  });
  expect(
    orgPatch.ok(),
    `org settings PATCH failed: ${orgPatch.status()} ${await orgPatch.text()}`,
  ).toBe(true);

  // Read back the canonical org name + invoice prefix the PDF will use.
  const orgGet = await isolatedOrg.request.get("/api/org/settings");
  expect(orgGet.ok(), `GET /api/org/settings failed: ${orgGet.status()}`).toBe(true);
  const orgSettings = await orgGet.json();
  const orgName: string = orgSettings.name;
  expect(typeof orgName).toBe("string");
  expect(orgName.length).toBeGreaterThan(0);

  const client = await seedClient(isolatedOrg);
  const project = await seedProject(isolatedOrg, client.id, { name: "Header Co" });
  await addProjectMember(isolatedOrg, project.id, isolatedOrg.userId, 175);
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  await seedTimeEntry(isolatedOrg, project.id, {
    date: fmt(today),
    minutes: 60,
    billable: true,
    notes: "HDR-001 header layout regression seed",
  });
  const draft = await generateInvoice(isolatedOrg, client.id);
  const sent = await sendInvoice(isolatedOrg, draft.id);
  // Invoice "number" field on the row is what the PDF renders as the
  // big right-side header (e.g. "INV-0001"). `sendInvoice` returns the
  // updated row, but fall back to the draft if not present.
  const invoiceNumber: string = sent.number ?? draft.number;
  expect(typeof invoiceNumber).toBe("string");
  expect(invoiceNumber.length).toBeGreaterThan(0);

  // Use the authenticated invoice PDF endpoint instead of the public
  // one — the public route has a strict per-IP rate limiter (5/min)
  // that 429s when this parameterized test runs all four themes back
  // to back. The authenticated endpoint exercises the same `pdf.ts`
  // generator code path (where the Task #475 fix lives), so this is
  // a fully equivalent regression surface for header layout.
  const pdfRes = await isolatedOrg.request.get(`/api/invoices/${draft.id}/pdf`);
  expect(pdfRes.status()).toBe(200);
  const pdfBuf = await pdfRes.body();
  expect(pdfBuf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  expect(pdfBuf.length).toBeGreaterThan(1000);

  // Decode the PDF in two complementary ways:
  //   - `pdftotext -layout`: preserves column/row order, one text row
  //     per output line. Used for "this field is below that field" checks.
  //   - `pdftotext -bbox-layout`: emits per-word bounding boxes (xMin,
  //     yMin, xMax, yMax) so we can test true horizontal overlap, which
  //     the layout-text view can't see (two columns can share a Y row
  //     while still being visually separated by whitespace).
  const dir = mkdtempSync(join(tmpdir(), "pdf-hdr-"));
  const pdfPath = join(dir, "invoice.pdf");
  let layoutText = "";
  let bboxXml = "";
  try {
    writeFileSync(pdfPath, pdfBuf);
    layoutText = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf-8",
      timeout: 10000,
    });
    bboxXml = execFileSync("pdftotext", ["-bbox-layout", pdfPath, "-"], {
      encoding: "utf-8",
      timeout: 10000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const lines = layoutText.split("\n");

  // Helper: line index where the *first* substring match appears, or -1.
  const findLine = (needle: string): number =>
    lines.findIndex((ln) => ln.includes(needle));

  // Per-theme diagnostic: dump first 30 lines if anything looks off.
  // (Cheap to keep — fires only on a real assertion failure path below.)
  const dumpLayout = () =>
    `\n[${theme}] layoutText (first 30 lines):\n` +
    lines.slice(0, 30).map((l, i) => `  ${i.toString().padStart(2)}: ${l}`).join("\n");

  // 1. Every theme-relevant header field rendered.
  // Map field key → (label, search needle). Each theme's expected
  // fields are looked up from this dict.
  const fieldDefs: Record<HdrField, { label: string; needle: string }> = {
    address1: { label: "address street line",   needle: "225 Cherry Street, Suite 74K" },
    address2: { label: "address city/zip line", needle: "New York, NY, 10002" },
    address3: { label: "address country line",  needle: "United States" },
    phone:    { label: "phone",                 needle: "(929) 724-2979" },
    email:    { label: "email",                 needle: "hi@cherrystconsulting.com" },
    // "https://" prefix is unique to the website line — substring matching
    // on "cherrystconsulting.com" alone collides with the email line.
    website:  { label: "website",               needle: "https://cherrystconsulting.com" },
  };
  // The minimal theme renders the org name as orgName.toUpperCase(),
  // so substring search must be case-insensitive to find the header
  // (otherwise we'd find the same string lower in the body — e.g. in
  // the footer "Pay online at ..." line — and the stack-order check
  // would fail spuriously).
  const orgNameLc = orgName.toLowerCase();
  const idxOrgName = lines.findIndex((ln) => ln.toLowerCase().includes(orgNameLc));
  const idxInvoiceNum = findLine(invoiceNumber);

  const expectFound = (label: string, idx: number) => {
    expect(idx, `expected ${label} to appear in PDF text rows; got -1${dumpLayout()}`).toBeGreaterThanOrEqual(0);
  };
  expectFound("org name", idxOrgName);
  expectFound("invoice number", idxInvoiceNum);

  // Resolve the indexes of only the fields this theme actually renders.
  const fieldIdx: Partial<Record<HdrField, number>> = {};
  for (const f of expectedFields) {
    const def = fieldDefs[f];
    const i = findLine(def.needle);
    expectFound(`${theme} ${def.label}`, i);
    fieldIdx[f] = i;
  }

  // 2. The left-column header fields stack in the correct row order
  //    (whatever subset this theme renders). Strict less-than means
  //    each field lives on its own row — i.e. no two left-column fields
  //    share a row, which is the exact bug Task #475 fixed.
  for (let i = 0; i < expectedFields.length - 1; i++) {
    const a = expectedFields[i];
    const b = expectedFields[i + 1];
    expect(
      fieldIdx[a]!,
      `${theme}: ${fieldDefs[a].label} (row ${fieldIdx[a]}) should sit ABOVE ${fieldDefs[b].label} (row ${fieldIdx[b]})${dumpLayout()}`,
    ).toBeLessThan(fieldIdx[b]!);
  }
  // Org name always sits above the first rendered info field.
  if (expectedFields.length > 0) {
    expect(idxOrgName).toBeLessThan(fieldIdx[expectedFields[0]]!);
  }

  // 3. No left-column header text visually overlaps the right-side
  //    meta column. The broken header's bug was that the address text
  //    overflowed past the meta column's left edge — i.e. its bbox
  //    xMax encroached on the meta-column words' bbox xMin range.
  //    A shared text row is fine (org name + invoice number always
  //    share row 0 by design) AS LONG AS their X ranges don't overlap.
  //
  //    We parse `pdftotext -bbox-layout` (an XML doc with per-word
  //    <word xMin xMax yMin yMax> elements) and compute a horizontal
  //    "left address text" extent vs. a "right meta text" extent. If
  //    the address xMax >= meta xMin, the columns are visually colliding.
  const wordRe = /<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"\s*>([^<]*)<\/word>/g;
  type Word = { xMin: number; yMin: number; xMax: number; yMax: number; text: string };
  const words: Word[] = [];
  for (let m: RegExpExecArray | null; (m = wordRe.exec(bboxXml)); ) {
    words.push({
      xMin: Number(m[1]),
      yMin: Number(m[2]),
      xMax: Number(m[3]),
      yMax: Number(m[4]),
      text: m[5],
    });
  }
  expect(words.length, "expected pdftotext -bbox-layout to return word boxes").toBeGreaterThan(0);

  // The right meta column carries the invoice number (always present
  // in big bold text). Anchor the column edge using the invoice
  // number's bbox xMin — that's the most reliable per-theme signal of
  // where the right column starts. (Status/Issued/Due labels vary per
  // theme: classic+bold use "Status:" + "Issued:" + "Due:"; modern
  // shows only "INVOICE" + status in the bar then reprints Issued/Due
  // below; minimal compresses dates into a single "·"-joined row.)
  const numWords = invoiceNumber
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => words.find((w) => w.text === tok))
    .filter((w): w is Word => !!w);
  expect(
    numWords.length,
    `expected invoice number "${invoiceNumber}" tokens in bbox output`,
  ).toBeGreaterThan(0);
  const rightColumnLeftEdge = Math.min(...numWords.map((w) => w.xMin));

  // The left-column words to test for horizontal overlap. Per-theme
  // needle list so we only check the fields this theme actually renders.
  const fieldNeedles: Record<HdrField, string[]> = {
    address1: ["225", "Cherry", "Street,", "Suite", "74K"],
    address2: ["New", "York,", "NY,", "10002"],
    address3: ["United", "States"],
    phone:    ["(929)", "724-2979"],
    email:    ["hi@cherrystconsulting.com"],
    website:  ["https://cherrystconsulting.com"],
  };
  const headerNeedles = expectedFields.flatMap((f) => fieldNeedles[f]);
  const leftHeaderWords = words.filter((w) =>
    headerNeedles.some((n) => w.text === n || w.text.includes(n)),
  );
  expect(
    leftHeaderWords.length,
    `expected to find left-column header words for theme ${theme} in the bbox output`,
  ).toBeGreaterThan(0);

  // The strict horizontal-overlap check: every left header word must
  // end (xMax) before the right-meta column begins (rightColumnLeftEdge).
  // Allow 0.5pt of tolerance for floating-point drift.
  for (const w of leftHeaderWords) {
    expect(
      w.xMax,
      `left header word "${w.text}" extends to xMax=${w.xMax.toFixed(2)} which ` +
        `overlaps the right-meta column starting at xMin=${rightColumnLeftEdge.toFixed(2)}`,
    ).toBeLessThan(rightColumnLeftEdge - 0.5);
  }

  // 4. BILL TO must sit BELOW the entire stacked header — including
  //    the last rendered left-column field. Before the fix, BILL TO
  //    was hardcoded at y=140 so a tall multi-line header bled into
  //    it. Note: most themes render "BILL TO" with letter-spacing, so
  //    the layout text shows it as "B I L L  TO" — match on a regex
  //    that survives that.
  const idxBillTo = lines.findIndex((ln) => /B\s*I\s*L\s*L/.test(ln));
  expectFound("BILL TO row", idxBillTo);
  if (expectedFields.length > 0) {
    const lastField = expectedFields[expectedFields.length - 1];
    expect(
      idxBillTo,
      `${theme}: BILL TO (row ${idxBillTo}) should sit BELOW last header field ${fieldDefs[lastField].label} (row ${fieldIdx[lastField]})${dumpLayout()}`,
    ).toBeGreaterThan(fieldIdx[lastField]!);
  }
  // BILL TO is also below the invoice number row.
  expect(idxBillTo).toBeGreaterThan(idxInvoiceNum);
});
}
