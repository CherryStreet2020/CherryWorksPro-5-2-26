/**
 * Task #465 — Optional invoice worklog/time-entry detail rendering.
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
  sendInvoice,
} from "./_helpers";

async function buildSentInvoiceWithTwoBillableEntries(iso: any) {
  const client = await seedClient(iso);
  const project = await seedProject(iso, client.id, { name: "Acme Rebuild" });
  await addProjectMember(iso, project.id, iso.userId, 175);
  // Two billable entries on different days so we get a day header per
  // day plus a weekly subtotal row in the detail block.
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
  // One additional entry with effectively-empty notes — proves the
  // description column on web renders blank instead of falling back
  // to the project name. The notes column requires len >= 1, but
  // extractTicketRef trims so " " yields { ticket: null, description: "" }.
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

  // Org default is false by default; we don't touch it.
  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  try {
    await pub.goto(`/i/${publicToken}`);
    await pub.waitForSelector('[data-testid="card-public-invoice"]', { timeout: 15000 });
    // No public-detail-* rows should be in the DOM.
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

  // Flip the org default on.
  const orgPatch = await patchJson(isolatedOrg, "/api/org/settings", {
    showTimeEntryDetails: true,
  });
  expect(orgPatch.ok(), `org settings PATCH failed: ${orgPatch.status()} ${await orgPatch.text()}`).toBe(true);

  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  try {
    await pub.goto(`/i/${publicToken}`);
    await pub.waitForSelector('[data-testid="card-public-invoice"]', { timeout: 15000 });

    // At least one day header (we logged on 2 days but the auto-aggregator
    // groups by client/project/rate, so both days should land under one
    // line and produce 2 day headers).
    const dayRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-day-"]');
    expect(await dayRows.count()).toBeGreaterThanOrEqual(1);

    // At least one entry row, with project / ticket / billable tag visible.
    const entryRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-entry-"]');
    const entryCount = await entryRows.count();
    expect(entryCount).toBeGreaterThanOrEqual(1);

    const firstEntryTestId = await entryRows.first().getAttribute("data-testid");
    expect(firstEntryTestId).toBeTruthy();
    // Pull the entryId out of the testid: public-detail-{i}-entry-{id}
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

    // Weekly subtotal row.
    const weekRows = pub.locator('[data-testid^="public-detail-"][data-testid*="-week-"]');
    expect(await weekRows.count()).toBeGreaterThanOrEqual(1);

    // The empty-notes entry must render an empty description cell —
    // we never substitute the project name into the description column.
    // Walk every entry's description span and assert at least one is
    // an empty string while its project cell is still populated.
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
        // Empty description — project column must still be populated
        // (the project name MUST NOT have leaked into the description).
        expect(projectText).toBe("Acme Rebuild");
        foundEmpty = true;
      }
    }
    expect(foundEmpty, "expected at least one entry with empty description from the empty-notes seed").toBe(true);

    // PDF smoke: with details ON, the public PDF endpoint must
    // succeed end-to-end. This exercises drawDetailBlock's
    // prefetch + page-break path; if any of that throws, the
    // request would 500 and this assertion fails.
    const pdfRes = await pub.request.get(`/api/public/invoices/${publicToken}/pdf`);
    expect(pdfRes.status()).toBe(200);
    const ct = pdfRes.headers()["content-type"] ?? "";
    expect(ct).toContain("application/pdf");
    const pdfBuf = await pdfRes.body();
    expect(pdfBuf.length).toBeGreaterThan(1000);
    // Sanity-check that what we got back really is a PDF.
    expect(pdfBuf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  } finally {
    await ctx.close();
  }
});

test("flipping the per-invoice override works on a locked (sent) invoice and leaves money totals unchanged", async ({
  isolatedOrg,
  browser,
}) => {
  const { invoice, publicToken } = await buildSentInvoiceWithTwoBillableEntries(isolatedOrg);

  // Capture the public total BEFORE any toggling.
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

  // The invoice is SENT (locked). Flip the per-invoice override on. The
  // PATCH must succeed even though the editability guard normally
  // blocks edits to sent invoices, because this is a display-only flag.
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
