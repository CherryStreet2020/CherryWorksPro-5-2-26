import { test, expect } from "../helpers/po/fixtures";
import { postJson, seedClient } from "./_helpers";

test("generate portal link and visit client portal", async ({ isolatedOrg, browser }) => {
  const client = await seedClient(isolatedOrg);

  const portalRes = await postJson(
    isolatedOrg,
    `/api/clients/${client.id}/generate-portal-link`,
    {},
  );
  expect(portalRes.ok()).toBeTruthy();
  const portalBody = await portalRes.json();
  expect(portalBody).toHaveProperty("portalToken");
  expect(portalBody).toHaveProperty("portalUrl");

  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  try {
    await portalPage.goto(portalBody.portalUrl);

    await portalPage.waitForSelector('[data-testid="text-client-name"]', {
      timeout: 15000,
    });

    const clientName = await portalPage
      .locator('[data-testid="text-client-name"]')
      .textContent();
    expect(clientName).toBeTruthy();
    expect(clientName!.trim().length).toBeGreaterThan(0);

    await expect(portalPage.locator('[data-testid="tab-invoices"]')).toBeVisible();
    await expect(portalPage.locator('[data-testid="tab-estimates"]')).toBeVisible();
    await expect(portalPage.locator('[data-testid="tab-payments"]')).toBeVisible();
  } finally {
    await portalContext.close();
  }
});
