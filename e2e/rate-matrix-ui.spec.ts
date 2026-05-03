import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";
import { createTeamMember } from "./_revenue-helpers";

async function seedProjectWithMemberAndService(
  iso: {
    request: import("@playwright/test").APIRequestContext;
    csrf: string;
    orgId: string;
  },
): Promise<{ projectId: string; userId: string; serviceId: string }> {
  const cR = await iso.request.post("/api/clients", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `RM Client ${Date.now()}`, currency: "USD" },
  });
  expect(cR.status()).toBeLessThan(400);
  const client = (await cR.json()) as { id: string };

  const pR = await iso.request.post("/api/projects", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `RM Project ${Date.now()}`, clientId: client.id },
  });
  expect(pR.status()).toBeLessThan(400);
  const project = (await pR.json()) as { id: string };

  // Team member belonging to the iso org.
  const userId = await createTeamMember(iso.orgId);

  // Add member to the project.
  const memR = await iso.request.post(
    `/api/projects/${project.id}/members`,
    {
      headers: { "x-csrf-token": iso.csrf },
      data: { userId, hourlyRate: 100, costRateHourly: 50 },
    },
  );
  expect(memR.status(), await memR.text()).toBeLessThan(400);

  // Create a service.
  const svcR = await iso.request.post("/api/services", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `RM Svc ${Date.now()}`, defaultRate: "150" },
  });
  expect(svcR.status(), await svcR.text()).toBeLessThan(400);
  const service = (await svcR.json()) as { id: string };

  return { projectId: project.id, userId, serviceId: service.id };
}

test.describe("Rate Matrix UI — grid + inline edits + delete (#440)", () => {
  test("grid renders with member×service cells", async ({ page, isolatedOrg }) => {
    const { projectId, userId, serviceId } = await seedProjectWithMemberAndService(
      isolatedOrg,
    );
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/admin/rate-matrix/${projectId}`);
    await expect(page.getByTestId("rate-matrix-page")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("rate-matrix-table")).toBeVisible();
    await expect(page.getByTestId(`header-service-${serviceId}`)).toBeVisible();
    await expect(page.getByTestId(`row-member-${userId}`)).toBeVisible();
    await expect(page.getByTestId(`cell-${userId}-${serviceId}`)).toBeVisible();
  });

  test("inline edit blur saves bill+cost rate", async ({ page, isolatedOrg }) => {
    const { projectId, userId, serviceId } = await seedProjectWithMemberAndService(
      isolatedOrg,
    );
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/admin/rate-matrix/${projectId}`);
    await expect(page.getByTestId(`cell-${userId}-${serviceId}`)).toBeVisible({
      timeout: 15000,
    });

    const billInput = page.getByTestId(`input-bill-${userId}-${serviceId}`);
    await billInput.fill("175.50");
    const costInput = page.getByTestId(`input-cost-${userId}-${serviceId}`);
    await costInput.fill("90");
    await costInput.blur();

    // Wait for the save mutation to settle.
    await page.waitForTimeout(1000);

    // Verify via API.
    const r = await isolatedOrg.request.get(`/api/admin/rate-matrix/${projectId}`);
    expect(r.status()).toBe(200);
    const data = (await r.json()) as {
      cells: Array<{ userId: string; serviceId: string; billRate: string | null; costRate: string | null }>;
    };
    const cell = data.cells.find((c) => c.userId === userId && c.serviceId === serviceId);
    expect(cell).toBeTruthy();
    expect(Number(cell!.billRate)).toBeCloseTo(175.5, 2);
    expect(Number(cell!.costRate)).toBeCloseTo(90, 2);
  });

  test("delete cell via remove button clears values", async ({ page, isolatedOrg }) => {
    const { projectId, userId, serviceId } = await seedProjectWithMemberAndService(
      isolatedOrg,
    );

    // Pre-seed a value via API so the remove button appears.
    const seed = await isolatedOrg.request.put(
      `/api/admin/rate-matrix/${projectId}/cell`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { userId, serviceId, billRate: 200, costRate: 100 },
      },
    );
    expect(seed.status(), await seed.text()).toBeLessThan(400);

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/admin/rate-matrix/${projectId}`);
    await expect(page.getByTestId(`cell-${userId}-${serviceId}`)).toBeVisible({
      timeout: 15000,
    });

    // The page uses a confirm() dialog for remove — auto-accept.
    page.on("dialog", (d) => d.accept().catch(() => undefined));
    const removeBtn = page.getByTestId(`remove-${userId}-${serviceId}`);
    await expect(removeBtn).toBeVisible();
    // Click via JS to bypass any confirm() races with Playwright's dialog
    // listener (the `confirm` may fire before our handler is wired).
    await page.evaluate(
      ({ u, s }) => {
        const btn = document.querySelector(
          `[data-testid="remove-${u}-${s}"]`,
        ) as HTMLButtonElement | null;
        // Pre-stub confirm so click goes through synchronously.
        (window as any).confirm = () => true;
        btn?.click();
      },
      { u: userId, s: serviceId },
    );

    await page.waitForTimeout(1500);
    const r = await isolatedOrg.request.get(`/api/admin/rate-matrix/${projectId}`);
    const data = (await r.json()) as {
      cells: Array<{ userId: string; serviceId: string; billRate: string | null }>;
    };
    const cell = data.cells.find((c) => c.userId === userId && c.serviceId === serviceId);
    // Either the cell is gone (member end-dated), or its bill rate was
    // reset to null. Both are valid outcomes of the delete handler.
    if (cell) {
      expect(cell.billRate === null || cell.billRate === undefined).toBe(true);
    }
  });
});
