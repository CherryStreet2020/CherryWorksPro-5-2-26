import { test, expect } from "../helpers/po/fixtures";
import { postJson, patchJson, delReq, loginPageAsIso, loginIsoTeamMember } from "./_helpers";

test("admin data console: list entities, CRUD client, view independent payouts", async ({
  isolatedOrg,
}) => {
  const metaRes = await isolatedOrg.request.get("/api/admin/data/entities");
  expect(metaRes.ok()).toBeTruthy();
  const meta = await metaRes.json();
  expect(meta.editable.length).toBeGreaterThan(0);
  expect(meta.editable).toContain("clients");
  expect(meta.editable).toContain("imported_payouts");
  expect(meta.viewOnly).toContain("audit_logs");
  expect(meta.viewOnly).toContain("imported_keys");

  const clientsListRes = await isolatedOrg.request.get(
    "/api/admin/data/clients?limit=10&offset=0",
  );
  expect(clientsListRes.ok()).toBeTruthy();
  const clientsList = await clientsListRes.json();
  expect(clientsList).toHaveProperty("rows");
  expect(clientsList).toHaveProperty("total");
  expect(Array.isArray(clientsList.rows)).toBe(true);

  const uniqueSuffix = Date.now().toString(36);
  const createRes = await postJson(isolatedOrg, "/api/admin/data/clients", {
    name: `E2E Console Client ${uniqueSuffix}`,
    email: `e2e-console-${uniqueSuffix}@iso-test.com`,
    phone: "555-0199",
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json();
  expect(created.id).toBeTruthy();
  expect(created.name).toBe(`E2E Console Client ${uniqueSuffix}`);

  const getRes = await isolatedOrg.request.get(`/api/admin/data/clients/${created.id}`);
  expect(getRes.ok()).toBeTruthy();
  const fetched = await getRes.json();
  expect(fetched.name).toBe(`E2E Console Client ${uniqueSuffix}`);

  const updateRes = await patchJson(isolatedOrg, `/api/admin/data/clients/${created.id}`, {
    phone: "555-9999",
  });
  expect(updateRes.ok()).toBeTruthy();
  const updated = await updateRes.json();
  expect(updated.phone).toBe("555-9999");
  expect(updated.name).toBe(`E2E Console Client ${uniqueSuffix}`);

  const searchRes = await isolatedOrg.request.get(
    `/api/admin/data/clients?query=${encodeURIComponent(uniqueSuffix)}`,
  );
  expect(searchRes.ok()).toBeTruthy();
  const searchResults = await searchRes.json();
  expect(searchResults.rows.length).toBeGreaterThanOrEqual(1);
  expect(searchResults.rows.some((r: any) => r.id === created.id)).toBeTruthy();

  const deleteRes = await delReq(isolatedOrg, `/api/admin/data/clients/${created.id}`);
  expect(deleteRes.ok()).toBeTruthy();
  const deleteBody = await deleteRes.json();
  expect(deleteBody.deleted).toBe(true);

  const getAfterDelete = await isolatedOrg.request.get(
    `/api/admin/data/clients/${created.id}`,
  );
  expect(getAfterDelete.status()).toBe(404);

  const payoutsRes = await isolatedOrg.request.get(
    "/api/admin/data/imported_payouts?limit=5",
  );
  expect(payoutsRes.ok()).toBeTruthy();
  const payoutsData = await payoutsRes.json();
  expect(payoutsData).toHaveProperty("rows");
  expect(payoutsData).toHaveProperty("total");

  const auditRes = await isolatedOrg.request.get("/api/admin/data/audit_logs?limit=5");
  expect(auditRes.ok()).toBeTruthy();
  const auditData = await auditRes.json();
  expect(auditData).toHaveProperty("rows");

  const createAuditRes = await postJson(isolatedOrg, "/api/admin/data/audit_logs", {
    action: "TEST",
  });
  expect(createAuditRes.status()).toBe(400);

  const badEntityRes = await isolatedOrg.request.get("/api/admin/data/nonexistent");
  expect(badEntityRes.status()).toBe(400);
});

test("admin data console: non-admin gets 403", async ({ isolatedOrg }) => {
  const tm = await loginIsoTeamMember(isolatedOrg);
  try {
    const listRes = await tm.request.get("/api/admin/data/clients");
    expect(listRes.status()).toBe(403);

    const createRes = await tm.request.post("/api/admin/data/clients", {
      data: { name: "Should Fail" },
      headers: { "X-CSRF-Token": tm.csrf },
    });
    expect(createRes.status()).toBe(403);
  } finally {
    await tm.dispose();
  }
});

test("admin data console: UI navigation and breadcrumbs", async ({ isolatedOrg, page }) => {
  await loginPageAsIso(page, isolatedOrg);
  await expect(page.locator("text=Dashboard").first()).toBeVisible({ timeout: 15000 });

  const dataConsoleLink = page.locator('[data-testid="link-data-console"]');
  if (await dataConsoleLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dataConsoleLink.click();
  } else {
    await page.goto("/admin/data");
  }

  await expect(page.locator('[data-testid="text-data-console-title"]')).toBeVisible({
    timeout: 15000,
  });

  await expect(page.locator('[data-testid="card-entity-clients"]')).toBeVisible();
  await expect(page.locator('[data-testid="card-entity-audit_logs"]')).toBeVisible();

  await page.click('[data-testid="card-entity-clients"]');
  await expect(page.locator('[data-testid="text-entity-title"]')).toBeVisible({
    timeout: 15000,
  });

  await page.click('[data-testid="button-back-to-console"]');
  await expect(page.locator('[data-testid="text-data-console-title"]')).toBeVisible({
    timeout: 5000,
  });
});
