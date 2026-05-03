/**
 * /expenses page render + create form smoke
 * (Task #431, audit §2.1 "Untested").
 *
 * The full OCR flow (Groq + Tesseract fallback) is intentionally NOT
 * exercised here — it requires real LLM credentials and is captured
 * as a deferred follow-up in the coverage report.
 */
import { test, expect } from "@playwright/test";
import { loginViaPage } from "../tests/helpers/po/auth";

test.describe("/expenses", () => {
  test("renders the expenses page and opens the create form", async ({
    page,
  }) => {
    await loginViaPage(page);
    await page.goto("/expenses");

    const title = page.locator('[data-testid="text-expenses-title"]');
    const gate = page.locator("text=Mission Control").first();
    await expect(title.or(gate)).toBeVisible({ timeout: 15000 });
    if (await gate.isVisible().catch(() => false)) {
      test.skip(true, "AdminSetupGate active; see audit §6.1");
      return;
    }

    await page.click('[data-testid="button-new-expense"]');
    await expect(
      page.locator('[data-testid="input-expense-vendor"]'),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('[data-testid="input-expense-amount"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="select-expense-category"]'),
    ).toBeVisible();
  });
});
