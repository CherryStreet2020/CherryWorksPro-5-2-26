import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";

async function seedProject(iso: { request: import("@playwright/test").APIRequestContext; csrf: string }) {
  const cR = await iso.request.post("/api/clients", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `PD Client ${Date.now()}`, currency: "USD" },
  });
  expect(cR.status()).toBeLessThan(400);
  const client = (await cR.json()) as { id: string };
  const pR = await iso.request.post("/api/projects", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `PD Project ${Date.now()}`, clientId: client.id },
  });
  expect(pR.status()).toBeLessThan(400);
  return (await pR.json()) as { id: string; clientId: string; name: string };
}

test.describe("Project detail — tabs + archive/clone (#440)", () => {
  test("renders all detail tabs without crash", async ({ page, isolatedOrg }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("project-detail-page")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("text-project-name")).toBeVisible();

    for (const tabId of ["time-tracking", "invoices", "estimates", "services", "members"]) {
      const t = page.getByTestId(`tab-${tabId}`);
      if (await t.isVisible().catch(() => false)) {
        await t.click();
        await expect(page.getByTestId("project-detail-page")).toBeVisible();
      }
    }
  });

  test("rate-matrix link navigates to /admin/rate-matrix/:projectId", async ({
    page,
    isolatedOrg,
  }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("button-rate-matrix")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("button-rate-matrix").click();
    await expect(page).toHaveURL(new RegExp(`/admin/rate-matrix/${project.id}$`));
    await expect(page.getByTestId("rate-matrix-page")).toBeVisible({ timeout: 15000 });
  });

  test("archive via more-actions menu sets status to ARCHIVED", async ({
    page,
    isolatedOrg,
  }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("project-detail-page")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("button-more-actions").click();
    await page.getByTestId("menu-archive-project").click();

    // Verify via API that the status is now ARCHIVED.
    await page.waitForTimeout(500);
    const r = await isolatedOrg.request.get(`/api/projects/${project.id}`);
    expect(r.status()).toBe(200);
    const fresh = (await r.json()) as { project?: { status?: string }; status?: string };
    const status = fresh.project?.status ?? fresh.status;
    expect(status).toBe("ARCHIVED");
  });

  test("duplicate from menu produces a sibling project", async ({
    page,
    isolatedOrg,
  }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("project-detail-page")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("button-more-actions").click();
    await page.getByTestId("menu-duplicate-project").click();

    await page.waitForTimeout(500);
    const list = await isolatedOrg.request.get("/api/projects");
    const arr = (await list.json()) as Array<{ clientId: string }>;
    expect(arr.filter((p) => p.clientId === project.clientId).length).toBeGreaterThanOrEqual(2);
  });
});
