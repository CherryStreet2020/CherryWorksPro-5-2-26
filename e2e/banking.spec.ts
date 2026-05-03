import { test, expect } from "../tests/helpers/po/fixtures";
import { setOrgTier } from "../tests/helpers/po/tier";
import { loginAsIsoAdmin } from "./_gl-helpers";
import { Pool } from "pg";

let _pool: Pool | null = null;
function pool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

test.afterAll(async () => {
  if (_pool) {
    await _pool.end().catch(() => undefined);
    _pool = null;
  }
});

test.describe.configure({ mode: "serial" });

test.describe("Banking", () => {
  test("STARTER org sees the upgrade wall", async ({ isolatedOrg, browser }) => {
    const ok = await setOrgTier(isolatedOrg.orgId, "STARTER");
    expect(ok).toBe(true);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/banking");
      await expect(
        page.locator('[data-testid="upgrade-wall-banking"]'),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await setOrgTier(isolatedOrg.orgId, "BUSINESS").catch(() => undefined);
      await close();
    }
  });

  test("PROFESSIONAL org renders page shell + connect buttons", async ({
    isolatedOrg,
    browser,
  }) => {
    await setOrgTier(isolatedOrg.orgId, "PROFESSIONAL");

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/banking");
      await expect(page.getByTestId("text-page-title")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("text-page-title")).toHaveText(/Banking/i);

      const headerBtn = page.getByTestId("button-connect-bank");
      const emptyBtn = page.getByTestId("button-connect-bank-empty");
      await expect(headerBtn.or(emptyBtn).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await setOrgTier(isolatedOrg.orgId, "BUSINESS").catch(() => undefined);
      await close();
    }
  });

  test("seeded bank connection renders a connection card with sync + disconnect controls", async ({
    isolatedOrg,
    browser,
  }) => {
    await setOrgTier(isolatedOrg.orgId, "PROFESSIONAL");

    const inserted = await pool().query(
      `INSERT INTO bank_connections
         (org_id, stripe_account_id, institution_name,
          account_name, last4, account_type, status)
       VALUES ($1, $2, 'Test Federal Bank',
               'Operating Checking', '4242', 'depository', 'ACTIVE')
       RETURNING id`,
      [isolatedOrg.orgId, `acct-${Date.now()}`],
    );
    const connId = inserted.rows[0].id as number;

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/banking");
      await expect(page.getByTestId(`card-bank-connection-${connId}`)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByTestId(`text-institution-${connId}`)).toContainText(
        /Test Federal Bank/i,
      );
      await expect(page.getByTestId(`button-sync-${connId}`)).toBeVisible();
      await expect(page.getByTestId(`button-disconnect-${connId}`)).toBeVisible();
    } finally {
      await pool()
        .query(`DELETE FROM bank_connections WHERE id = $1`, [connId])
        .catch(() => undefined);
      await setOrgTier(isolatedOrg.orgId, "BUSINESS").catch(() => undefined);
      await close();
    }
  });
});
