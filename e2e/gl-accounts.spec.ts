import { test, expect } from "../tests/helpers/po/fixtures";
import { loginAsIsoAdmin, seedCoa } from "./_gl-helpers";

interface AccountRow {
  id: number;
  accountNumber: string;
  name: string;
  accountType: string;
  isActive: boolean;
  isSystem: boolean;
}

test.describe.configure({ mode: "serial" });

test.describe("Chart of Accounts", () => {
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
        const label = t.type
          .toLowerCase()
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        await page.getByRole("option", { name: new RegExp(`^${label}$`, "i") }).click();
        await page.getByTestId("button-submit-account").click();
        await expect(page.getByText(t.num).first()).toBeVisible({ timeout: 10000 });
      }

      const accts = (await isolatedOrg.request
        .get("/api/gl/accounts")
        .then((r) => r.json())) as AccountRow[];
      const numbers = accts.map((a) => a.accountNumber);
      for (const t of types) expect(numbers).toContain(t.num);
    } finally {
      await close();
    }
  });

  test("seeds + edits a non-system account", async ({ isolatedOrg, browser }) => {
    const seeded = await seedCoa(isolatedOrg);
    const expense = seeded.find((a) => a.accountNumber.startsWith("6"));
    expect(expense, "expected an expense seed account").toBeTruthy();

    const { page, close } = await loginAsIsoAdmin(browser, isolatedOrg);
    try {
      await page.goto("/gl/accounts");
      await expect(page.getByTestId(`row-account-${expense!.id}`)).toBeVisible({
        timeout: 10000,
      });

      await page.getByTestId(`button-edit-account-${expense!.id}`).click();
      const newName = `Edited ${Date.now()}`;
      await page.getByTestId("input-account-name").fill(newName);
      await page.getByTestId("button-submit-account").click();
      await expect(page.getByTestId(`text-account-name-${expense!.id}`)).toHaveText(
        newName,
        { timeout: 10000 },
      );
    } finally {
      await close();
    }
  });

  test("UI archive guard: account with posted entries soft-deletes (hidden from active list)", async ({
    isolatedOrg,
    browser,
  }) => {
    await seedCoa(isolatedOrg);

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
    const a = (await aRes.json()) as AccountRow;

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
    const b = (await bRes.json()) as AccountRow;

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
      const archiveBtn = page.getByTestId(`button-archive-account-${a.id}`);
      await expect(archiveBtn).toBeVisible({ timeout: 10000 });
      await archiveBtn.click();

      // After archive the row disappears from the default (active-only)
      // list rendered by the page.
      await expect(page.getByTestId(`row-account-${a.id}`)).toBeHidden({
        timeout: 10000,
      });

      const activeOnly = (await isolatedOrg.request
        .get("/api/gl/accounts")
        .then((r) => r.json())) as AccountRow[];
      expect(activeOnly.find((x) => x.id === a.id)).toBeUndefined();

      const all = (await isolatedOrg.request
        .get("/api/gl/accounts?includeArchived=true")
        .then((r) => r.json())) as AccountRow[];
      const updated = all.find((x) => x.id === a.id);
      expect(updated?.isActive).toBe(false);
    } finally {
      await close();
    }
  });
});
