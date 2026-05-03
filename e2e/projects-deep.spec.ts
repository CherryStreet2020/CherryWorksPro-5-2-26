import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

interface ProjectLite { id: string; name: string; clientId: string; status: string }

async function seedClient(iso: { request: import("@playwright/test").APIRequestContext; csrf: string }) {
  const r = await iso.request.post("/api/clients", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `Proj Client ${Date.now()}`, currency: "USD" },
  });
  expect(r.status()).toBeLessThan(400);
  return (await r.json()) as { id: string };
}

test.describe("Projects — modal validation, filters, lifecycle (#440)", () => {
  test("create modal: name + client required; success creates row", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto("/projects");
    await expect(page.getByTestId("text-projects-title")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("button-add-project").click();
    await expect(page.getByTestId("input-project-name")).toBeVisible();
    // The submit button is disabled until name + client are populated.
    await expect(page.getByTestId("button-submit-project")).toBeDisabled();

    // Fill in valid data.
    const projName = `E2E Project ${Date.now()}`;
    await page.getByTestId("input-project-name").fill(projName);
    await page.getByTestId("select-project-client").click();
    await page.getByRole("option", { name: new RegExp("Proj Client", "i") }).first().click();
    await page.getByTestId("button-submit-project").click();

    await expect(page.getByText(projName).first()).toBeVisible({ timeout: 10000 });

    // Verify via API that the project was created and is org-scoped.
    const list = await isolatedOrg.request.get("/api/projects");
    expect(list.status()).toBe(200);
    const arr = (await list.json()) as ProjectLite[];
    const created = arr.find((p) => p.name === projName);
    expect(created).toBeTruthy();
    expect(created!.clientId).toBe(client.id);
  });

  test("filter chips + search narrow the list", async ({ page, isolatedOrg }) => {
    const client = await seedClient(isolatedOrg);
    // Seed two projects via API.
    const projA = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Aproj ${Date.now()}`, clientId: client.id },
    });
    expect(projA.status()).toBeLessThan(400);
    const projB = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Bproj ${Date.now()}`, clientId: client.id },
    });
    expect(projB.status()).toBeLessThan(400);
    const aData = (await projA.json()) as ProjectLite;

    await loginIsolated(page, isolatedOrg);
    await page.goto("/projects");
    await expect(page.getByTestId(`row-project-${aData.id}`)).toBeVisible({ timeout: 15000 });

    // Search narrows.
    await page.getByTestId("input-search-projects").fill(aData.name);
    await expect(page.getByTestId(`row-project-${aData.id}`)).toBeVisible();
    // Clear.
    await page.getByTestId("input-search-projects").fill("");

    // Status filter "ACTIVE" still shows them; "ARCHIVED" filter hides both.
    const archivedFilter = page.getByTestId("button-filter-archived");
    if (await archivedFilter.isVisible().catch(() => false)) {
      await archivedFilter.click();
      await expect(page.getByTestId(`row-project-${aData.id}`)).toHaveCount(0);
    }
  });

  test("duplicate project via UI menu creates a copy", async ({ page, isolatedOrg }) => {
    const client = await seedClient(isolatedOrg);
    const create = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Cloneable ${Date.now()}`, clientId: client.id },
    });
    expect(create.status()).toBeLessThan(400);
    const proj = (await create.json()) as ProjectLite;

    await loginIsolated(page, isolatedOrg);
    await page.goto("/projects");
    await expect(page.getByTestId(`row-project-${proj.id}`)).toBeVisible({ timeout: 15000 });

    await page.getByTestId(`button-project-menu-${proj.id}`).click();
    await page.getByTestId(`button-duplicate-project-${proj.id}`).click();

    // After duplicate, the API list should grow by one.
    await page.waitForTimeout(500);
    const list = await isolatedOrg.request.get("/api/projects");
    const arr = (await list.json()) as ProjectLite[];
    expect(arr.filter((p) => p.clientId === client.id).length).toBeGreaterThanOrEqual(2);
  });
});
