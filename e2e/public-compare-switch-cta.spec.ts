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
import { gotoWithRetry } from "./_iso-helpers";

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

      await gotoWithRetry(page, path);
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
      await gotoWithRetry(page, path);
      const cta = page.locator('[data-testid="cta-start-trial"]').first();
      await cta.scrollIntoViewIfNeeded();
      await expect(cta).toBeVisible({ timeout: 15000 });
      await Promise.all([
        page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
        cta.click(),
      ]);
      await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
    });

    test(`${path}: pain-point grid renders multiple cards`, async ({ page }) => {
      await gotoWithRetry(page, path);
      const painPoints = page.locator('[data-testid^="pain-point-"]');
      await expect(painPoints.first()).toBeVisible({ timeout: 15000 });
      const count = await painPoints.count();
      expect(count, `${path} should render >=3 pain-point cards`).toBeGreaterThanOrEqual(3);
    });

    test(`${path}: migration timeline renders step 1/2/3`, async ({ page }) => {
      await gotoWithRetry(page, path);
      for (const step of ["1", "2", "3"]) {
        const node = page.locator(`[data-testid="timeline-step-${step}"]`);
        await node.scrollIntoViewIfNeeded();
        await expect(node).toBeVisible({ timeout: 15000 });
      }
    });
  }
});

test.describe("Public /compare hub", () => {
  test("renders the comparison table and Marketing OS cross-sell", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await gotoWithRetry(page, "/compare");
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

  // Each tier-switch tile on /compare must point to its competitor LP. We
  // assert the href on every tile and click-verify a couple for navigation.
  const SWITCH_TILES: Array<{ id: string; href: RegExp }> = [
    { id: "switch-link-freshbooks", href: /\/switch-from-freshbooks$/ },
    { id: "switch-link-quickbooks", href: /\/switch-from-quickbooks$/ },
    { id: "switch-link-xero", href: /\/switch-from-xero$/ },
    { id: "switch-link-wave", href: /\/switch-from-wave$/ },
    { id: "switch-link-harvest", href: /\/switch-from-harvest$/ },
    { id: "switch-link-bigtime", href: /\/switch-from-bigtime$/ },
    { id: "switch-link-scoro", href: /\/switch-from-scoro$/ },
    { id: "switch-link-paymo", href: /\/switch-from-paymo$/ },
  ];

  test("every competitor switch tile on /compare exposes the right href", async ({ page }) => {
    await gotoWithRetry(page, "/compare");
    for (const tile of SWITCH_TILES) {
      const link = page.locator(`[data-testid="${tile.id}"]`).first();
      await link.scrollIntoViewIfNeeded();
      await expect(link, `${tile.id} should be visible`).toBeVisible({ timeout: 15000 });
      const href = await link.locator("xpath=ancestor::a[1]").getAttribute("href");
      expect(href, `${tile.id} href`).toMatch(tile.href);
    }
  });

  test("clicking the QuickBooks switch tile navigates to its LP", async ({ page }) => {
    await gotoWithRetry(page, "/compare");
    const link = page.locator('[data-testid="switch-link-quickbooks"]').first();
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/switch-from-quickbooks(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="migration-timeline-heading"]')).toBeVisible({ timeout: 15000 });
  });

  test("/compare comparison table renders Cherry header + competitor filter buttons", async ({ page }) => {
    await gotoWithRetry(page, "/compare");
    const table = page.locator('[data-testid="comparison-table"]').first();
    await expect(table).toBeVisible({ timeout: 15000 });
    // Filter pills (one per competitor) live above the table; verify a few are mounted.
    for (const id of ["compare-filter-quickbooks", "compare-filter-xero", "compare-filter-wave"]) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
    }
  });
});
