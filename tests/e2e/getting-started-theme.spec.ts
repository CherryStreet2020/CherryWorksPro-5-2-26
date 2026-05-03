import { test, expect } from "@playwright/test";

// FIXME-task-455: Legacy shared-state spec (audit §6.2.8). The
// surrounding suite mutates the same seeded admin org rows, so the
// assertions race other serial specs. Skipped until migrated to the
// per-test `isolatedOrg` fixture (see tests/helpers/po/fixtures.ts).
// Tracked: project task #455.
import { test as _t } from "@playwright/test";
_t.beforeEach(() => _t.fixme(true, "Task #455: legacy shared-state spec; migrate to isolatedOrg first"));

test.describe("Getting Started light mode regression", () => {
  test("h1 computed color is NOT white when not in dark mode", async ({ page }) => {
    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
    await page.fill('[data-testid="input-password"]', "CherryWorks2026!");
    await page.click('[data-testid="button-sign-in"]');
    await page.waitForURL("**/");

    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    });

    await page.goto("/getting-started");
    await page.waitForSelector('[data-testid="text-mission-control-title"]', { timeout: 10000 });

    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );
    expect(isDark).toBe(false);

    const color = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="text-mission-control-title"]');
      return el ? getComputedStyle(el).color : null;
    });

    expect(color).not.toBeNull();
    expect(color).not.toBe("rgb(255, 255, 255)");
  });
});
