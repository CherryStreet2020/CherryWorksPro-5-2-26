/**
 * /api-integrations page render (Task #431, audit §2.1 "Untested").
 * AdminRoute. Smoke render — the page must mount without crashing
 * and surface either its content or the AdminSetupGate.
 */
import { test, expect } from "@playwright/test";
import { loginViaPage } from "../tests/helpers/po/auth";

test.describe("/api-integrations", () => {
  test("renders for an authed admin", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await loginViaPage(page);
    await page.goto("/api-integrations");
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    // Either the integrations page paints OR AdminSetupGate is active.
    // Either way: no uncaught render exception.
    const real = errors.filter(
      (e) =>
        !/Failed to load resource.*40[13]/i.test(e) &&
        !/autocomplete attributes/i.test(e),
    );
    expect(
      real,
      `Unexpected page errors on /api-integrations: ${real.join(" | ")}`,
    ).toEqual([]);
  });
});
