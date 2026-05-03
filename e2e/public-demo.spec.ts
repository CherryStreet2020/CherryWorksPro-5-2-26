/**
 * Public /demo — Task #442 step 6.
 *
 * The demo page is a tour of static interactive mockups. We verify
 * the major mockup sections render and the page produces no
 * uncaught JS errors. We also assert one of the many
 * `cta-section-*` Try-it CTAs lands on /signup.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

const SECTIONS = [
  "demo-section-dashboard",
  "demo-section-time",
  "demo-section-invoicing",
  "demo-section-expenses",
  "demo-section-ai-receipt",
  "demo-section-reports",
  "demo-section-gl",
  "demo-section-bank-recon",
  "demo-section-marketing-os",
  "demo-section-client-portal",
  "demo-section-mission-control",
];

test.describe("Public /demo", () => {
  test("renders the major mockup sections without page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/demo");

    for (const id of SECTIONS) {
      const section = page.locator(`[data-testid="${id}"]`).first();
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible({ timeout: 15000 });
    }

    const real = errors.filter(
      (e) =>
        !/Failed to load resource.*40[13]/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `demo page errors: ${real.join(" | ")}`).toEqual([]);
  });

  test("a section CTA navigates to /signup", async ({ page }) => {
    await page.goto("/demo");
    const cta = page.locator('[data-testid="cta-section-try-the-dashboard"]').first();
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("interactive mockup: timesheet approval has per-row approve/reject + bulk approve buttons", async ({ page }) => {
    await page.goto("/demo");
    const section = page.locator('[data-testid="demo-section-timesheet-approval"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="button-approve-all"]')).toBeVisible();
    // At least the first row's approve/reject controls are mounted and clickable.
    await expect(page.locator('[data-testid="button-approve-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-reject-0"]')).toBeVisible();
  });

  test("interactive mockup: estimates section exposes convert-to-invoice + PDF actions", async ({ page }) => {
    await page.goto("/demo");
    const section = page.locator('[data-testid="demo-section-estimates"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="button-convert-invoice"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-download-pdf"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-revise-estimate"]')).toBeVisible();
  });

  test("Marketing OS cross-sell on /demo links to /marketing", async ({ page }) => {
    await page.goto("/demo");
    const link = page.locator('[data-testid="link-tour-marketing-os"]');
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/marketing(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="marketing-os-heading"]')).toBeVisible({ timeout: 15000 });
  });
});
