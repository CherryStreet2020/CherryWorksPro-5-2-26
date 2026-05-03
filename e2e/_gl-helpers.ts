import type { Browser, Page } from "@playwright/test";
import type { IsolatedOrgFixture } from "../tests/helpers/po/fixtures";

export interface SeededAccount {
  id: number;
  accountNumber: string;
  name: string;
  accountType: string;
  normalBalance: "DEBIT" | "CREDIT";
  isActive?: boolean;
  isSystem?: boolean;
}

export async function loginAsIsoAdmin(
  browser: Browser,
  iso: IsolatedOrgFixture,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.fill('[data-testid="input-email"]', iso.email);
  await page.fill('[data-testid="input-password"]', iso.password);
  await page.click('[data-testid="button-login"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20000,
  });
  return { page, close: () => ctx.close() };
}

export async function seedCoa(iso: IsolatedOrgFixture): Promise<SeededAccount[]> {
  const r = await iso.request.post("/api/gl/accounts/seed", {
    headers: { "x-csrf-token": iso.csrf },
  });
  if (r.status() !== 200) {
    throw new Error(`[gl-helpers] seed failed: ${r.status()} ${await r.text()}`);
  }
  return (await r.json()) as SeededAccount[];
}

export function findAccount(accts: SeededAccount[], number: string): SeededAccount {
  const a = accts.find((x) => x.accountNumber === number);
  if (!a) throw new Error(`[gl-helpers] account ${number} not in seeded COA`);
  return a;
}

export function pickNonControlExpense(accts: SeededAccount[]): SeededAccount {
  const a = accts.find((x) => x.accountType === "EXPENSE" && !x.isSystem)
    || accts.find((x) => x.accountType === "EXPENSE");
  if (!a) throw new Error("[gl-helpers] no expense account in COA");
  return a;
}

export async function seedExtraRevenue(iso: IsolatedOrgFixture): Promise<SeededAccount> {
  const accountNumber = `4${Math.floor(100 + Math.random() * 899)}`;
  const r = await iso.request.post("/api/gl/accounts", {
    headers: { "x-csrf-token": iso.csrf },
    data: {
      accountNumber,
      name: `Test Revenue ${accountNumber}`,
      accountType: "REVENUE",
      normalBalance: "CREDIT",
      isActive: true,
    },
  });
  if (r.status() !== 201 && r.status() !== 200) {
    throw new Error(`[gl-helpers] create revenue failed: ${r.status()} ${await r.text()}`);
  }
  return (await r.json()) as SeededAccount;
}
