import { test, expect } from "../tests/helpers/po/fixtures";
import { addUserToIsolatedOrg } from "../tests/helpers/po/isolation";
import { loginIsolated } from "./_iso-helpers";
import { request as pwRequest } from "@playwright/test";

test.use({ navigationTimeout: 30_000 });

const BASE = process.env.E2E_BASE_URL || "http://localhost:5000";

async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  // Per-call X-Forwarded-For so the per-IP login limiter doesn't trip
  // across the role variants in this spec.
  const sourceIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
  const ctx = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "X-Forwarded-For": sourceIp },
  });
  try {
    const res = await ctx.post(`${BASE}/api/auth/login`, {
      data: { email, password },
    });
    if (res.status() !== 200) {
      throw new Error(`login as ${email} failed: ${res.status()}`);
    }
    const state = await ctx.storageState();
    if (state.cookies.length > 0) {
      await page.context().addCookies(state.cookies);
    }
  } finally {
    await ctx.dispose();
  }
}

test.describe("Dashboard role variants (isolated per-role sessions)", () => {
  test("ADMIN sees executive KPI deck (revenue/collected/outstanding/overdue/net-cash/team)", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/dashboard");
    await expect(page.locator('[data-testid="kpi-revenue"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="kpi-collected"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-outstanding"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-overdue"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-net-cash"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-team"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-revenue-trend"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-activity-feed"]')).toBeVisible();
  });

  test("MANAGER (same isolated org) inherits the admin executive dashboard surface", async ({ page, isolatedOrg }) => {
    const mgr = await addUserToIsolatedOrg(isolatedOrg.orgId, "MANAGER");
    await loginAs(page, mgr.email, mgr.password);
    await page.goto("/dashboard");
    await expect(page.locator('[data-testid="kpi-revenue"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="kpi-collected"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-outstanding"]')).toBeVisible();
  });

  test("TEAM_MEMBER (same isolated org) sees My Dashboard surface; exec KPI deck explicitly absent", async ({ page, isolatedOrg }) => {
    const tm = await addUserToIsolatedOrg(isolatedOrg.orgId, "TEAM_MEMBER");
    await loginAs(page, tm.email, tm.password);
    await page.goto("/dashboard");
    await expect(page.locator('[data-testid="text-dashboard-title"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="card-quick-actions"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-quick-log-time"]')).toBeVisible();
    await expect(page.locator('[data-testid="button-quick-profile"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-revenue"]')).toHaveCount(0);
  });

  test("ADMIN KPI drilldown opens dialog with title and closes via Escape", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/dashboard");
    await expect(page.locator('[data-testid="kpi-outstanding"]')).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="kpi-outstanding"]').click();
    await expect(page.locator('[data-testid="text-drilldown-title"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="text-drilldown-title"]')).toHaveText(/Outstanding/i);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="text-drilldown-title"]')).toHaveCount(0, { timeout: 5_000 });
  });
});
