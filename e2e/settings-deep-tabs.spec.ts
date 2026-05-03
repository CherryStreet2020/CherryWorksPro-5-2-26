import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

const TABS = [
  "organization",
  "billing-invoicing",
  "services-categories",
  "accounting-email",
  "subscription",
] as const;

test.describe("/settings deep tabs", () => {
  test("each tab activates, persists in URL hash, and survives reload", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings");
    await expect(page.locator('[data-testid="settings-tab-bar"]')).toBeVisible({ timeout: 20_000 });

    for (const tab of TABS) {
      const trigger = page.locator(`[data-testid="tab-${tab}"]`);
      const cnt = await trigger.count();
      expect(cnt, `tab-${tab} must render for an admin`).toBe(1);
      await trigger.click();
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${tab}`);
      await expect(trigger).toHaveCSS("border-bottom-style", "solid");
    }

    await page.goto("/settings#accounting-email");
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#accounting-email");
    await expect(page.locator('[data-testid="radio-email-provider"]')).toBeVisible({ timeout: 10_000 });
  });

  test("organization save round-trips via /api/org/settings", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings#organization");
    await expect(page.locator('[data-testid="input-org-name"]')).toBeVisible({ timeout: 20_000 });

    const phone = "555-0987";
    const website = `https://e2e-${Date.now().toString(36)}.example`;
    await page.locator('[data-testid="input-org-phone"]').fill(phone);
    await page.locator('[data-testid="input-org-website"]').fill(website);

    const savePromise = page.waitForResponse(
      (r) => r.url().includes("/api/org/settings") && r.request().method() !== "GET",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-save-settings"]').first().click();
    const saveRes = await savePromise;
    expect(saveRes.status()).toBeLessThan(400);

    await expect.poll(async () => {
      const r = await isolatedOrg.request.get("/api/org/settings");
      const json = await r.json();
      return `${json.phone ?? ""}/${json.website ?? ""}`;
    }, { timeout: 10_000 }).toBe(`${phone}/${website}`);
  });

  test("billing-invoicing tab edits invoicePrefix and persists", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings#billing-invoicing");
    const prefixInput = page.locator('[data-testid="input-invoice-prefix"]');
    await expect(prefixInput).toBeVisible({ timeout: 20_000 });

    const newPrefix = `E2E-${Date.now().toString(36).slice(-4).toUpperCase()}-`;
    await prefixInput.fill(newPrefix);

    const savePromise = page.waitForResponse(
      (r) => r.url().includes("/api/org/settings") && r.request().method() !== "GET",
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="button-save-settings"]').first().click();
    const saveRes = await savePromise;
    expect(saveRes.status()).toBeLessThan(400);

    await expect.poll(async () => {
      const r = await isolatedOrg.request.get("/api/org/settings");
      const json = await r.json();
      return json.invoicePrefix;
    }, { timeout: 10_000 }).toBe(newPrefix);
  });
});
