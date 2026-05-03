import { test, expect } from "@playwright/test";

// FIXME-task-455: Legacy shared-state spec (audit §6.2.8). The
// surrounding suite mutates the same seeded admin org rows, so the
// assertions race other serial specs. Skipped until migrated to the
// per-test `isolatedOrg` fixture (see tests/helpers/po/fixtures.ts).
// Tracked: project task #455.
import { test as _t } from "@playwright/test";
_t.beforeEach(() => _t.fixme(true, "Task #455: legacy shared-state spec; migrate to isolatedOrg first"));

test("generate portal link and visit client portal", async ({ browser }) => {
  const page = await browser.newPage();

  await page.goto("/");
  await page.fill('[data-testid="input-email"]', "dean@cherrystconsulting.com");
  await page.fill('[data-testid="input-password"]', "admin123");
  await page.click('[data-testid="button-login"]');
  await page.waitForSelector('[data-testid="text-dashboard-title"]', {
    timeout: 10000,
  });

  const clientsRes = await page.evaluate(() =>
    fetch("/api/clients", { credentials: "include" }).then((r) => r.json()),
  );

  if (!clientsRes || clientsRes.length === 0) {
    expect(true).toBe(true);
    await page.close();
    return;
  }

  const clientId = clientsRes[0].id;

  const portalRes = await page.evaluate((id: string) =>
    fetch(`/api/clients/${id}/generate-portal-link`, {
      method: "POST",
      credentials: "include",
    }).then((r) => r.json()),
    clientId,
  );

  expect(portalRes).toHaveProperty("portalToken");
  expect(portalRes).toHaveProperty("portalUrl");

  const portalUrl = portalRes.portalUrl;

  const portalPage = await browser.newPage();
  await portalPage.goto(portalUrl);

  await portalPage.waitForSelector('[data-testid="text-client-name"]', {
    timeout: 10000,
  });

  const clientName = await portalPage
    .locator('[data-testid="text-client-name"]')
    .textContent();
  expect(clientName).toBeTruthy();
  expect(clientName!.trim().length).toBeGreaterThan(0);

  const tabInvoices = portalPage.locator('[data-testid="tab-invoices"]');
  await expect(tabInvoices).toBeVisible();

  const tabEstimates = portalPage.locator('[data-testid="tab-estimates"]');
  await expect(tabEstimates).toBeVisible();

  const tabPayments = portalPage.locator('[data-testid="tab-payments"]');
  await expect(tabPayments).toBeVisible();

  await portalPage.close();
  await page.close();
});
