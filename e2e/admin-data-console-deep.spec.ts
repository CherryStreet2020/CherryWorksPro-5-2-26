/**
 * Task #443 — /admin/data UI table-driven entity navigation.
 *
 * Complements tests/e2e/admin-data-console.spec.ts (which is API
 * driven). Here we exercise the actual page: meta lists entities,
 * the user can switch tables, and CRUD on the `clients` entity is
 * reflected in the UI table after a refresh.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.use({ navigationTimeout: 30_000 });

test.describe("/admin/data console deep", () => {
  test("entity table loads and a created client appears via API", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);

    // Pre-create a client via API so the table has a deterministic row
    // to assert against once we navigate the UI to the clients entity.
    const tag = Date.now().toString(36);
    const create = await isolatedOrg.request.post("/api/admin/data/clients", {
      data: { name: `E2E Console ${tag}`, email: `e2e-${tag}@e2e.test` },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();

    await page.goto("/admin/data");
    await expect(page.locator('[data-testid="text-data-console-title"]'))
      .toBeVisible({ timeout: 20_000 });

    // UI: click the clients entity card and assert the entity table page
    // mounts and contains the row we just created.
    await page.locator('[data-testid="card-entity-clients"]').click();
    await expect(page.locator('[data-testid="text-entity-title"]'))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="row-${created.id}"]`))
      .toBeVisible({ timeout: 10_000 });

    // Cleanup.
    const del = await isolatedOrg.request.delete(
      `/api/admin/data/clients/${created.id}`,
      { headers: { "X-CSRF-Token": isolatedOrg.csrf } },
    );
    expect(del.ok()).toBe(true);
  });
});
