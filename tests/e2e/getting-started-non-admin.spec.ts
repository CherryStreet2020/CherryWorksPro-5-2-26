import { test, expect, type Page } from "@playwright/test";

/**
 * Regression coverage for #479: TEAM_MEMBER and MANAGER users on
 * /getting-started must see the non-admin "You're all set" panel,
 * not the empty admin Mission Control shell.
 */

const SEEDED = {
  ADMIN: { email: "admin.test@cwpro.dev", password: "admin123" },
  MANAGER: { email: "manager.test@cwpro.dev", password: "manager123" },
  TEAM_MEMBER: { email: "team.test@cwpro.dev", password: "team123" },
} as const;

async function loginViaForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
  await page.fill('[data-testid="input-email"]', email);
  await page.fill('[data-testid="input-password"]', password);
  await page.click('[data-testid="button-login"]');
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  // Defensive org-picker click — seeded users are single-org.
  const orgPick = page.locator('[data-testid^="button-org-pick-"]').first();
  try {
    await orgPick.waitFor({ state: "visible", timeout: 1500 });
    await orgPick.click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  } catch {
    /* single-org user */
  }
}

test.describe("Getting Started — non-admin regression (#479/#480)", () => {
  for (const role of ["TEAM_MEMBER", "MANAGER"] as const) {
    test(`${role} sees the non-admin panel, not the admin shell`, async ({ page }) => {
      const creds = SEEDED[role];
      await loginViaForm(page, creds.email, creds.password);

      await page.goto("/getting-started");

      await page.waitForSelector('[data-testid="getting-started-non-admin"]', {
        timeout: 15000,
      });
      await expect(page.locator('[data-testid="getting-started-non-admin"]')).toBeVisible();

      // Shipped non-admin copy is "You're all set, <FirstName>." —
      // task brief said "You're ready to go.", but that string lives
      // on the admin StepComplete recap.
      const greeting = page.locator('[data-testid="text-non-admin-greeting"]');
      await expect(greeting).toBeVisible();
      await expect(greeting).toContainText("You're all set");

      await expect(page.locator('[data-testid="button-go-dashboard"]')).toBeVisible();

      // Admin-only surfaces must NOT render for non-admins.
      await expect(page.locator('[data-testid="button-explore-advanced"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="text-mission-control-title"]')).toHaveCount(0);
    });
  }

  test("ADMIN sees Mission Control with all five Setup steps", async ({ page }) => {
    const creds = SEEDED.ADMIN;
    await loginViaForm(page, creds.email, creds.password);

    await page.goto("/getting-started");

    await page.waitForSelector('[data-testid="text-mission-control-title"]', {
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="text-mission-control-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="getting-started-non-admin"]')).toHaveCount(0);

    await expect(page.locator('[data-testid="text-greeting"]')).toBeVisible();
    await expect(page.locator('[data-testid="stat-setup-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-setup"]')).toBeVisible();

    const steps: { id: string; index: number; title: string }[] = [
      { id: "firm", index: 0, title: "Set Up Your Firm" },
      { id: "services", index: 1, title: "Define Your Services" },
      { id: "clients", index: 2, title: "Add Your First Client" },
      { id: "team", index: 3, title: "Build Your Team" },
      { id: "invoice", index: 4, title: "Send Your First Invoice" },
    ];

    // Seeded org may be on the active wizard OR on the completion
    // recap; both are admin-only surfaces and both must expose all
    // five Setup steps.
    const onRecap = (await page.locator('[data-testid="text-setup-complete"]').count()) > 0;

    if (onRecap) {
      for (const { id, title } of steps) {
        const row = page.locator(`[data-testid="recap-step-${id}"]`);
        await expect(row).toBeVisible();
        await expect(row).toContainText(title);
      }
    } else {
      await expect(page.locator('[data-testid="text-step-label"]')).toBeVisible();
      for (const { index } of steps) {
        await expect(page.locator(`[data-testid="progress-step-${index}"]`)).toBeVisible();
      }
      for (const { index, title } of steps) {
        await page.locator(`[data-testid="progress-step-${index}"]`).click();
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      }
    }
  });
});
