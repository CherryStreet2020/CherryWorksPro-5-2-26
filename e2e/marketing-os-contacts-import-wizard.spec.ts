// Task #441 — Marketing OS audit §2.3: contacts import wizard.
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — contacts import wizard", () => {
  test("dry-run returns create/update/skip projection without writing", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Import", slug: "imp" });
    await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, firstName: "Existing", lastName: "P", email: "existing@example.test" },
    });
    const res = await request.post(`${BASE}/api/marketing/contacts/import`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, fileName: "preview.csv", dryRun: true,
        mapping: { "First Name": "firstName", "Last Name": "lastName", "Email": "email" },
        dedupeStrategy: "skip",
        rows: [
          { "First Name": "New", "Last Name": "L", "Email": "new1@example.test" },
          { "First Name": "Other", "Last Name": "L", "Email": "new2@example.test" },
          { "First Name": "Existing", "Last Name": "P", "Email": "existing@example.test" },
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
    const after = await request.get(`${BASE}/api/marketing/contacts?brandId=${brand.id}`);
    const rows = await after.json();
    const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
    expect(list.some((r: { email: string }) => r.email === "new1@example.test")).toBe(false);
  });

  test("dedupe=update preview marks an existing email as 'updated'", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Dedup", slug: "dedup" });
    await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, firstName: "Old", lastName: "Name", email: "dup@example.test" },
    });
    const res = await request.post(`${BASE}/api/marketing/contacts/import`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, fileName: "dup.csv", dryRun: true,
        mapping: { "First Name": "firstName", "Last Name": "lastName", "Email": "email" },
        dedupeStrategy: "update",
        rows: [
          { "First Name": "Renamed", "Last Name": "Name", "Email": "dup@example.test" },
          { "First Name": "Brand", "Last Name": "New", "Email": "fresh@example.test" },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(1);
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(0);
  });

  test("async import drains and worker reports terminal status", async ({ isolatedOrg }) => {
    test.setTimeout(45_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Async", slug: "async-imp" });
    const enq = await (await request.post(`${BASE}/api/marketing/contacts/import`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, fileName: "async.csv",
        mapping: { "First Name": "firstName", "Last Name": "lastName", "Email": "email" },
        dedupeStrategy: "skip",
        rows: [
          { "First Name": "Alpha", "Last Name": "L", "Email": "alpha@e2e.test" },
          { "First Name": "Beta", "Last Name": "L", "Email": "beta@e2e.test" },
          { "First Name": "", "Last Name": "Bad", "Email": "bad@e2e.test" },
        ],
      },
    })).json();
    expect(enq.importId).toBeTruthy();
    const deadline = Date.now() + 15_000;
    let final: { status: string; imported: number; errorCount: number } | null = null;
    while (Date.now() < deadline) {
      const j = await (await request.get(
        `${BASE}/api/marketing/contacts/import/${enq.importId}`,
      )).json();
      if (j.status === "completed" || j.status === "failed") { final = j; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(final).not.toBeNull();
    expect(final!.status).toBe("completed");
    expect(final!.imported).toBe(2);
    expect(final!.errorCount).toBe(1);
  });

  test("UI — full upload→mapping→review→confirm flow", async ({ page, isolatedOrg }) => {
    test.setTimeout(60_000);
    const { orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Wiz", slug: "wiz" });
    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/contacts/import");
    await expect(page.locator('[data-testid="page-contacts-import"]')).toBeVisible({ timeout: 15_000 });
    const pickBrand = page.locator(`[data-testid="button-pick-brand-${brand.id}"]`);
    if (await pickBrand.isVisible().catch(() => false)) await pickBrand.click();

    const csv = "First Name,Last Name,Email\nWizard,Alice,alice@wiz.test\nWizard,Bob,bob@wiz.test\n";
    await page.setInputFiles('[data-testid="input-csv-file"]', {
      name: "wizard.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
    });
    await expect(page.locator('[data-testid="upload-preview-table"]')).toBeVisible({ timeout: 10_000 });
    await page.click('[data-testid="button-to-review"]');
    await expect(page.locator('[data-testid="preview-stats"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="preview-stat-created"]')).toContainText("2");
    await page.click('[data-testid="button-confirm-import"]');
    await expect(page.locator('[data-testid="text-results-title"]')).toBeVisible({ timeout: 30_000 });
    // After completion the in-progress stat-imported is replaced by stat-created.
    await expect(page.locator('[data-testid="stat-created"]')).toContainText("2", { timeout: 30_000 });
  });

  test("UI — manual column remap of an unrecognised header maps it to email", async ({ page, isolatedOrg }) => {
    test.setTimeout(45_000);
    const { orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Remap", slug: "remap" });
    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/contacts/import");
    const pickBrand = page.locator(`[data-testid="button-pick-brand-${brand.id}"]`);
    if (await pickBrand.isVisible().catch(() => false)) await pickBrand.click();

    // CSV with required First/Last + unknown header. Auto-map handles
    // First/Last; the user has to manually map `Contact Address` → email
    // before the row will be picked up as a contactable address.
    const csv = "First Name,Last Name,Contact Address\nRemap,Tester,remap@example.test\n";
    await page.setInputFiles('[data-testid="input-csv-file"]', {
      name: "remap.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
    });
    await expect(page.locator('[data-testid="upload-preview-table"]')).toBeVisible({ timeout: 10_000 });
    const trigger = page.locator('[data-testid="select-mapping-Contact Address"]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText(/Skip/i);
    await trigger.click();
    await page.locator('[role="option"]', { hasText: /^Email\b/ }).first().click();
    await expect(trigger).toContainText(/^Email/);
    // Advance to the review step — preview should resolve with 1 created.
    await page.click('[data-testid="button-to-review"]');
    await expect(page.locator('[data-testid="preview-stats"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="preview-stat-created"]')).toContainText("1");
  });

  test("UI — malformed CSV (no email-mappable column) blocks the wizard", async ({ page, isolatedOrg }) => {
    const { orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Bad", slug: "bad-wiz" });
    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/contacts/import");
    const pickBrand = page.locator(`[data-testid="button-pick-brand-${brand.id}"]`);
    if (await pickBrand.isVisible().catch(() => false)) await pickBrand.click();
    await page.setInputFiles('[data-testid="input-csv-file"]', {
      name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("Foo,Bar\nA,B\nC,D\n"),
    });
    await expect(page.locator('[data-testid="upload-preview-table"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="warning-required-fields"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="button-to-review"]')).toBeDisabled();
  });
});
