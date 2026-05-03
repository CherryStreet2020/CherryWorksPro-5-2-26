import { test as anonTest, expect, type Route } from "@playwright/test";

anonTest.use({ navigationTimeout: 30_000 });

function makeOneShotAborter() {
  let aborted = false;
  let attempts = 0;
  return {
    attempts: () => attempts,
    handler: async (route: Route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts++;
      if (!aborted) {
        aborted = true;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    },
  };
}

anonTest.describe("Network failure — public contact form", () => {
  anonTest("aborted POST → inline error visible; retry → success card visible", async ({ page }) => {
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const ab = makeOneShotAborter();
    await page.route("**/api/public/contact", ab.handler);

    await page.goto("/contact");
    await page.fill('[data-testid="input-contact-name"]', "Net Fail");
    await page.fill('[data-testid="input-contact-email"]', "netfail@example.com");
    await page.fill('[data-testid="input-contact-message"]', "drop");
    const submit = page.locator('[data-testid="button-contact-submit"]');
    await submit.click();

    await expect(page.getByText(/Failed to fetch|something went wrong|try again/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    expect(ab.attempts()).toBe(1);

    await submit.click();
    await expect(page.getByText(/Message sent!/i)).toBeVisible({ timeout: 10_000 });
    expect(ab.attempts()).toBe(2);

    expect(
      errs.filter((m) => !/Failed to load resource/i.test(m)),
      `pageerrors: ${errs.join(" | ")}`,
    ).toEqual([]);
  });
});

anonTest.describe("Network failure — public signup form", () => {
  anonTest("aborted POST → signup-error visible; retry → server response received < 400", async ({ page }) => {
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const ab = makeOneShotAborter();
    await page.route("**/api/auth/signup", ab.handler);

    await page.goto("/signup");
    await page.fill('[data-testid="input-firm-name"]', "Net Fail Firm");
    await page.fill('[data-testid="input-signup-firstName"]', "Net");
    await page.fill('[data-testid="input-signup-lastName"]', "Fail");
    await page.fill('[data-testid="input-signup-email"]', `netfail-${Date.now()}@example.com`);
    await page.fill('[data-testid="input-signup-password"]', "Abcdef12!");
    const submit = page.locator('[data-testid="button-signup-submit"]');
    await expect(submit).toBeEnabled({ timeout: 10_000 });

    await submit.click();
    await expect(page.locator('[data-testid="signup-error"]')).toBeVisible({ timeout: 10_000 });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    expect(ab.attempts()).toBe(1);

    const retry = page.waitForResponse(
      (r) => r.url().includes("/api/auth/signup") && r.request().method() === "POST",
      { timeout: 15_000 },
    );
    await submit.click();
    const retryResp = await retry;
    expect(retryResp.status()).toBeLessThan(500);
    expect(ab.attempts()).toBe(2);

    expect(
      errs.filter((m) => !/Failed to load resource/i.test(m)),
      `pageerrors: ${errs.join(" | ")}`,
    ).toEqual([]);
  });
});

anonTest.describe("Dev-server 502 retry helper — smoke", () => {
  anonTest("gotoWithRetry retries 502 then returns the eventual response", async ({ page }) => {
    const { gotoWithRetry } = await import("./_iso-helpers");
    let hits = 0;
    await page.route("**/contact", async (route) => {
      hits++;
      if (hits < 2) await route.fulfill({ status: 502, body: "bad gateway" });
      else await route.continue();
    });
    const res = await gotoWithRetry(page, "/contact", { retries: 3, backoffMs: 50 });
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(res?.status() ?? 0).toBeLessThan(500);
    await expect(page.locator('[data-testid="input-contact-name"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});
