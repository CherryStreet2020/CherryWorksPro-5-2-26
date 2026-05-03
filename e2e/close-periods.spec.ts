import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa, pickNonControlExpense, pickNonControlRevenue } from "./_gl-helpers";
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

test.describe("Close Periods", () => {
  test("create → close → reopen happy path through the UI", async ({
    isolatedOrg,
    browser,
  }) => {
    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/close-periods");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      const start = "1990-01-01";
      const end = "1990-01-31";

      await page.getByTestId("button-new-close-period").click();
      await page.getByTestId("input-period-start").fill(start);
      await page.getByTestId("input-period-end").fill(end);
      await page.getByTestId("button-create-period").click();

      const row = page.locator('[data-testid^="row-period-"]').first();
      await expect(row).toBeVisible({ timeout: 10000 });

      const id = (await row.getAttribute("data-testid"))!.replace("row-period-", "");

      await page.getByTestId(`button-close-${id}`).click();
      await page.getByTestId("button-confirm-close").click();
      await expect(page.getByText("Period closed")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`badge-status-${id}`)).toContainText(/closed/i);

      await page.getByTestId(`button-reopen-${id}`).click();
      await page.getByTestId("button-confirm-reopen").click();
      await expect(page.getByText("Period reopened")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`badge-status-${id}`)).toContainText(/open/i);
    } finally {
      await close();
    }
  });

  test("close is rejected when the period contains unapproved timesheet weeks", async ({
    isolatedOrg,
    browser,
  }) => {
    const start = "1991-01-07";
    const end = "1991-01-31";
    await pool().query(
      `INSERT INTO timesheet_weeks
         (org_id, user_id, week_start_date, status, submitted_at)
       VALUES ($1, $2, $3, 'SUBMITTED', NOW())`,
      [isolatedOrg.orgId, isolatedOrg.userId, start],
    );

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/close-periods");
      await page.getByTestId("button-new-close-period").click();
      await page.getByTestId("input-period-start").fill(start);
      await page.getByTestId("input-period-end").fill(end);
      await page.getByTestId("button-create-period").click();

      const row = page.locator('[data-testid^="row-period-"]').first();
      await expect(row).toBeVisible({ timeout: 10000 });
      const id = (await row.getAttribute("data-testid"))!.replace("row-period-", "");

      await page.getByTestId(`button-close-${id}`).click();
      await page.getByTestId("button-confirm-close").click();

      await expect(page.getByText(/Cannot close period/i).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByTestId(`badge-status-${id}`)).toContainText(/open/i);
    } finally {
      await close();
    }
  });

  test("posting a journal entry into a closed period is rejected through the UI", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    const dr = pickNonControlExpense(seeded);
    const cr = pickNonControlRevenue(seeded);

    // Close a far-past period so date-picking is unambiguous and no
    // other fixture data lands in it.
    const start = "1992-03-01";
    const end = "1992-03-31";
    const within = "1992-03-15";

    const created = await isolatedOrg.request.post("/api/close-periods", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { periodStart: start, periodEnd: end },
    });
    expect([200, 201]).toContain(created.status());
    const period = (await created.json()) as { id: string };

    const closeRes = await isolatedOrg.request.post(
      `/api/close-periods/${period.id}/close`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(closeRes.status(), await closeRes.text()).toBe(200);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/journal-entries");
      await page.getByTestId("button-new-journal-entry").click();
      await page.getByTestId("input-entry-date").fill(within);
      await page.getByTestId("input-entry-memo").fill("blocked by closed period");

      await page.getByTestId("select-line-account-0").click();
      await page.getByRole("option", { name: new RegExp(`^${dr.accountNumber}`) }).click();
      await page.getByTestId("input-line-debit-0").fill("12.34");

      await page.getByTestId("select-line-account-1").click();
      await page.getByRole("option", { name: new RegExp(`^${cr.accountNumber}`) }).click();
      await page.getByTestId("input-line-credit-1").fill("12.34");

      await page.getByTestId("button-submit-journal-entry").click();
      await page.getByTestId("button-confirm-post-je").click();

      await expect(
        page.getByText(/closed accounting period|Cannot post journal entry/i).first(),
      ).toBeVisible({ timeout: 10000 });

      // Server-side proof: no JEs landed in that period.
      const jeList = await isolatedOrg.request
        .get(`/api/gl/journal-entries?startDate=${start}&endDate=${end}`)
        .then((r) => r.json());
      expect(Array.isArray(jeList)).toBe(true);
      expect(jeList.length).toBe(0);
    } finally {
      await close();
    }
  });
});
