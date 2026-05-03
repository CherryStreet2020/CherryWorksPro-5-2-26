/**
 * Close Periods spec (Task #438).
 *
 * Drives create → close → reopen via the UI, and exercises the
 * "cannot close period with unapproved timesheets" rejection
 * end-to-end. Per Task #438's "Period locked" constraint, that
 * rejection MUST surface through the UI form, not just the API —
 * we click the Close button, confirm in the dialog, and assert the
 * destructive toast.
 *
 * The close-period server route is the only place in the codebase
 * that today actively guards against backdated mutations into a
 * closed period (via the `non-approved timesheet weeks in range`
 * check). Direct GL JE writes are not period-locked at the server
 * layer; that gap is documented in task #438's notes for follow-up.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
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

test.describe("Close Periods (Task #438)", () => {
  test("create → close → reopen happy path through the UI", async ({
    isolatedOrg,
    browser,
  }) => {
    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/close-periods");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      // Pick a far-past period so no fixture timesheets land in it.
      const start = "1990-01-01";
      const end = "1990-01-31";

      await page.getByTestId("button-new-close-period").click();
      await page.getByTestId("input-period-start").fill(start);
      await page.getByTestId("input-period-end").fill(end);
      await page.getByTestId("button-create-period").click();

      // Wait for the new row to render.
      const row = page.locator('[data-testid^="row-period-"]').first();
      await expect(row).toBeVisible({ timeout: 10000 });

      const periodId = await row.getAttribute("data-testid");
      const id = periodId!.replace("row-period-", "");

      // Close.
      await page.getByTestId(`button-close-${id}`).click();
      await page.getByTestId("button-confirm-close").click();
      await expect(page.getByText("Period closed")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`badge-status-${id}`)).toContainText(/closed/i);

      // Reopen.
      await page.getByTestId(`button-reopen-${id}`).click();
      await page.getByTestId("button-confirm-reopen").click();
      await expect(page.getByText("Period reopened")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`badge-status-${id}`)).toContainText(/open/i);
    } finally {
      await close();
    }
  });

  test("cannot close a period with unapproved timesheet weeks (UI-driven)", async ({
    isolatedOrg,
    browser,
  }) => {
    // Insert a non-APPROVED timesheet_weeks row inside the target
    // period so the server's close guard fires.
    const start = "1991-01-07"; // Monday
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
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      await page.getByTestId("button-new-close-period").click();
      await page.getByTestId("input-period-start").fill(start);
      await page.getByTestId("input-period-end").fill(end);
      await page.getByTestId("button-create-period").click();

      const row = page.locator('[data-testid^="row-period-"]').first();
      await expect(row).toBeVisible({ timeout: 10000 });
      const id = (await row.getAttribute("data-testid"))!.replace("row-period-", "");

      // Drive the close attempt through the UI.
      await page.getByTestId(`button-close-${id}`).click();
      await page.getByTestId("button-confirm-close").click();

      // Toast title is "Cannot close period" with the server message in description.
      await expect(
        page.getByText(/Cannot close period/i).first(),
      ).toBeVisible({ timeout: 10000 });

      // Status must remain OPEN.
      await expect(page.getByTestId(`badge-status-${id}`)).toContainText(/open/i);
    } finally {
      await close();
    }
  });
});
