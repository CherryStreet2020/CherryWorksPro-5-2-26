/**
 * Public static marketing pages — CTA deep-link assertions
 * (Task #442 step 2). Goes beyond #432's smoke render.
 *
 * For features/about/security/integrations: verify the visible
 * internal CTAs land on the documented destination route.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

test.describe("Static marketing pages — CTA deep-links", () => {
  test("/features → 'See it in action' goes to /demo", async ({ page }) => {
    await page.goto("/features");
    await expect(page.locator('[data-testid="features-heading"]')).toBeVisible({ timeout: 15000 });
    const cta = page.locator('[data-testid="see-it-in-action"]').first();
    await cta.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/demo(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="demo-section-dashboard"]').first()).toBeVisible({ timeout: 15000 });
  });

  test("/features → Marketing OS section link goes to /marketing", async ({ page }) => {
    await page.goto("/features");
    const link = page.locator('[data-testid="link-features-marketing-os"]').first();
    await link.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/marketing(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="marketing-os-heading"]')).toBeVisible({ timeout: 15000 });
  });

  test("/about → Start Trial CTA goes to /signup", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator('[data-testid="about-heading"]')).toBeVisible({ timeout: 15000 });
    const cta = page.locator('[data-testid="cta-start-trial"]').first();
    await cta.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("/about → Marketing OS link goes to /marketing", async ({ page }) => {
    await page.goto("/about");
    const link = page.locator('[data-testid="link-about-marketing-os"]').first();
    await link.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/marketing(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="marketing-os-heading"]')).toBeVisible({ timeout: 15000 });
  });

  test("/integrations → Start Trial CTA goes to /signup", async ({ page }) => {
    await page.goto("/integrations");
    const cta = page.locator('[data-testid="button-start-trial-integrations"]').first();
    await cta.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("/integrations → Marketing Hub addon link goes to /marketing", async ({ page }) => {
    await page.goto("/integrations");
    const link = page.locator('[data-testid="link-marketing-os"]').first();
    await link.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/marketing(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="marketing-os-heading"]')).toBeVisible({ timeout: 15000 });
  });

  test("/security → contact-team link goes to /contact", async ({ page }) => {
    await page.goto("/security");
    await expect(page.locator('[data-testid="heading-security-title"]')).toBeVisible({ timeout: 15000 });
    const link = page.locator('[data-testid="link-security-contact"]').first();
    await link.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/contact(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="input-contact-name"]')).toBeVisible({ timeout: 15000 });
  });

  test("/terms and /privacy render without page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/terms");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15000 });

    await page.goto("/privacy");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15000 });

    const real = errors.filter(
      (e) =>
        !/Failed to load resource.*40[13]/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `terms/privacy page errors: ${real.join(" | ")}`).toEqual([]);
  });
});
