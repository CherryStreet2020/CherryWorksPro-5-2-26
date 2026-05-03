import { test, expect } from "../helpers/po/fixtures";
import { loginPageAsIso } from "./_helpers";

test.describe("Getting Started light mode regression", () => {
  test("h1 computed color is NOT white when not in dark mode", async ({
    isolatedOrg,
    page,
  }) => {
    await loginPageAsIso(page, isolatedOrg);

    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    });

    await page.goto("/getting-started");
    await page.waitForSelector('[data-testid="text-mission-control-title"]', {
      timeout: 15000,
    });

    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
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
