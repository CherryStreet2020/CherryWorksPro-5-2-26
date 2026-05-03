/**
 * Task #443 — /admin/m365-rescope non-operator gate.
 *
 * The page is reachable for any authed user, but the body renders a
 * "Platform operators only" card unless the user's email is in the
 * PLATFORM_OPERATOR_EMAILS env allow-list. The isolated admin is NOT
 * on the allow-list, so the operator-required card MUST render.
 *
 * The positive (operator) path requires changing process env, which
 * the dev workflow doesn't expose to a single spec — that path is
 * covered by a follow-up task.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/admin/m365-rescope", () => {
  test("non-operator admin sees operator-required gate", async ({ page, isolatedOrg }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/admin/m365-rescope");
    await expect(page.locator('[data-testid="card-operator-required"]'))
      .toBeVisible({ timeout: 20_000 });
  });
});
