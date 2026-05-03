/**
 * /services CRUD smoke (Task #431, audit §2.1 "Untested").
 *
 * Asserts:
 *  - Page renders for ADMIN
 *  - "Add service" form opens, validates a blank name, then creates
 *  - The new service appears in the active list
 *  - Cleanup: deactivate the created row
 */
import { test, expect } from "@playwright/test";
import { loginViaPage } from "../tests/helpers/po/auth";

test.describe("/services", () => {
  test("create + deactivate a service", async ({ page }) => {
    await loginViaPage(page);
    await page.goto("/services");

    const title = page.locator('[data-testid="text-services-title"]');
    const gate = page.locator("text=Mission Control").first();
    await expect(title.or(gate)).toBeVisible({ timeout: 15000 });
    if (await gate.isVisible().catch(() => false)) {
      test.skip(true, "AdminSetupGate active; see audit §6.1");
      return;
    }

    const name = `QA Service ${Date.now()}`;
    await page.click('[data-testid="button-add-service"]');
    // Submit blocked while name is blank.
    const submit = page.locator('[data-testid="button-submit-service"]');
    await expect(submit).toBeDisabled();

    await page.fill('[data-testid="input-service-name"]', name);
    await page.fill('[data-testid="input-service-rate"]', "175.50");
    await page.fill(
      '[data-testid="input-service-desc"]',
      "Created by Task #431 e2e",
    );
    await expect(submit).toBeEnabled();
    await submit.click();

    // The new row appears.
    const newRow = page
      .locator('[data-testid^="row-service-"]')
      .filter({ hasText: name });
    await expect(newRow).toBeVisible({ timeout: 10000 });

    // Cleanup — deactivate it.
    const rowTestId = await newRow.first().getAttribute("data-testid");
    if (rowTestId) {
      const id = rowTestId.replace("row-service-", "");
      await page
        .locator(`[data-testid="button-deactivate-${id}"]`)
        .click({ trial: false })
        .catch(() => undefined);
    }
  });
});
