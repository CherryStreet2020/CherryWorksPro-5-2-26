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
    await expect(page.locator('[data-testid="announcement-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="hero-cta-start-free"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="section-home-marketing-os"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="cta-start-free-trial"]').first()).toBeVisible();
    expect(realErrors(errors), `home page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("hero dashboard mockup renders KPI showcase + revenue/team panels", async ({ page }) => {
    await page.goto("/");
    // KPI tiles inside the hero dashboard mockup (six labelled stats).
    for (const label of ["REVENUE MTD", "COLLECTED", "OUTSTANDING", "OVERDUE", "NET CASH", "TEAM"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 15000 });
    }
    // Concrete dollar values render (driven by component state, not just static labels).
    await expect(page.getByText("$47,850").first()).toBeVisible();
    await expect(page.getByText("$38,200").first()).toBeVisible();
    // Adjacent revenue trend + team utilization panels.
    await expect(page.getByText(/Revenue Trend/i).first()).toBeVisible();
    await expect(page.getByText(/Team Utilization/i).first()).toBeVisible();
  });

  test("feature/before-after sections render with comparison content", async ({ page }) => {
    await page.goto("/");
    // Before/after section
    await expect(page.getByText(/before/i).first()).toBeVisible({ timeout: 15000 });
    // "Why firms switch" feature pillars (FeatureGrid)
    const why = page.getByText(/Why firms switch/i).first();
    await why.scrollIntoViewIfNeeded();
    await expect(why).toBeVisible();
    // FeatureGrid pain/value tiles include the per-user cost narrative
    await expect(page.getByText(/Zero per-user fees/i).first()).toBeVisible();
    // Testimonial / what-firms-saying section
    const testi = page.getByText(/What firms are saying/i).first();
    await testi.scrollIntoViewIfNeeded();
    await expect(testi).toBeVisible();
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

  test("announcement-bar Features link navigates to /features", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('[data-testid="link-announcement-features"]').first();
    await expect(link).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/features(\?|$)/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('[data-testid="features-heading"]')).toBeVisible({ timeout: 15000 });
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

  test('hero secondary CTA "Explore the Full Platform" navigates to /features', async ({ page }) => {
    await page.goto("/");
    const secondary = page.getByRole("link", { name: /Explore the Full Platform/i }).first();
    await expect(secondary).toBeVisible({ timeout: 15000 });
    await Promise.all([
      page.waitForURL(/\/features(\?|$)/, { timeout: 15000 }),
      secondary.click(),
    ]);
    await expect(page.locator('[data-testid="features-heading"]')).toBeVisible({ timeout: 15000 });
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
      { label: /^Features$/, path: /\/features(\?|$)/, anchor: '[data-testid="features-heading"]' },
      { label: /^Tour$/, path: /\/demo(\?|$)/, anchor: '[data-testid="demo-section-dashboard"]' },
      { label: /^Compare$/, path: /\/compare(\?|$)/, anchor: '[data-testid="comparison-table"]' },
      { label: /^Pricing$/, path: /\/pricing(\?|$)/, anchor: '[data-testid="pricing-heading"]' },
      { label: /Marketing Hub/, path: /\/marketing(\?|$)/, anchor: '[data-testid="marketing-os-heading"]' },
      { label: /^Integrations$/, path: /\/integrations(\?|$)/, anchor: '[data-testid="link-zapier"]' },
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
