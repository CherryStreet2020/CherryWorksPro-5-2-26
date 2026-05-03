/**
 * Shared helpers for the GL/accounting E2E suite (Task #438).
 *
 * Every GL spec mints its own chart of accounts via the
 * /api/gl/accounts/seed endpoint and then either drives a manual JE
 * through the UI or inserts source rows directly via the test DB pool
 * (for paths that aren't being asserted by the spec).
 */
import type { Browser, Page } from "@playwright/test";
import type { IsolatedOrgFixture } from "../tests/helpers/po/fixtures";

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
    timeout: 15000,
  });
  return { page, close: () => ctx.close() };
}

export interface SeededAccount {
  id: number;
  accountNumber: string;
  name: string;
  accountType: string;
  normalBalance: "DEBIT" | "CREDIT";
}

export async function seedCoa(
  iso: IsolatedOrgFixture,
): Promise<SeededAccount[]> {
  const r = await iso.request.post("/api/gl/accounts/seed", {
    headers: { "x-csrf-token": iso.csrf },
  });
  if (r.status() !== 200) {
    throw new Error(`[gl-helpers] seed failed: ${r.status()} ${await r.text()}`);
  }
  return r.json();
}

export function findAccount(
  accts: SeededAccount[],
  number: string,
): SeededAccount {
  const a = accts.find((x) => x.accountNumber === number);
  if (!a) throw new Error(`[gl-helpers] account ${number} not in seeded COA`);
  return a;
}
