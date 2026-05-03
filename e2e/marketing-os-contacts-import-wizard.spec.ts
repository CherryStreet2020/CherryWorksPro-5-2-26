/**
 * Task #441 — Audit §2.3 coverage gap: contacts-import wizard.
 *
 * Three tracks:
 *   - API: dryRun preview returns create/update/skip projections
 *     without writing; async import drains and the worker reports
 *     terminal status.
 *   - UI: real CSV upload via setInputFiles → wizard auto-parses →
 *     mapping table renders → review step shows preview-stats →
 *     confirm-import advances to the results card.
 *   - UI: a malformed mapping (CSV with no email column) surfaces the
 *     warning-required-fields banner and blocks the "to review" CTA.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — contacts import wizard (Task #441)", () => {
  test("dry-run preview returns create/update/skip counts without writing", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Import Brand",
      slug: "imp",
    });
    await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        firstName: "Existing",
        lastName: "Person",
        email: "existing@example.test",
      },
    });
    const res = await request.post(`${BASE}/api/marketing/contacts/import`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        fileName: "preview.csv",
        dryRun: true,
        mapping: { "First Name": "firstName", "Last Name": "lastName", "Email": "email" },
        dedupeStrategy: "skip",
        rows: [
          { "First Name": "New", "Last Name": "Lead", "Email": "new1@example.test" },
          { "First Name": "Other", "Last Name": "Lead", "Email": "new2@example.test" },
          { "First Name": "Existing", "Last Name": "Person", "Email": "existing@example.test" },
          { "First Name": "", "Last Name": "Nope", "Email": "noname@example.test" },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.created).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.errors.length).toBeGreaterThanOrEqual(1);

    const after = await request.get(
      `${BASE}/api/marketing/contacts?brandId=${brand.id}`,
    );
    const rows = (await after.json()).rows ?? (await after.json());
    expect(
      (Array.isArray(rows) ? rows : []).some(
        (r: { email: string }) => r.email === "new1@example.test",
      ),
    ).toBe(false);
  });

  test("async import drains and the worker reports terminal status", async ({
    isolatedOrg,
  }) => {
    test.setTimeout(45_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Async Import",
      slug: "async-imp",
    });
    const enq = await (await request.post(
      `${BASE}/api/marketing/contacts/import`,
      {
        headers: HDRS(csrf),
        data: {
          brandId: brand.id,
          fileName: "async.csv",
          mapping: { "First Name": "firstName", "Last Name": "lastName", "Email": "email" },
          dedupeStrategy: "skip",
          rows: [
            { "First Name": "Alpha", "Last Name": "Lead", "Email": "alpha@e2e.test" },
            { "First Name": "Beta", "Last Name": "Lead", "Email": "beta@e2e.test" },
            { "First Name": "", "Last Name": "Bad", "Email": "bad@e2e.test" },
          ],
        },
      },
    )).json();
    expect(enq.importId).toBeTruthy();

    const deadline = Date.now() + 15_000;
    let final: { status: string; imported: number; errorCount: number } | null = null;
    while (Date.now() < deadline) {
      const j = await (await request.get(
        `${BASE}/api/marketing/contacts/import/${enq.importId}`,
      )).json();
      if (j.status === "completed" || j.status === "failed") {
        final = j;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(final).not.toBeNull();
    expect(final!.status).toBe("completed");
    expect(final!.imported).toBe(2);
    expect(final!.errorCount).toBe(1);
  });

  test("UI — real CSV upload walks the wizard from upload → mapping → review → confirm", async ({
    page,
    isolatedOrg,
  }) => {
    test.setTimeout(60_000);
    const { orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Wizard UI",
      slug: "wizard-ui",
    });

    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/contacts/import");
    await expect(
      page.locator('[data-testid="page-contacts-import"]'),
    ).toBeVisible({ timeout: 15_000 });

    // Pick the brand on the wizard's brand picker if it appears.
    const brandPick = page.locator(
      `[data-testid="button-pick-brand-${brand.id}"]`,
    );
    if (await brandPick.isVisible().catch(() => false)) {
      await brandPick.click();
    }

    // Real file upload via the hidden input.
    const csv =
      "First Name,Last Name,Email\n" +
      "Wizard,Alice,alice@wiz.test\n" +
      "Wizard,Bob,bob@wiz.test\n";
    await page.setInputFiles('[data-testid="input-csv-file"]', {
      name: "wizard.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(
      page.locator('[data-testid="upload-preview-table"]'),
    ).toBeVisible({ timeout: 10_000 });

    // Advance to mapping step. The wizard auto-detects "First Name",
    // "Last Name", "Email" headers, so the to-review CTA should be
    // enabled immediately.
    await page.click('[data-testid="button-to-review"]');
    await expect(
      page.locator('[data-testid="preview-stats"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid="preview-stat-created"]'),
    ).toContainText("2");

    // Confirm and wait for the results card.
    await page.click('[data-testid="button-confirm-import"]');
    await expect(
      page.locator('[data-testid="text-results-title"]'),
    ).toBeVisible({ timeout: 30_000 });
    // After the worker reports `completed`, the in-progress
    // stat-imported / stat-skipped / stat-errors trio is replaced by
    // stat-created / stat-updated / stat-skipped / stat-errors. Assert
    // the terminal stat-created value lines up with our 2-row CSV.
    await expect(
      page.locator('[data-testid="stat-created"]'),
    ).toContainText("2", { timeout: 30_000 });
  });

  test("UI — malformed CSV (no email column) surfaces the required-fields warning", async ({
    page,
    isolatedOrg,
  }) => {
    const { orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Bad Wizard",
      slug: "bad-wizard",
    });
    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/contacts/import");
    const brandPick = page.locator(
      `[data-testid="button-pick-brand-${brand.id}"]`,
    );
    if (await brandPick.isVisible().catch(() => false)) {
      await brandPick.click();
    }
    // CSV without a recognizable email column — wizard cannot map the
    // required `email` field, so the to-review CTA must stay disabled
    // and the warning banner must render.
    const bad = "Foo,Bar\nA,B\nC,D\n";
    await page.setInputFiles('[data-testid="input-csv-file"]', {
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(bad),
    });
    await expect(
      page.locator('[data-testid="upload-preview-table"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="warning-required-fields"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="button-to-review"]'),
    ).toBeDisabled();
  });
});
