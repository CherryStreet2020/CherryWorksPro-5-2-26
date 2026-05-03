import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

test.describe("Clients — list CRUD + search/sort + detail-page delete (#440)", () => {
  test("create two clients, search narrows, sort toggles, stats render", async ({
    page,
    isolatedOrg,
  }) => {
    await loginIsolated(page, isolatedOrg);
    await page.goto("/clients");
    await expect(page.getByTestId("text-clients-title")).toBeVisible();

    const tag = `${Date.now().toString(36)}`;
    const aName = `Alpha ${tag}`;
    const bName = `Bravo ${tag}`;

    for (const n of [aName, bName]) {
      await page.getByTestId("button-add-client").click();
      await page.getByTestId("input-client-name").fill(n);
      await page
        .getByTestId("input-client-email")
        .fill(`${n.replace(/\s/g, "").toLowerCase()}@e2e.test`);
      await page.getByTestId("button-submit-client").click();
      await expect(
        page.locator('[data-testid^="row-client-"]', { hasText: n }),
      ).toHaveCount(1, { timeout: 10000 });
    }

    // Stat tiles render once we have rows.
    await expect(page.getByTestId("stat-total-clients")).toBeVisible();
    await expect(page.getByTestId("stat-active-clients")).toBeVisible();

    // Search narrows to the matching client only.
    await page.getByTestId("input-search-clients").fill(aName);
    await expect(
      page.locator('[data-testid^="row-client-"]', { hasText: aName }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid^="row-client-"]', { hasText: bName }),
    ).toHaveCount(0);

    // Clear search.
    await page.getByTestId("input-search-clients").fill("");
    await expect(
      page.locator('[data-testid^="row-client-"]', { hasText: aName }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid^="row-client-"]', { hasText: bName }),
    ).toHaveCount(1);

    // Sort by name asc → desc and assert ordering changed.
    const sortBtn = page.getByTestId("th-sort-name");
    await sortBtn.click();
    const namesAsc = await page
      .locator('[data-testid^="text-client-name-"]')
      .allTextContents();
    await sortBtn.click();
    const namesDesc = await page
      .locator('[data-testid^="text-client-name-"]')
      .allTextContents();
    expect(namesAsc.join("|")).not.toEqual(namesDesc.join("|"));
  });

  test("delete from detail page removes the row from the list", async ({
    page,
    isolatedOrg,
  }) => {
    // Seed a client via API so the test focuses on the delete flow.
    const create = await isolatedOrg.request.post("/api/clients", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `DeleteMe ${Date.now()}`, currency: "USD" },
    });
    expect(create.status(), await create.text()).toBeLessThan(400);
    const client = (await create.json()) as { id: string; name: string };

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/clients/${client.id}`);
    await expect(page.getByTestId("hero-client-name")).toBeVisible({
      timeout: 15000,
    });

    // Open the more-actions menu and click Delete.
    await page.getByTestId("button-more-actions").click();
    await page.getByTestId("button-delete-detail").click();

    // Confirm in the AlertDialog.
    await expect(page.getByTestId("button-confirm-delete")).toBeVisible({
      timeout: 5000,
    });
    await page.getByTestId("button-confirm-delete").click();

    // We should land back on /clients with no row for the deleted client.
    await page.waitForURL(/\/clients(?!\/)/, { timeout: 10000 });
    await expect(page.getByTestId(`row-client-${client.id}`)).toHaveCount(0, {
      timeout: 10000,
    });
  });

  test("client created via API is rendered in the /clients UI list", async ({
    page,
    isolatedOrg,
  }) => {
    // Seed a client via API so this test focuses on the list rendering path
    // (org scoping + cache hydration), then verify the row appears in the UI.
    const create = await isolatedOrg.request.post("/api/clients", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        name: `API Client ${Date.now()}`,
        email: "x@e2e.test",
        currency: "USD",
      },
    });
    expect(create.status(), await create.text()).toBeLessThan(400);
    const created = (await create.json()) as {
      id: string;
      orgId: string;
      name: string;
    };
    expect(created.orgId).toBe(isolatedOrg.orgId);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/clients");
    await expect(page.getByTestId(`row-client-${created.id}`)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByTestId(`text-client-name-${created.id}`),
    ).toContainText(created.name);
  });
});
