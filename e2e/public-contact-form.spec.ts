/**
 * Public /contact form — Task #442 step 5.
 *
 * Validates required fields, email format, successful submit
 * (POST /api/public/contact returns ok), success state render,
 * and absence of uncaught page errors.
 */
import { test, expect } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

test.describe("Public /contact form", () => {
  test("renders required fields and submit button", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.locator('[data-testid="input-contact-name"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="input-contact-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-contact-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-contact-submit"]')).toBeVisible();
  });

  test("client-side validation blocks empty submit", async ({ page }) => {
    await page.goto("/contact");
    const submit = page.locator('[data-testid="button-contact-submit"]');
    await submit.click();
    await expect(page.locator('[data-testid="error-contact-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-contact-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-contact-message"]')).toBeVisible();
  });

  test("invalid email surfaces field error", async ({ page }) => {
    await page.goto("/contact");
    await page.fill('[data-testid="input-contact-name"]', "Ada Lovelace");
    await page.fill('[data-testid="input-contact-email"]', "not-an-email");
    await page.fill('[data-testid="input-contact-message"]', "Hello there");
    await page.click('[data-testid="button-contact-submit"]');
    await expect(page.locator('[data-testid="error-contact-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-contact-name"]')).toHaveCount(0);
  });

  test("successful submit shows success state", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    // Intercept the network call so the test does not depend on an
    // actual SMTP transport being configured in the dev environment.
    await page.route("**/api/public/contact", async (route) => {
      const req = route.request();
      const body = JSON.parse(req.postData() || "{}");
      expect(body.name).toBe("Ada Lovelace");
      expect(body.email).toBe("ada@example.com");
      expect(body.message).toContain("Hello");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/contact");
    await page.fill('[data-testid="input-contact-name"]', "Ada Lovelace");
    await page.fill('[data-testid="input-contact-email"]', "ada@example.com");
    await page.fill(
      '[data-testid="input-contact-message"]',
      "Hello — testing the contact form.",
    );
    await page.click('[data-testid="button-contact-submit"]');

    await expect(page.getByText(/Message sent!/i)).toBeVisible({ timeout: 10000 });

    const real = errors.filter(
      (e) =>
        !/Failed to load resource.*40[13]/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(real, `contact page errors: ${real.join(" | ")}`).toEqual([]);
  });

  test("server error surfaces inline error banner", async ({ page }) => {
    await page.route("**/api/public/contact", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Boom" }),
      });
    });

    await page.goto("/contact");
    await page.fill('[data-testid="input-contact-name"]', "Grace Hopper");
    await page.fill('[data-testid="input-contact-email"]', "grace@example.com");
    await page.fill('[data-testid="input-contact-message"]', "Trigger 500 path");
    await page.click('[data-testid="button-contact-submit"]');

    await expect(page.getByText(/Boom/i)).toBeVisible({ timeout: 10000 });
    // Stays on the form, no success card
    await expect(page.getByText(/Message sent!/i)).toHaveCount(0);
  });
});
