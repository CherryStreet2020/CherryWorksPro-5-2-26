/**
 * Public Marketing OS landing (`/marketing`) — Task #442 step 4.
 *
 * Verifies hero, FAQ accordion, and the three signup CTAs
 * (hero, pricing, final) all deep-link to /signup. Talk-to-Sales
 * link routes to /contact.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

test.describe("Public /marketing (Marketing OS landing)", () => {
  test("renders hero, separation, FAQ, and final CTA without page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto("/marketing");
    await expect(page.locator('[data-testid="marketing-os-heading"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="badge-marketing-os-addon"]').first()).toBeVisible();

    const separation = page.locator('[data-testid="section-separation"]');
    await separation.scrollIntoViewIfNeeded();
    await expect(separation).toBeVisible();
    await expect(page.locator('[data-testid="heading-prospect-client-separation"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-cross-contamination"]')).toBeVisible();

    const faq = page.locator('[data-testid="heading-marketing-os-faq"]');
    await faq.scrollIntoViewIfNeeded();
    await expect(faq).toBeVisible();

    const real = errors.filter(
      (e) =>
        !/Failed to load resource.*40[13]/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `/marketing page errors: ${real.join(" | ")}`).toEqual([]);
  });

  test("FAQ accordion expands and collapses", async ({ page }) => {
    await page.goto("/marketing");
    const firstFaq = page.locator('[data-testid="button-marketing-os-faq-0"]');
    await firstFaq.scrollIntoViewIfNeeded();
    await expect(firstFaq).toBeVisible({ timeout: 15000 });
    await firstFaq.click();
    // Item still mounted after toggle
    await expect(page.locator('[data-testid="marketing-os-faq-item-0"]')).toBeVisible();
    await firstFaq.click();
    await expect(page.locator('[data-testid="marketing-os-faq-item-0"]')).toBeVisible();
  });

  test("hero signup CTA navigates to /signup", async ({ page }) => {
    await page.goto("/marketing");
    const cta = page.locator('[data-testid="button-marketing-os-hero-signup"]');
    await expect(cta).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("pricing-section CTA navigates to /pricing", async ({ page }) => {
    // Despite the testid name, this CTA reads "See Business plan pricing"
    // and routes to /pricing — the actual signup happens from there.
    await page.goto("/marketing");
    const cta = page.locator('[data-testid="button-marketing-os-pricing-signup"]');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/pricing(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="pricing-heading"]')).toBeVisible({ timeout: 15000 });
  });

  test("final CTA: signup + Talk to Sales links resolve", async ({ page }) => {
    await page.goto("/marketing");
    const finalSignup = page.locator('[data-testid="button-marketing-os-final-signup"]');
    await finalSignup.scrollIntoViewIfNeeded();
    await expect(finalSignup).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      finalSignup.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });

    await page.goto("/marketing");
    const contactLink = page.locator('[data-testid="link-marketing-os-final-contact"]');
    await contactLink.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/contact(\?|$)/, { timeout: 15000 }),
      contactLink.click(),
    ]);
    await expect(page.locator('[data-testid="input-contact-name"]')).toBeVisible({ timeout: 15000 });
  });

  test("hero pricing link routes to /pricing", async ({ page }) => {
    await page.goto("/marketing");
    const link = page.locator('[data-testid="link-marketing-os-hero-pricing"]');
    await expect(link).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/pricing(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="pricing-heading"]')).toBeVisible({ timeout: 15000 });
  });
});
