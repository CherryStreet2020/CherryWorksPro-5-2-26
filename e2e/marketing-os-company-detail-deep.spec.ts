// Task #441 — Marketing OS audit §2.3: company-detail deep flows.
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — company-detail deep", () => {
  test("API — create → patch → link contact → soft-delete", async ({ isolatedOrg }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Co", slug: "co" });
    const company = await (await request.post(`${BASE}/api/marketing/companies`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, name: "Acme", domain: "acme.test",
        industry: "Software", sizeBand: "11-50", notes: "Init",
      },
    })).json();

    const patch = await request.patch(`${BASE}/api/marketing/companies/${company.id}`, {
      headers: HDRS(csrf),
      data: { name: "Acme (Updated)", industry: "SaaS" },
    });
    expect(patch.status()).toBe(200);
    expect((await patch.json()).name).toBe("Acme (Updated)");

    const linked = await (await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id, firstName: "Linked", lastName: "Lead",
        email: "linked@acme.test", companyId: company.id,
      },
    })).json();
    expect(linked.companyId).toBe(company.id);

    const del = await request.delete(
      `${BASE}/api/marketing/companies/${company.id}`,
      { headers: HDRS(csrf) },
    );
    expect(del.status()).toBe(200);
    const after = await request.get(`${BASE}/api/marketing/companies/${company.id}`);
    if (after.status() === 200) {
      expect((await after.json()).deletedAt).toBeTruthy();
    } else {
      expect(after.status()).toBe(404);
    }
  });

  test("UI — header renders fields + edit dialog renames the company", async ({
    page, isolatedOrg,
  }) => {
    test.setTimeout(45_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "UI Co", slug: "ui-co" });
    const company = await (await request.post(`${BASE}/api/marketing/companies`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "UI Acme", domain: "ui.test" },
    })).json();
    await loginIsolated(page, isolatedOrg);
    await page.goto(`/marketing/companies/${company.id}`);
    await expect(
      page.locator('[data-testid="text-company-name"]'),
    ).toContainText("UI Acme", { timeout: 15_000 });
    await expect(page.locator('[data-testid="text-domain"]')).toContainText("ui.test");
    await expect(page.locator('[data-testid="row-company-metrics"]')).toBeVisible();

    await page.click('[data-testid="button-edit"]');
    await expect(page.locator('[data-testid="dialog-edit-company"]')).toBeVisible();
    const newName = `UI Acme Renamed ${Date.now()}`;
    await page.fill('[data-testid="input-edit-name"]', newName);
    await page.click('[data-testid="button-submit-edit"]');
    await expect(
      page.locator('[data-testid="text-company-name"]'),
    ).toContainText("Renamed", { timeout: 15_000 });
  });
});
