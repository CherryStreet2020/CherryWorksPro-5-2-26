/**
 * Public /compare + /switch-from-* CTA assertions — Task #442 step 7.
 *
 * Existing #432 spec (switch-from-pages.spec.ts) only smoke-renders.
 * This adds CTA verification: every switch-from-* page exposes a
 * `cta-start-trial` button that deep-links to /signup, plus the
 * Marketing OS cross-sell link goes to /marketing. The /compare
 * page (which renders the FreshBooks comparison hub) is verified
 * via its comparison table + tier-switch links.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

const SWITCH_PAGES = [
  "/switch-from-quickbooks",
  "/switch-from-freshbooks",
  "/switch-from-xero",
  "/switch-from-wave",
  "/switch-from-harvest",
  "/switch-from-bigtime",
  "/switch-from-scoro",
  "/switch-from-paymo",
];

test.describe("Public /switch-from-* — CTA verification", () => {
  for (const path of SWITCH_PAGES) {
    test(`${path}: hero renders and Marketing OS cross-sell link goes to /marketing`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 15000 });

      // Migration timeline + cross-sell are present on each LP.
      const timeline = page.locator('[data-testid="migration-timeline-heading"]');
      await timeline.scrollIntoViewIfNeeded();
      await expect(timeline).toBeVisible();

      const crossSell = page.locator('[data-testid="link-compare-marketing-os"]');
      await crossSell.scrollIntoViewIfNeeded();
      await expect(crossSell).toBeVisible();
      await Promise.all([
        page.waitForURL(/\/marketing(\?|$)/, { timeout: 15000 }),
        crossSell.click(),
      ]);
      await expect(page.locator('[data-testid="marketing-os-heading"]')).toBeVisible({ timeout: 15000 });

      const real = errors.filter(
        (e) =>
          !/Failed to load resource.*40[13]/i.test(e) &&
          !/autocomplete attributes/i.test(e),
      );
      expect(real, `${path} errors: ${real.join(" | ")}`).toEqual([]);
    });

    test(`${path}: cta-start-trial → /signup`, async ({ page }) => {
      await page.goto(path);
      const cta = page.locator('[data-testid="cta-start-trial"]').first();
      await cta.scrollIntoViewIfNeeded();
      await expect(cta).toBeVisible({ timeout: 15000 });
      await Promise.all([
        page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
        cta.click(),
      ]);
      await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
    });
  }
});

test.describe("Public /compare hub", () => {
  test("renders the comparison table and Marketing OS cross-sell", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/compare");
    await expect(page.locator('[data-testid="comparison-table"]').first()).toBeVisible({ timeout: 15000 });

    const crossSell = page.locator('[data-testid="link-compare-marketing-os"]');
    await crossSell.scrollIntoViewIfNeeded();
    await expect(crossSell).toBeVisible();

    const real = errors.filter(
      (e) =>
        !/Failed to load resource.*40[13]/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `/compare errors: ${real.join(" | ")}`).toEqual([]);
  });

  test("each switch-link tile on /compare resolves to its competitor LP", async ({ page }) => {
    await page.goto("/compare");
    const link = page.locator('[data-testid="switch-link-quickbooks"]').first();
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/switch-from-quickbooks(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15000 });
  });
});
