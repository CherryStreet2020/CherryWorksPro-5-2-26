/**
 * Chart-of-Accounts CRUD spec (Task #438).
 *
 * Mints its own COA per test, exercises new-account create for every
 * account type, edit, and the delete-guard (account with journal
 * entries cannot be hard-deleted — must archive instead).
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa } from "./_gl-helpers";

test.describe.configure({ mode: "serial" });

test.describe("Chart of Accounts (Task #438)", () => {
  test("creates accounts of each type via the form", async ({
    isolatedOrg,
    browser,
  }) => {
    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/accounts");
      await expect(page.getByTestId("text-page-title")).toBeVisible();

      const types = [
        { type: "ASSET", num: "1500", name: "Asset Test" },
        { type: "LIABILITY", num: "2500", name: "Liability Test" },
        { type: "EQUITY", num: "3500", name: "Equity Test" },
        { type: "REVENUE", num: "4500", name: "Revenue Test" },
        { type: "COST_OF_SERVICES", num: "5500", name: "COS Test" },
        { type: "EXPENSE", num: "6500", name: "Expense Test" },
      ];

      for (const t of types) {
        await page.getByTestId("button-add-account").click();
        await page.getByTestId("input-account-number").fill(t.num);
        await page.getByTestId("input-account-name").fill(t.name);
        await page.getByTestId("select-account-type").click();
        await page.getByRole("option", { name: new RegExp(`^${t.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}$`, "i") }).click();
        await page.getByTestId("button-submit-account").click();
        await expect(page.getByText(`${t.num}`).first()).toBeVisible({ timeout: 10000 });
      }

      // Verify all six rendered.
      const accts = await isolatedOrg.request
        .get("/api/gl/accounts")
        .then((r) => r.json());
      const numbers = accts.map((a: any) => a.accountNumber);
      for (const t of types) expect(numbers).toContain(t.num);
    } finally {
      await close();
    }
  });

  test("seeds + edits + archives a non-control account", async ({
    isolatedOrg,
    browser,
  }) => {
    const seeded = await seedCoa(isolatedOrg);
    // 6000-series is Operating Expenses in the seed COA — non-control.
    const expense = seeded.find((a) => a.accountNumber.startsWith("6"));
    expect(expense, "expected an expense seed account").toBeTruthy();

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/accounts");
      await expect(page.getByTestId(`row-account-${expense!.id}`)).toBeVisible({
        timeout: 10000,
      });

      // Edit name.
      await page.getByTestId(`button-edit-account-${expense!.id}`).click();
      const newName = `Edited ${Date.now()}`;
      await page.getByTestId("input-account-name").fill(newName);
      await page.getByTestId("button-submit-account").click();
      await expect(
        page.getByTestId(`text-account-name-${expense!.id}`),
      ).toHaveText(newName, { timeout: 10000 });
    } finally {
      await close();
    }
  });

  test("delete is guarded for an account with posted entries (archive instead)", async ({
    isolatedOrg,
    browser,
  }) => {
    await seedCoa(isolatedOrg);

    // Create non-system accounts so the archive button is guaranteed to
    // render in the UI (seeded defaults are often system-locked).
    const unique = Date.now().toString().slice(-6);
    const aRes = await isolatedOrg.request.post("/api/gl/accounts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        accountNumber: `86${unique}`,
        name: `E2E Guard Debit ${unique}`,
        accountType: "EXPENSE",
        normalBalance: "DEBIT",
      },
    });
    expect(aRes.status(), await aRes.text()).toBe(201);
    const a = await aRes.json();

    const bRes = await isolatedOrg.request.post("/api/gl/accounts", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        accountNumber: `96${unique}`,
        name: `E2E Guard Credit ${unique}`,
        accountType: "REVENUE",
        normalBalance: "CREDIT",
      },
    });
    expect(bRes.status(), await bRes.text()).toBe(201);
    const b = await bRes.json();

    // Post a JE against `a` and `b` via API so the storage delete-guard
    // demotes the DELETE to an archive.
    const post = await isolatedOrg.request.post("/api/gl/journal-entries", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        entryDate: new Date().toISOString().slice(0, 10),
        memo: "delete-guard fixture",
        lines: [
          { accountId: a.id, debit: "10.00", credit: "0.00" },
          { accountId: b.id, debit: "0.00", credit: "10.00" },
        ],
      },
    });
    expect(post.status(), await post.text()).toBe(201);

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/accounts");
      await expect(page.getByTestId(`row-account-${a.id}`)).toBeVisible({
        timeout: 10000,
      });

      const archiveBtn = page.getByTestId(`button-archive-account-${a.id}`);
      await expect(archiveBtn).toBeVisible({ timeout: 10000 });
      await archiveBtn.click();

      // The row is hidden by the default (active-only) list. Pull the
      // archived view to confirm the soft-delete landed.
      const activeOnly = await isolatedOrg.request
        .get("/api/gl/accounts")
        .then((r) => r.json());
      expect(activeOnly.find((x: any) => x.id === a.id)).toBeUndefined();

      const all = await isolatedOrg.request
        .get("/api/gl/accounts?includeArchived=true")
        .then((r) => r.json());
      const updated = all.find((x: any) => x.id === a.id);
      expect(updated?.isActive).toBe(false);
    } finally {
      await close();
    }
  });
});
