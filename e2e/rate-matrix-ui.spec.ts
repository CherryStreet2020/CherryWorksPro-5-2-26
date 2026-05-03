import { test, expect } from "../tests/helpers/po/fixtures";
import { loginIsolated } from "./_iso-helpers";
import { createTeamMember } from "./_revenue-helpers";

async function seedProjectWithMemberAndService(iso: {
  request: import("@playwright/test").APIRequestContext;
  csrf: string;
  orgId: string;
}): Promise<{ projectId: string; userId: string; serviceId: string }> {
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

  const userId = await createTeamMember(iso.orgId);

  const memR = await iso.request.post(`/api/projects/${project.id}/members`, {
    headers: { "x-csrf-token": iso.csrf },
    data: { userId, hourlyRate: 100, costRateHourly: 50 },
  });
  expect(memR.status(), await memR.text()).toBeLessThan(400);

  const svcR = await iso.request.post("/api/services", {
    headers: { "x-csrf-token": iso.csrf },
    data: { name: `RM Svc ${Date.now()}`, defaultRate: "150" },
  });
  expect(svcR.status(), await svcR.text()).toBeLessThan(400);
  const service = (await svcR.json()) as { id: string };

  return { projectId: project.id, userId, serviceId: service.id };
}

test.describe("Rate Matrix UI — grid + inline edits + delete (#440)", () => {
  test("grid renders with member×service cells", async ({
    page,
    isolatedOrg,
  }) => {
    const { projectId, userId, serviceId } =
      await seedProjectWithMemberAndService(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/admin/rate-matrix/${projectId}`);
    await expect(page.getByTestId("rate-matrix-page")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("rate-matrix-table")).toBeVisible();
    await expect(page.getByTestId(`header-service-${serviceId}`)).toBeVisible();
    await expect(page.getByTestId(`row-member-${userId}`)).toBeVisible();
    await expect(page.getByTestId(`cell-${userId}-${serviceId}`)).toBeVisible();
  });

  test("inline edit blur saves bill+cost rate", async ({
    page,
    isolatedOrg,
  }) => {
    const { projectId, userId, serviceId } =
      await seedProjectWithMemberAndService(isolatedOrg);
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/admin/rate-matrix/${projectId}`);
    await expect(page.getByTestId(`cell-${userId}-${serviceId}`)).toBeVisible({
      timeout: 15000,
    });

    const saveResp = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/admin/rate-matrix/${projectId}/cell`) &&
        r.request().method() === "PUT",
      { timeout: 10000 },
    );
    await page.getByTestId(`input-bill-${userId}-${serviceId}`).fill("175.50");
    const costInput = page.getByTestId(`input-cost-${userId}-${serviceId}`);
    await costInput.fill("90");
    await costInput.blur();
    const putResp = await saveResp;
    expect(putResp.status(), await putResp.text()).toBeLessThan(400);

    // UI: the inputs retain the saved values after the refetch + re-render.
    await expect(
      page.getByTestId(`input-bill-${userId}-${serviceId}`),
    ).toHaveValue(/175\.5/, { timeout: 10000 });
    await expect(
      page.getByTestId(`input-cost-${userId}-${serviceId}`),
    ).toHaveValue(/90/);
    // The remove button only appears once a cell has a value — proves render path.
    await expect(
      page.getByTestId(`remove-${userId}-${serviceId}`),
    ).toBeAttached();

    await expect
      .poll(
        async () => {
          const r = await isolatedOrg.request.get(
            `/api/admin/rate-matrix/${projectId}`,
          );
          if (r.status() !== 200) return null;
          const data = (await r.json()) as {
            cells: Array<{
              userId: string;
              serviceId: string;
              billRate: string | null;
              costRate: string | null;
            }>;
          };
          const cell = data.cells.find(
            (c) => c.userId === userId && c.serviceId === serviceId,
          );
          if (!cell) return null;
          return {
            bill: cell.billRate == null ? null : Number(cell.billRate),
            cost: cell.costRate == null ? null : Number(cell.costRate),
          };
        },
        { timeout: 10000 },
      )
      .toEqual({ bill: 175.5, cost: 90 });
  });

  test("delete via remove button clears the cell value", async ({
    page,
    isolatedOrg,
  }) => {
    const { projectId, userId, serviceId } =
      await seedProjectWithMemberAndService(isolatedOrg);

    // Pre-seed a value via API so the remove button is rendered.
    const seed = await isolatedOrg.request.put(
      `/api/admin/rate-matrix/${projectId}/cell`,
      {
        headers: { "x-csrf-token": isolatedOrg.csrf },
        data: { userId, serviceId, billRate: 200, costRate: 100 },
      },
    );
    expect(seed.status(), await seed.text()).toBeLessThan(400);

    // Auto-accept window.confirm before navigating (covers both BeforeUnload-style
    // dialogs and the synchronous confirm() used by the remove button).
    page.on("dialog", (d) => d.accept().catch(() => undefined));
    await page.addInitScript(() => {
      window.confirm = () => true;
    });

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/admin/rate-matrix/${projectId}`);
    await expect(page.getByTestId(`cell-${userId}-${serviceId}`)).toBeVisible({
      timeout: 15000,
    });
    // Confirm the seeded value is reflected in the bill input.
    await expect(
      page.getByTestId(`input-bill-${userId}-${serviceId}`),
    ).toHaveValue(/200/, { timeout: 10000 });

    const removeBtn = page.getByTestId(`remove-${userId}-${serviceId}`);
    await expect(removeBtn).toBeAttached({ timeout: 10000 });
    const deleteReq = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/admin/rate-matrix/${projectId}/cell`) &&
        r.request().method() === "DELETE",
      { timeout: 10000 },
    );
    // Dispatch a synthetic click on the underlying button to bypass any
    // overlapping siblings (the loader spinner sits in the same absolute slot).
    await removeBtn.evaluate((el) => (el as HTMLElement).click());
    const resp = await deleteReq;
    expect(resp.status(), await resp.text()).toBeLessThan(400);

    // UI: the bill input clears and the remove button detaches (only rendered
    // when the cell has a value).
    await expect(
      page.getByTestId(`input-bill-${userId}-${serviceId}`),
    ).toHaveValue("", { timeout: 10000 });
    await expect(
      page.getByTestId(`remove-${userId}-${serviceId}`),
    ).toHaveCount(0);

    await expect
      .poll(
        async () => {
          const r = await isolatedOrg.request.get(
            `/api/admin/rate-matrix/${projectId}`,
          );
          if (r.status() !== 200) return null;
          const data = (await r.json()) as {
            cells: Array<{
              userId: string;
              serviceId: string;
              billRate: string | null;
            }>;
          };
          const cell = data.cells.find(
            (c) => c.userId === userId && c.serviceId === serviceId,
          );
          // Either the cell was removed entirely or its bill rate was cleared.
          if (!cell) return "removed";
          return cell.billRate == null ? "cleared" : "still-set";
        },
        { timeout: 10000 },
      )
      .not.toBe("still-set");
  });
});
