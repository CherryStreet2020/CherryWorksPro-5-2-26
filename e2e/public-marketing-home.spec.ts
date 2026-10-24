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
  test("renders hero, nav, and the four pillars without page errors", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await expect(page.locator('[data-testid="marketing-nav"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="announcement-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="home-h1"]')).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator('[data-testid="hero-cta-signup"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="section-pillars"]').first()).toBeVisible();
    for (const pillar of ["time-billing", "books", "team-payouts", "client-support"]) {
      await expect(page.locator(`[data-testid="pillar-${pillar}"]`)).toBeVisible();
    }
    expect(realErrors(errors), `home page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("hero product screenshot loads and the workflow shows four steps", async ({ page }) => {
    await page.goto("/");
    const shot = page.locator('[data-testid="hero-screenshot"] img').first();
    await expect(shot).toBeVisible({ timeout: 15000 });
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    for (let i = 1; i <= 4; i++) {
      await expect(page.locator(`[data-testid="workflow-step-${i}"]`)).toBeVisible();
    }
  });

  test("seat calculator compares per-user pricing with the flat Professional price", async ({ page }) => {
    await page.goto("/");
    const calc = page.locator('[data-testid="seat-calculator"]');
    await calc.scrollIntoViewIfNeeded();
    // Defaults: 8 people at $15 a user is $120 against $89 flat.
    await expect(page.locator('[data-testid="calc-team-value"]')).toHaveText("8");
    await expect(page.locator('[data-testid="calc-result"]')).toContainText("$120");
    await expect(page.locator('[data-testid="calc-result"]')).toContainText("$89");
    await expect(page.locator('[data-testid="calc-verdict"]')).toContainText("$31 a month");
    await expect(page.locator('[data-testid="calc-verdict"]')).toContainText("$372 a year");

    // A cheap per-user tool at a small team: the page says so and names the break-even point.
    await page.locator('[data-testid="input-calc-seat"]').fill("10");
    // Drive the slider the way a person would; React does not see a value set directly on a range input.
    await page.locator('[data-testid="input-calc-team"]').focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    await expect(page.locator('[data-testid="calc-team-value"]')).toHaveText("3");
    await expect(page.locator('[data-testid="calc-verdict"]')).toContainText("per-user pricing costs less");
    await expect(page.locator('[data-testid="calc-verdict"]')).toContainText("at 9 people");

    await page.locator('[data-testid="input-calc-seat"]').fill("");
    await expect(page.locator('[data-testid="calc-verdict"]')).toContainText("Enter your per-user price");
  });

  test("support spotlight links to Client Support and the FAQ expands", async ({ page }) => {
    await page.goto("/");
    const support = page.locator('[data-testid="section-support"]');
    await support.scrollIntoViewIfNeeded();
    await expect(support).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/client-support(\?|$)/, { timeout: 15000 }),
      page.locator('[data-testid="link-home-client-support"]').click(),
    ]);
    await expect(page.locator('[data-testid="client-support-h1"]')).toBeVisible({ timeout: 15000 });

    await page.goto("/");
    const faq = page.locator('[data-testid="faq-0"]');
    await faq.scrollIntoViewIfNeeded();
    await faq.locator("summary").click();
    await expect(faq).toHaveAttribute("open", "");
  });

  test("nav exposes Log In + Start Free Trial CTAs that route correctly", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator('[data-testid="marketing-nav"]');
    await expect(nav).toBeVisible({ timeout: 15000 });

    // Log In → /login
    const login = nav.getByRole("link", { name: /Log In/i }).first();
    await expect(login).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/login(\?|$)/, { timeout: 15000 }),
      login.click(),
    ]);

    // Back to home, then Start Free Trial → /signup
    await page.goto("/");
    const startTrial = page.locator('[data-testid="marketing-nav"]').getByRole("link", { name: /Start Free Trial/i }).first();
    await expect(startTrial).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      startTrial.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("announcement-bar link navigates to the Harvest switch page", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('[data-testid="link-announcement"]').first();
    await expect(link).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/switch-from-harvest(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="switch-h1"]')).toBeVisible({ timeout: 15000 });
  });

  test("hero Start Free CTA navigates to /signup", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator('[data-testid="hero-cta-signup"]').first();
    await expect(cta).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  test("hero tour CTA navigates to /tour", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator('[data-testid="hero-cta-tour"]').first();
    await expect(cta).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/tour(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="demo-heading"]')).toBeVisible({ timeout: 15000 });
  });

  test("import chip navigates to its switch page", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator('[data-testid="link-import-quickbooks"]');
    await chip.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/switch-from-quickbooks(\?|$)/, { timeout: 15000 }),
      chip.click(),
    ]);
    await expect(page.locator('[data-testid="switch-h1"]')).toBeVisible({ timeout: 15000 });
  });

  test("final-section Start Your Free Trial CTA navigates to /signup", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator('[data-testid="cta-start-free-trial"]').first();
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/signup(\?|$)/, { timeout: 15000 }),
      cta.click(),
    ]);
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({ timeout: 15000 });
  });

  // Verify nav by *clicking* the visible nav links from `/`, not by goto-ing each
  // path directly. This catches breakage in the nav itself (wrong href, hidden
  // link on desktop, etc.), which goto-only checks would miss.
  test.describe("Marketing nav links — actual click from home", () => {
    const navTargets: Array<{ label: RegExp; path: RegExp; anchor: string }> = [
      { label: /^Product$/, path: /\/features(\?|$)/, anchor: '[data-testid="features-heading"]' },
      { label: /^Tour$/, path: /\/tour(\?|$)/, anchor: '[data-testid="demo-heading"]' },
      { label: /^Client Support$/, path: /\/client-support(\?|$)/, anchor: '[data-testid="client-support-h1"]' },
      { label: /^Pricing$/, path: /\/pricing(\?|$)/, anchor: '[data-testid="pricing-heading"]' },
      { label: /^Compare$/, path: /\/compare(\?|$)/, anchor: '[data-testid="comparison-table"]' },
      { label: /^About$/, path: /\/about(\?|$)/, anchor: '[data-testid="about-heading"]' },
    ];

    for (const t of navTargets) {
      test(`nav click → ${t.path}`, async ({ page }) => {
        await page.goto("/");
        const nav = page.locator('[data-testid="marketing-nav"]');
        await expect(nav).toBeVisible({ timeout: 15000 });
        // Scope to the desktop nav region; pick the first matching link inside.
        const link = nav.getByRole("link", { name: t.label }).first();
        await expect(link).toBeVisible();
        await Promise.all([
          page.waitForURL(t.path, { timeout: 15000 }),
          link.click(),
        ]);
        await expect(page.locator(t.anchor).first()).toBeVisible({ timeout: 15000 });
      });
    }
  });
});
