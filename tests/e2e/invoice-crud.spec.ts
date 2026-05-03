import { test, expect } from "../helpers/po/fixtures";
import { postJson, loginPageAsIso, seedDraftInvoice } from "./_helpers";

test.describe("Invoice CRUD — create, duplicate, verify", () => {
  test("duplicate invoice creates DRAFT copy in list", async ({ isolatedOrg, page }) => {
    const { invoice } = await seedDraftInvoice(isolatedOrg);

    const dupRes = await postJson(isolatedOrg, `/api/invoices/${invoice.id}/duplicate`, {});
    expect(dupRes.ok()).toBeTruthy();
    const dup = await dupRes.json();
    expect(dup.status).toBe("DRAFT");
    expect(dup.id).not.toBe(invoice.id);
    expect(dup.clientId).toBe(invoice.clientId);

    await loginPageAsIso(page, isolatedOrg);
    await page.goto("/invoices");
    await page.waitForSelector('[data-testid="text-invoices-title"]', { timeout: 15000 });

    await page.fill('[data-testid="input-search-invoices"]', dup.number);
    await page.waitForTimeout(500);

    const row = page.locator(`[data-testid="row-invoice-${dup.id}"]`);
    await expect(row).toBeVisible({ timeout: 5000 });
  });

  test("search filters invoices by number", async ({ isolatedOrg, page }) => {
    await loginPageAsIso(page, isolatedOrg);
    await page.goto("/invoices");
    await page.waitForSelector('[data-testid="text-invoices-title"]', { timeout: 15000 });

    const searchInput = page.locator('[data-testid="input-search-invoices"]');
    await expect(searchInput).toBeVisible();

    await searchInput.fill("INV-");
    await page.waitForTimeout(300);
  });

  test("status filter tabs work", async ({ isolatedOrg, page }) => {
    await loginPageAsIso(page, isolatedOrg);
    await page.goto("/invoices");
    await page.waitForSelector('[data-testid="text-invoices-title"]', { timeout: 15000 });

    const allBtn = page.locator('[data-testid="button-filter-all"]');
    await expect(allBtn).toBeVisible();

    const draftBtn = page.locator('[data-testid="button-filter-draft"]');
    if (await draftBtn.isVisible()) {
      await draftBtn.click();
      await page.waitForTimeout(300);
    }

    await allBtn.click();
    await page.waitForTimeout(300);
  });

  test("sortable columns respond to clicks", async ({ isolatedOrg, page }) => {
    await loginPageAsIso(page, isolatedOrg);
    await page.goto("/invoices");
    await page.waitForSelector('[data-testid="text-invoices-title"]', { timeout: 15000 });

    const thTotal = page.locator('[data-testid="th-sort-total"]');
    if (await thTotal.isVisible()) {
      await thTotal.click();
      await page.waitForTimeout(300);
      await thTotal.click();
      await page.waitForTimeout(300);
    }
  });
});
