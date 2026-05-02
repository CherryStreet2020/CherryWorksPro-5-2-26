/**
 * E2E coverage for the ActiveFilterBar chips on the Reports page.
 *
 * Asserts that on each of the three reports tabs that wire a chip
 * (Profitability, Payout Detail, 1099 Export):
 *   1. No chip is visible while the date range is at the year-to-date defaults.
 *   2. Picking a non-default From/To date renders a chip with the formatted
 *      date-range label.
 *   3. Clicking the chip's clear button removes the chip and restores the
 *      date inputs to the year-start / today defaults.
 */
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";

const NON_DEFAULT_START = "2024-03-15";
const NON_DEFAULT_END = "2024-09-30";

const today = new Date().toISOString().split("T")[0];
const yearStart = `${today.slice(0, 4)}-01-01`;

function formatDateLabel(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
  await page.fill('[data-testid="input-password"]', ADMIN_PASS);
  await page.click('[data-testid="button-login"]');
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
}

async function exerciseChip(
  page: Page,
  filterBarTestId: string,
  chipId: string,
  fromTestId: string,
  toTestId: string,
) {
  const filterBar = page.locator(`[data-testid="${filterBarTestId}"]`);
  const chip = page.locator(`[data-testid="chip-${chipId}"]`);
  const clearButton = page.locator(`[data-testid="chip-${chipId}-clear"]`);

  // Defaults: chip + bar should be hidden (ActiveFilterBar returns null when
  // there are no chips).
  await expect(filterBar).toHaveCount(0);
  await expect(chip).toHaveCount(0);

  const fromInput = page.locator(`[data-testid="${fromTestId}"]`);
  const toInput = page.locator(`[data-testid="${toTestId}"]`);

  // Sanity: the inputs should currently equal the YTD defaults.
  await expect(fromInput).toHaveValue(yearStart);
  await expect(toInput).toHaveValue(today);

  await fromInput.fill(NON_DEFAULT_START);
  await toInput.fill(NON_DEFAULT_END);
  // Blur so the React onChange has definitely fired before we assert.
  await toInput.blur();

  const expectedLabel = `${formatDateLabel(NON_DEFAULT_START)} – ${formatDateLabel(NON_DEFAULT_END)}`;
  await expect(filterBar).toBeVisible();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(expectedLabel);

  await clearButton.click();

  await expect(chip).toHaveCount(0);
  await expect(filterBar).toHaveCount(0);
  await expect(fromInput).toHaveValue(yearStart);
  await expect(toInput).toHaveValue(today);
}

test.describe("Reports filter chips reset the date range", () => {
  test("Profitability, Payout Detail, and 1099 Export chips clear back to YTD defaults", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // --- Profitability tab (Operations category) ---
    await page.goto("/reports");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.click('[data-testid="category-operations"]');
    // Profitability is the default tab for admins/managers; ensure the
    // filter bar host has rendered before we exercise it.
    await expect(
      page.locator('[data-testid="input-profitability-start"]'),
    ).toBeVisible({ timeout: 10_000 });
    await exerciseChip(
      page,
      "filter-bar-profitability",
      "profitability-date-range",
      "input-profitability-start",
      "input-profitability-end",
    );

    // --- Payouts & Tax category: Payout Detail tab (default) ---
    await page.click('[data-testid="category-payouts"]');
    await expect(
      page.locator('[data-testid="input-payouts-start"]'),
    ).toBeVisible({ timeout: 10_000 });
    await exerciseChip(
      page,
      "filter-bar-payouts",
      "payouts-date-range",
      "input-payouts-start",
      "input-payouts-end",
    );

    // --- Payouts & Tax category: 1099 Export tab ---
    await page.getByRole("tab", { name: "1099 Export" }).click();
    await expect(
      page.locator('[data-testid="input-1099-start"]'),
    ).toBeVisible({ timeout: 10_000 });
    await exerciseChip(
      page,
      "filter-bar-export-1099",
      "export-1099-date-range",
      "input-1099-start",
      "input-1099-end",
    );
  });
});
