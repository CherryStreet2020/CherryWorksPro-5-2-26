import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";
import { createTeamMember } from "./_revenue-helpers";

async function seedProject(iso: {
  request: import("@playwright/test").APIRequestContext;
  csrf: string;
  orgId: string;
}) {
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

test.describe("Project detail — tabs + member/service + archive/clone (#440)", () => {
  test("each tab renders its own panel content", async ({ page, isolatedOrg }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("project-detail-page")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("text-project-name")).toBeVisible();

    // The hours-logged panel is part of the default tab.
    await page.getByTestId("tab-hours-logged").click();
    await expect(page.getByTestId("panel-hours-logged")).toBeVisible();
    await expect(page.getByTestId("text-total-hours")).toBeVisible();

    // Time-tracking tab — search input is unique to that tab.
    await page.getByTestId("tab-time-tracking").click();
    await expect(page.getByTestId("input-search-entries")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("button-add-time-entry")).toBeVisible();

    // Invoices tab — empty-state is shown for a brand-new project.
    await page.getByTestId("tab-invoices").click();
    await expect(page.getByText("No invoices").first()).toBeVisible({
      timeout: 10000,
    });

    // Estimates tab — empty-state copy is unique to this tab.
    await page.getByTestId("tab-estimates").click();
    await expect(page.getByText("No estimates").first()).toBeVisible({
      timeout: 10000,
    });

    // Services tab — assign-service button.
    await page.getByTestId("tab-services").click();
    await expect(page.getByTestId("button-assign-service")).toBeVisible({
      timeout: 10000,
    });

    // Members tab — add-member button.
    await page.getByTestId("tab-members").click();
    await expect(page.getByTestId("button-add-member")).toBeVisible({
      timeout: 10000,
    });
  });

  test("members tab: add a member via UI form", async ({ page, isolatedOrg }) => {
    const project = await seedProject(isolatedOrg);
    const userId = await createTeamMember(isolatedOrg.orgId);

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await page.getByTestId("tab-members").click();
    await page.getByTestId("button-add-member").click();
    await expect(page.getByTestId("add-member-form")).toBeVisible();

    await page.getByTestId("select-add-member").click();
    await page.getByTestId(`option-member-${userId}`).click();
    await page.getByTestId("input-member-bill-rate").fill("125");
    await page.getByTestId("input-member-cost-rate").fill("60");
    await page.getByTestId("button-confirm-add-member").click();

    await expect(page.getByTestId(`member-row-${userId}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByTestId(`text-member-cost-rate-${userId}`),
    ).toContainText("60");
  });

  test("services tab: assign a service via UI form", async ({
    page,
    isolatedOrg,
  }) => {
    const project = await seedProject(isolatedOrg);
    const svcR = await isolatedOrg.request.post("/api/services", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { name: `Svc ${Date.now()}`, defaultRate: "200" },
    });
    expect(svcR.status()).toBeLessThan(400);
    const svc = (await svcR.json()) as { id: string; name: string };

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await page.getByTestId("tab-services").click();
    await page.getByTestId("button-assign-service").click();
    await expect(page.getByTestId("assign-service-form")).toBeVisible();

    await page.getByTestId("select-assign-service").click();
    await page
      .getByRole("option", { name: new RegExp(svc.name, "i") })
      .first()
      .click();
    await page.getByTestId("button-confirm-assign-service").click();

    await expect(page.getByTestId(`assigned-service-${svc.id}`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("rate-matrix link navigates to /admin/rate-matrix/:projectId", async ({
    page,
    isolatedOrg,
  }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("button-rate-matrix")).toBeVisible({
      timeout: 15000,
    });
    await page.getByTestId("button-rate-matrix").click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/rate-matrix/${project.id}$`),
    );
    await expect(page.getByTestId("rate-matrix-page")).toBeVisible({
      timeout: 15000,
    });
  });

  test("archive via more-actions menu sets status to ARCHIVED", async ({
    page,
    isolatedOrg,
  }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("project-detail-page")).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId("button-more-actions").click();
    await page.getByTestId("menu-archive-project").click();

    // UI: the hero StatusBadge flips to "Archived".
    await expect(page.getByTestId("badge-status-archived")).toBeVisible({
      timeout: 10000,
    });
    // Backend invariant.
    await expect
      .poll(
        async () => {
          const r = await isolatedOrg.request.get(
            `/api/projects/${project.id}`,
          );
          if (r.status() !== 200) return null;
          const fresh = (await r.json()) as {
            project?: { status?: string };
            status?: string;
          };
          return fresh.project?.status ?? fresh.status ?? null;
        },
        { timeout: 10000 },
      )
      .toBe("ARCHIVED");
  });

  test("duplicate from menu produces a sibling project", async ({
    page,
    isolatedOrg,
  }) => {
    const project = await seedProject(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByTestId("project-detail-page")).toBeVisible({
      timeout: 15000,
    });

    const dupResp = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/projects/${project.id}/duplicate`) &&
        r.request().method() === "POST",
      { timeout: 10000 },
    );
    await page.getByTestId("button-more-actions").click();
    await page.getByTestId("menu-duplicate-project").click();
    const r = await dupResp;
    expect(r.status(), await r.text()).toBeLessThan(400);

    // UI: navigate to the projects list and confirm the cloned row appears.
    // The server names the clone `${original.name} (Copy)` (server/storage.ts
    // duplicateProject).
    await page.goto("/projects");
    await expect(
      page.locator('[data-testid^="row-project-"]', {
        hasText: `${project.name} (Copy)`,
      }),
    ).toHaveCount(1, { timeout: 10000 });
  });
});
