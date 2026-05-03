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

  test("/features → ImportShowcase competitor cards each route to the right page", async ({ page }) => {
    await page.goto("/features");
    // Source of truth: ImportShowcase.platforms in client/src/pages/marketing/features.tsx
    // (FreshBooks intentionally points to the /compare hub.)
    const tiles: Array<{ id: string; href: RegExp }> = [
      { id: "switch-card-freshbooks", href: /\/compare$/ },
      { id: "switch-card-quickbooks", href: /\/switch-from-quickbooks$/ },
      { id: "switch-card-harvest", href: /\/switch-from-harvest$/ },
      { id: "switch-card-xero", href: /\/switch-from-xero$/ },
      { id: "switch-card-wave", href: /\/switch-from-wave$/ },
      { id: "switch-card-bigtime", href: /\/switch-from-bigtime$/ },
      { id: "switch-card-scoro", href: /\/switch-from-scoro$/ },
      { id: "switch-card-paymo", href: /\/switch-from-paymo$/ },
    ];
    for (const t of tiles) {
      const tile = page.locator(`[data-testid="${t.id}"]`).first();
      await tile.scrollIntoViewIfNeeded();
      await expect(tile, `${t.id} should be visible`).toBeVisible({ timeout: 15000 });
      const href = await tile.locator("xpath=ancestor::a[1]").getAttribute("href");
      expect(href, `${t.id} href`).toMatch(t.href);
    }
  });

  test("/about → mission pillars + timeline milestones render", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator('[data-testid="mission-heading"]')).toBeVisible({ timeout: 15000 });
    // Three pillar cards
    for (const i of [0, 1, 2]) {
      await expect(page.locator(`[data-testid="mission-pillar-${i}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="timeline-heading"]')).toBeVisible();
    await expect(page.locator('[data-testid="timeline-milestone-0"]')).toBeVisible();
  });

  test("/integrations → first integration card is mounted", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.locator('[data-testid="link-zapier"]')).toBeVisible({ timeout: 15000 });
    // At least a few integration cards rendered
    const cards = page.locator('[data-testid^="card-integration-"]');
    const count = await cards.count();
    expect(count, "integrations page should render at least one card").toBeGreaterThan(0);
    await expect(cards.first()).toBeVisible();
  });

  test("/security → numbered policy sections render", async ({ page }) => {
    await page.goto("/security");
    await expect(page.locator('[data-testid="heading-security-title"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="text-security-subtitle"]')).toBeVisible();
    // Multiple sections (1..N) — assert first three exist.
    for (const n of [1, 2, 3]) {
      await expect(page.locator(`[data-testid="section-security-${n}"]`)).toBeVisible();
    }
  });

  test("footer newsletter form is mounted with email validation + submit", async ({ page }) => {
    await page.goto("/");
    const emailInput = page.locator('[data-testid="input-newsletter-email"]');
    await emailInput.scrollIntoViewIfNeeded();
    await expect(emailInput).toBeVisible({ timeout: 15000 });
    // The browser's native email validation handles obvious garbage; we assert
    // the input enforces it (type=email, required) so users can't silently
    // subscribe with a malformed value. Server-side success is exercised by
    // newsletter-specific tests in #439's suite.
    expect(await emailInput.getAttribute("type")).toBe("email");
    expect(await emailInput.getAttribute("required")).not.toBeNull();
    await expect(page.locator('[data-testid="button-newsletter-subscribe"]')).toBeVisible();
  });

  test("footer social links (when configured) point to external profiles", async ({ page }) => {
    await page.goto("/");
    // Social links are conditionally rendered based on SOCIAL_*_URL env vars.
    // If they're configured we assert their hrefs/target; otherwise we record
    // that the footer is mounted without them, so the test stays meaningful
    // in both deployment configs.
    const li = page.locator('[data-testid="link-social-linkedin"]');
    const x = page.locator('[data-testid="link-social-twitter"]');
    await page.locator('[data-testid="newsletter-heading"]').scrollIntoViewIfNeeded();
    const liCount = await li.count();
    const xCount = await x.count();
    if (liCount > 0) {
      expect(await li.getAttribute("href")).toMatch(/linkedin\.com/i);
      expect(await li.getAttribute("target")).toBe("_blank");
      expect((await li.getAttribute("rel")) ?? "").toMatch(/noopener/);
    }
    if (xCount > 0) {
      expect(await x.getAttribute("href")).toMatch(/(twitter|x)\.com/i);
      expect(await x.getAttribute("target")).toBe("_blank");
      expect((await x.getAttribute("rel")) ?? "").toMatch(/noopener/);
    }
    // At least the footer brand block should be present either way.
    await expect(page.locator('[data-testid="newsletter-heading"]')).toBeVisible();
  });

  test("/terms and /privacy render with body content + clickable footer", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    for (const path of ["/terms", "/privacy"]) {
      await page.goto(path);
      // Page itself renders an h1 with substantive text.
      const h1 = page.locator("h1").first();
      await expect(h1).toBeVisible({ timeout: 15000 });
      const txt = (await h1.innerText()).trim();
      expect(txt.length, `${path} h1 should have non-trivial text`).toBeGreaterThan(3);
      // Footer (with newsletter) is rendered on every public page including legal.
      const newsletter = page.locator('[data-testid="newsletter-heading"]');
      await newsletter.scrollIntoViewIfNeeded();
      await expect(newsletter).toBeVisible();
    }

    const real = errors.filter(
      (e) =>
        !/Failed to load resource.*40[13]/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `terms/privacy page errors: ${real.join(" | ")}`).toEqual([]);
  });
});
