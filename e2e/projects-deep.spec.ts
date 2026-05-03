import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

interface ProjectLite {
  id: string;
  name: string;
  clientId: string;
  status: string;
}

async function seedClient(
  iso: { request: import("@playwright/test").APIRequestContext; csrf: string },
  label: string,
) {
  const r = await iso.request.post("/api/clients", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `${label} Client ${Date.now()}`, currency: "USD" },
  });
  expect(r.status()).toBeLessThan(400);
  return (await r.json()) as { id: string; name: string };
}

test.describe("Projects — modal validation, filters, lifecycle (#440)", () => {
  test("create modal: name + client required; success creates row", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg, "Proj");
    await loginIsolated(page, isolatedOrg);
    await page.goto("/projects");
    await expect(page.getByTestId("text-projects-title")).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId("button-add-project").click();
    await expect(page.getByTestId("input-project-name")).toBeVisible();
    // Submit button is disabled until name + client are populated.
    await expect(page.getByTestId("button-submit-project")).toBeDisabled();

    const projName = `E2E Project ${Date.now()}`;
    await page.getByTestId("input-project-name").fill(projName);
    await page.getByTestId("select-project-client").click();
    await page
      .getByRole("option", { name: new RegExp(client.name, "i") })
      .first()
      .click();
    await expect(page.getByTestId("button-submit-project")).toBeEnabled();
    await page.getByTestId("button-submit-project").click();

    await expect(
      page.locator('[data-testid^="row-project-"]', { hasText: projName }),
    ).toHaveCount(1, { timeout: 10000 });

    const list = await isolatedOrg.request.get("/api/projects");
    const arr = (await list.json()) as ProjectLite[];
    const created = arr.find((p) => p.name === projName);
    expect(created).toBeTruthy();
    expect(created!.clientId).toBe(client.id);
  });

  test("client filter narrows the list to a single client", async ({
    page,
    isolatedOrg,
  }) => {
    const c1 = await seedClient(isolatedOrg, "Filter1");
    const c2 = await seedClient(isolatedOrg, "Filter2");
    const p1 = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `One ${Date.now()}`, clientId: c1.id },
    });
    expect(p1.status()).toBeLessThan(400);
    const p2 = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Two ${Date.now()}`, clientId: c2.id },
    });
    expect(p2.status()).toBeLessThan(400);
    const proj1 = (await p1.json()) as ProjectLite;
    const proj2 = (await p2.json()) as ProjectLite;

    await loginIsolated(page, isolatedOrg);
    await page.goto("/projects");
    await expect(page.getByTestId(`row-project-${proj1.id}`)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId(`row-project-${proj2.id}`)).toBeVisible();

    // Use the client filter dropdown to narrow to c1 only.
    await page.getByTestId("select-client-filter").click();
    await page
      .getByRole("option", { name: new RegExp(c1.name, "i") })
      .first()
      .click();
    await expect(page.getByTestId(`row-project-${proj1.id}`)).toBeVisible();
    await expect(page.getByTestId(`row-project-${proj2.id}`)).toHaveCount(0);
  });

  test("status filter: archived button hides ACTIVE rows and reveals archived ones", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg, "Status");
    const a = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Active ${Date.now()}`, clientId: client.id },
    });
    expect(a.status()).toBeLessThan(400);
    const active = (await a.json()) as ProjectLite;

    const arch = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Archived ${Date.now()}`, clientId: client.id },
    });
    expect(arch.status()).toBeLessThan(400);
    const archived = (await arch.json()) as ProjectLite;
    // Archive the second project via API (lifecycle change).
    const patch = await isolatedOrg.request.patch(
      `/api/projects/${archived.id}`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { status: "ARCHIVED" },
      },
    );
    expect(patch.status()).toBeLessThan(400);

    await loginIsolated(page, isolatedOrg);
    await page.goto("/projects");
    // Default ALL filter shows both rows.
    await expect(page.getByTestId(`row-project-${active.id}`)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId(`row-project-${archived.id}`)).toBeVisible();

    // Click ACTIVE filter — archived row disappears.
    await page.getByTestId("button-filter-active").click();
    await expect(page.getByTestId(`row-project-${active.id}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId(`row-project-${archived.id}`)).toHaveCount(0);

    // Switch to archived filter — assertions flip.
    await page.getByTestId("button-filter-archived").click();
    await expect(page.getByTestId(`row-project-${archived.id}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId(`row-project-${active.id}`)).toHaveCount(0);
  });

  test("duplicate via row menu produces a sibling project", async ({
    page,
    isolatedOrg,
  }) => {
    const client = await seedClient(isolatedOrg, "Clone");
    const create = await isolatedOrg.request.post("/api/projects", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Cloneable ${Date.now()}`, clientId: client.id },
    });
    expect(create.status()).toBeLessThan(400);
    const proj = (await create.json()) as ProjectLite;

    await loginIsolated(page, isolatedOrg);
    await page.goto("/projects");
    await expect(page.getByTestId(`row-project-${proj.id}`)).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId(`button-project-menu-${proj.id}`).click();
    await page.getByTestId(`button-duplicate-project-${proj.id}`).click();

    // UI: a sibling row appears with the cloned name `${name} (Copy)`
    // (server/storage.ts duplicateProject).
    await expect(
      page.locator('[data-testid^="row-project-"]', {
        hasText: `${proj.name} (Copy)`,
      }),
    ).toHaveCount(1, { timeout: 10000 });
    // The original row is still present.
    await expect(page.getByTestId(`row-project-${proj.id}`)).toBeVisible();
  });
});
