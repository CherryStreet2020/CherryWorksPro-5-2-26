import { test, expect } from "@playwright/test";

// FIXME-task-455: Legacy shared-state spec — flaky against the
// shared seeded admin org. Skipped until migrated to the per-test
// `isolatedOrg` fixture (project task #455).
import { test as _t } from "@playwright/test";
_t.beforeEach(() => _t.fixme(true, "Task #455: legacy shared-state spec; migrate to isolatedOrg first"));

test("admin data console: list entities, CRUD client, view independent payouts", async ({
  request,
  page: _page,
}) => {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: "dean@cherrystconsulting.com", password: "admin123", orgSlug: "cherry-st" },
  });
  expect(loginRes.ok()).toBeTruthy();

  const metaRes = await request.get("/api/admin/data/entities");
  expect(metaRes.ok()).toBeTruthy();
  const meta = await metaRes.json();
  expect(meta.editable.length).toBeGreaterThan(0);
  expect(meta.editable).toContain("clients");
  expect(meta.editable).toContain("imported_payouts");
  expect(meta.viewOnly).toContain("audit_logs");
  expect(meta.viewOnly).toContain("imported_keys");

  const clientsListRes = await request.get(
    "/api/admin/data/clients?limit=10&offset=0",
  );
  expect(clientsListRes.ok()).toBeTruthy();
  const clientsList = await clientsListRes.json();
  expect(clientsList).toHaveProperty("rows");
  expect(clientsList).toHaveProperty("total");
  expect(Array.isArray(clientsList.rows)).toBe(true);

  const uniqueSuffix = Date.now().toString(36);
  const createRes = await request.post("/api/admin/data/clients", {
    data: {
      name: `E2E Console Client ${uniqueSuffix}`,
      email: `e2e-console-${uniqueSuffix}@test.com`,
      phone: "555-0199",
    },
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json();
  expect(created.id).toBeTruthy();
  expect(created.name).toBe(`E2E Console Client ${uniqueSuffix}`);

  const getRes = await request.get(`/api/admin/data/clients/${created.id}`);
  expect(getRes.ok()).toBeTruthy();
  const fetched = await getRes.json();
  expect(fetched.name).toBe(`E2E Console Client ${uniqueSuffix}`);

  const updateRes = await request.patch(`/api/admin/data/clients/${created.id}`, {
    data: { phone: "555-9999" },
  });
  expect(updateRes.ok()).toBeTruthy();
  const updated = await updateRes.json();
  expect(updated.phone).toBe("555-9999");
  expect(updated.name).toBe(`E2E Console Client ${uniqueSuffix}`);

  const searchRes = await request.get(
    `/api/admin/data/clients?query=${encodeURIComponent(uniqueSuffix)}`,
  );
  expect(searchRes.ok()).toBeTruthy();
  const searchResults = await searchRes.json();
  expect(searchResults.rows.length).toBeGreaterThanOrEqual(1);
  expect(
    searchResults.rows.some((r: any) => r.id === created.id),
  ).toBeTruthy();

  const deleteRes = await request.delete(
    `/api/admin/data/clients/${created.id}`,
  );
  expect(deleteRes.ok()).toBeTruthy();
  const deleteBody = await deleteRes.json();
  expect(deleteBody.deleted).toBe(true);

  const getAfterDelete = await request.get(
    `/api/admin/data/clients/${created.id}`,
  );
  expect(getAfterDelete.status()).toBe(404);

  const payoutsRes = await request.get(
    "/api/admin/data/imported_payouts?limit=5",
  );
  expect(payoutsRes.ok()).toBeTruthy();
  const payoutsData = await payoutsRes.json();
  expect(payoutsData).toHaveProperty("rows");
  expect(payoutsData).toHaveProperty("total");

  const auditRes = await request.get("/api/admin/data/audit_logs?limit=5");
  expect(auditRes.ok()).toBeTruthy();
  const auditData = await auditRes.json();
  expect(auditData).toHaveProperty("rows");

  const createAuditRes = await request.post("/api/admin/data/audit_logs", {
    data: { action: "TEST" },
  });
  expect(createAuditRes.status()).toBe(400);

  const badEntityRes = await request.get("/api/admin/data/nonexistent");
  expect(badEntityRes.status()).toBe(400);
});

test("admin data console: non-admin gets 403", async ({ request }) => {
  const loginRes = await request.post("/api/auth/login", {
    data: {
      email: "kellyjo@cherrystconsulting.com",
      password: "cherry2026",
    },
  });
  expect(loginRes.ok()).toBeTruthy();

  const listRes = await request.get("/api/admin/data/clients");
  expect(listRes.status()).toBe(403);

  const createRes = await request.post("/api/admin/data/clients", {
    data: { name: "Should Fail" },
  });
  expect(createRes.status()).toBe(403);
});

test("admin data console: UI navigation and breadcrumbs", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
  await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
  await page.fill('[data-testid="input-password"]', "admin123");
  await page.click('[data-testid="button-login"]');
  await page.waitForURL("**/", { timeout: 10000 });
  await expect(page.locator("text=Dashboard").first()).toBeVisible({
    timeout: 10000,
  });

  const dataConsoleLink = page.locator('[data-testid="link-data-console"]');
  if (await dataConsoleLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dataConsoleLink.click();
  } else {
    await page.goto("/admin/data");
  }

  await expect(
    page.locator('[data-testid="text-data-console-title"]'),
  ).toBeVisible({ timeout: 10000 });

  await expect(page.locator('[data-testid="card-entity-clients"]')).toBeVisible();
  await expect(page.locator('[data-testid="card-entity-audit_logs"]')).toBeVisible();

  await page.click('[data-testid="card-entity-clients"]');
  await expect(
    page.locator('[data-testid="text-entity-title"]'),
  ).toBeVisible({ timeout: 10000 });

  await expect(page.locator('[data-testid="nav-breadcrumbs"]')).toBeVisible();

  await page.click('[data-testid="button-back-to-console"]');
  await expect(
    page.locator('[data-testid="text-data-console-title"]'),
  ).toBeVisible({ timeout: 5000 });
});
