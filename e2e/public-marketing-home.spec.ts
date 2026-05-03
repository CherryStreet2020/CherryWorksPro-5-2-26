/**
 * Public marketing home (`/`) — Task #442 step 1.
 *
 * Asserts hero CTAs deep-link correctly, the marketing-nav links
 * resolve to their pages, and the home page renders without
 * uncaught JS errors.
 */
import { test, expect, type Page } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !/Failed to load resource.*40[13]/i.test(e) &&
      !/autocomplete attributes/i.test(e) &&
      !/DevTools/i.test(e),
  );
}

test.describe("Public marketing home", () => {
  test("renders hero, nav, and Marketing OS section without page errors", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await expect(page.locator('[data-testid="marketing-nav"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="hero-cta-start-free"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="section-home-marketing-os"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="cta-start-free-trial"]').first()).toBeVisible();
    expect(realErrors(errors), `home page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("hero Start Free CTA navigates to /signup", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator('[data-testid="hero-cta-start-free"]').first();
    await expect(cta).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("Marketing OS card link navigates to /marketing", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('[data-testid="link-home-marketing-os"]').first();
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/marketing(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="marketing-os-heading"]')).toBeVisible({ timeout: 15000 });
  });

  test.describe("Marketing nav links resolve", () => {
    const navTargets: Array<{ label: string; path: string; anchor: string }> = [
      { label: "Features", path: "/features", anchor: '[data-testid="features-heading"]' },
      { label: "Tour", path: "/demo", anchor: '[data-testid="demo-section-dashboard"]' },
      { label: "Compare", path: "/compare", anchor: '[data-testid="comparison-table"]' },
      { label: "Pricing", path: "/pricing", anchor: '[data-testid="pricing-heading"]' },
      { label: "Marketing Hub", path: "/marketing", anchor: '[data-testid="marketing-os-heading"]' },
      { label: "Integrations", path: "/integrations", anchor: '[data-testid="link-zapier"]' },
      { label: "About", path: "/about", anchor: '[data-testid="about-heading"]' },
    ];

    for (const t of navTargets) {
      test(`nav → ${t.path}`, async ({ page }) => {
        await page.goto(t.path);
        await expect(page.locator(t.anchor).first()).toBeVisible({ timeout: 15000 });
      });
    }
  });
});
