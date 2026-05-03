import { test, expect } from "../tests/helpers/po/fixtures";
import { addUserToIsolatedOrg } from "../tests/helpers/po/isolation";
import { loginIsolated, gotoWithRetry } from "./_iso-helpers";
import { request as pwRequest, type Page } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

const BASE = `http://localhost:${process.env.PORT || 5000}`;

async function loginAs(page: Page, email: string, password: string) {
  const sourceIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
  const ctx = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "X-Forwarded-For": sourceIp },
  });
  try {
    const res = await ctx.post(`${BASE}/api/auth/login`, { data: { email, password } });
    if (res.status() !== 200) throw new Error(`login as ${email} failed: ${res.status()}`);
    const state = await ctx.storageState();
    if (state.cookies.length > 0) await page.context().addCookies(state.cookies);
  } finally {
    await ctx.dispose();
  }
}

test.describe("Error surfaces — organic triggers", () => {
  test("403: TEAM_MEMBER on /admin/data renders Access Denied", async ({ page, isolatedOrg }) => {
    const tm = await addUserToIsolatedOrg(isolatedOrg.orgId, "TEAM_MEMBER");
    await loginAs(page, tm.email, tm.password);
    await gotoWithRetry(page, "/admin/data");
    const title = page.locator('[data-testid="text-error-title"]');
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText(/Access Denied/i);
    await expect(page.locator('[data-testid="link-back-to-dashboard"]')).toBeVisible();
  });

  test("404: unknown route renders Page Not Found", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, `/totally-bogus-${Date.now()}`);
    const title = page.locator('[data-testid="text-error-title"]');
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText(/Page Not Found/i);
  });

  test("500: render-time throw in /__e2e_crash triggers ErrorBoundary fallback", async ({
    page,
    isolatedOrg,
  }) => {
    const consoleErrs: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text());
    });
    await loginIsolated(page, isolatedOrg);
    await gotoWithRetry(page, "/__e2e_crash");
    const title = page.locator('[data-testid="text-error-title"]');
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveText(/Something Went Wrong/i);
    await expect(page.locator('[data-testid="button-reload"]')).toBeVisible();
    expect(
      consoleErrs.some((m) => m.includes("[ErrorBoundary] Caught error")),
      `expected ErrorBoundary to log the caught error; got: ${consoleErrs.join(" | ")}`,
    ).toBe(true);
  });
});
