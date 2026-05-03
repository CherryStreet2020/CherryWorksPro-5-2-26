/**
 * Feature-flag coherence smoke for the `marketing_os` entitlement
 * (Task #431, audit §3.4).
 *
 * The env-level `MARKETING_OS_ENABLED` kill switch is not flipped at
 * spec time (would require restarting the dev server); we instead
 * verify the *per-org entitlement* coherence contract: whatever
 * `/api/me/entitlements` reports for `marketing_os` must agree with
 * whether `/marketing/contacts` renders the page or the locked card.
 */
import { test, expect } from "@playwright/test";
import { BASE, loginApi, loginViaPage } from "../tests/helpers/po/auth";

test.describe("marketing_os entitlement coherence", () => {
  test("API entitlement state matches UI surface", async ({
    request,
    page,
  }) => {
    await loginApi(request);
    const entR = await request.get(`${BASE}/api/me/entitlements`);
    expect(entR.status()).toBe(200);
    const ent = await entR.json();
    const marketingOn = Boolean(ent?.marketing_os ?? ent?.marketingOs);

    await loginViaPage(page);
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    if (marketingOn) {
      // Page should render some marketing-OS-specific anchor; tolerate
      // the AdminSetupGate edge if the test admin isn't fully set up.
      const lock = page.locator("text=Marketing OS").first();
      await expect(lock).toBeVisible({ timeout: 15000 });
    } else {
      // The locked card or 404-stealth surface must appear; the page
      // must NOT render the contacts CRUD UI.
      const contactsForm = page.locator(
        '[data-testid="button-add-contact"], [data-testid="input-contact-search"]',
      );
      expect(await contactsForm.count()).toBe(0);
    }
  });
});
