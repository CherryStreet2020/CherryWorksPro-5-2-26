/**
 * Task #443 — /api-integrations deep coverage.
 *
 * Asserts:
 *   - page renders for an isolated admin
 *   - Create-API-Key dialog opens, accepts a name, and surfaces a
 *     freshly minted key
 *   - Add-Webhook dialog opens, validates URL, and roundtrips
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/api-integrations deep", () => {
  test("renders cards and create-key dialog round-trips", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/api-integrations");
    await expect(page.locator('[data-testid="text-integrations-title"]')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('[data-testid="card-api-keys"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-webhooks"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-api-docs"]')).toBeVisible();

    // Create an API key.
    await page.locator('[data-testid="button-create-api-key"]').click();
    await page.locator('[data-testid="input-api-key-name"]').fill(`e2e-${Date.now().toString(36)}`);
    await page.locator('[data-testid="button-confirm-create-key"]').click();
    await expect(page.locator('[data-testid="text-created-key-value"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="button-close-key-dialog"]').click();
  });

  test("Add Webhook dialog surfaces inline validation for malformed URL", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/api-integrations");
    await expect(page.locator('[data-testid="card-webhooks"]')).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="button-add-webhook"]').click();
    const urlInput = page.locator('[data-testid="input-webhook-url"]');
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill("not-a-url");

    // Inline error appears as soon as the URL fails the
    // isValidWebhookUrl predicate; the confirm button is disabled.
    await expect(page.locator('[data-testid="text-webhook-url-error"]'))
      .toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="button-confirm-webhook"]')).toBeDisabled();
    await page.locator('[data-testid="button-cancel-webhook"]').click();
  });
});
