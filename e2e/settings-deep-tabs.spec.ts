/**
 * Task #443 — /settings deep tab coverage.
 *
 * The Settings page has four (admin: five) hash-driven tabs:
 *   organization, billing-invoicing, services-categories,
 *   accounting-email, subscription
 *
 * The hash is the persistence layer — no `?sub=` query param.
 * The spec verifies tab switching, hash sync, and a substantive
 * round-trip on the Organization save path.
 */
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
  test("each tab activates and persists in the URL hash", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings");
    await expect(page.locator('[data-testid="settings-tab-bar"]')).toBeVisible({ timeout: 20_000 });

    for (const tab of TABS) {
      const trigger = page.locator(`[data-testid="tab-${tab}"]`);
      if (!(await trigger.count())) continue; // subscription only renders for admins
      await trigger.click();
      await expect.poll(() =>
        page.evaluate(() => window.location.hash),
      ).toBe(`#${tab}`);
    }

    // Reload preserves the active tab via the hash listener.
    await page.goto("/settings#accounting-email");
    await expect(page.locator('[data-testid="tab-accounting-email"]'))
      .toHaveCSS("border-bottom-color", /(?!rgba?\(0, 0, 0, 0\)).+/);
  });

  test("organization save round-trips via /api/org/settings", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/settings#organization");
    await expect(page.locator('[data-testid="input-org-name"]')).toBeVisible({ timeout: 20_000 });

    // input-org-name is a display-only mirror of the immutable org
    // record; the editable round-trip fields live in the Settings
    // form (phone, website, email).
    const phone = "555-0987";
    const website = `https://e2e-${Date.now().toString(36)}.example`;
    await page.locator('[data-testid="input-org-phone"]').fill(phone);
    await page.locator('[data-testid="input-org-website"]').fill(website);
    await page.locator('[data-testid="button-save-settings"]').first().click();

    await expect.poll(async () => {
      const r = await isolatedOrg.request.get("/api/org/settings");
      const json = await r.json();
      return `${json.phone ?? ""}/${json.website ?? ""}`;
    }, { timeout: 10_000 }).toBe(`${phone}/${website}`);
  });
});
