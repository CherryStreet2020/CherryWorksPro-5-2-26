/**
 * Playwright test fixtures for the parallel-safe E2E layer (Task #432).
 *
 * Specs that import `test` from this module get two new fixtures on top
 * of the stock Playwright `test`:
 *
 *   - `isolatedOrg`   : per-test fresh org + admin (auto-cleanup),
 *                       plus a logged-in `APIRequestContext` and CSRF
 *                       token. Use for any spec that does CRUD against
 *                       a tenant — multiple of these can run in
 *                       parallel without racing each other or the
 *                       shared seed admin.
 *   - `seedAdminPage` : a `Page` already authenticated as the shared
 *                       seed admin via cached storageState (one
 *                       login per worker, not per test). Use for
 *                       read-only specs that just need *an* authed
 *                       session against the existing seeded data.
 *
 * Specs that don't need either keep using the stock `test` import from
 * `@playwright/test`. This file is purely additive.
 */
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createIsolatedOrg,
  deleteIsolatedOrg,
  buildIsolatedRequest,
  type IsolatedOrg,
} from "./isolation";
import { loginApi, ADMIN_EMAIL, PRIMARY_ADMIN_PASS, FALLBACK_ADMIN_PASS, BASE } from "./auth";
import { request as pwRequest } from "@playwright/test";

export interface IsolatedOrgFixture extends IsolatedOrg {
  request: APIRequestContext;
  csrf: string;
}

interface Fixtures {
  /**
   * Per-test isolated org. Each call to `test(...)` that destructures
   * `isolatedOrg` gets a brand-new org/admin pair that is torn down
   * after the test finishes.
   */
  isolatedOrg: IsolatedOrgFixture;
  /**
   * Per-worker authenticated `Page` for the shared seed admin. The
   * underlying storageState is cached in `test-results/storage/` and
   * reused across every test in the worker — no per-test login dance.
   */
  seedAdminPage: Page;
}

interface WorkerFixtures {
  /**
   * Path to the worker-scoped seed-admin storageState file. Materialised
   * lazily on first use. Deleted along with `test-results/` between
   * runs.
   */
  seedAdminStorageStatePath: string;
}

const STORAGE_DIR = resolve(process.cwd(), "test-results/storage");

export const test = base.extend<Fixtures, WorkerFixtures>({
  seedAdminStorageStatePath: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixture-arg destructure even when no other fixtures are read.
    async ({}, use, workerInfo) => {
      mkdirSync(STORAGE_DIR, { recursive: true });
      const file = resolve(STORAGE_DIR, `seed-admin-w${workerInfo.workerIndex}.json`);
      if (!existsSync(file)) {
        const ctx = await pwRequest.newContext({ baseURL: BASE });
        try {
          await loginApi(ctx, ADMIN_EMAIL, PRIMARY_ADMIN_PASS);
          const state = await ctx.storageState();
          writeFileSync(file, JSON.stringify(state), "utf8");
        } finally {
          await ctx.dispose();
        }
      }
      await use(file);
    },
    { scope: "worker" },
  ],

  seedAdminPage: async ({ browser, seedAdminStorageStatePath }, use) => {
    const ctx = await browser.newContext({ storageState: seedAdminStorageStatePath });
    const page = await ctx.newPage();
    try {
      await use(page);
    } finally {
      await ctx.close();
    }
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixture-arg destructure even when no other fixtures are read.
  isolatedOrg: async ({}, use) => {
    const iso = await createIsolatedOrg();
    const { request, csrf } = await buildIsolatedRequest(iso);
    try {
      await use({ ...iso, request, csrf });
    } finally {
      await request.dispose().catch(() => undefined);
      await deleteIsolatedOrg(iso.orgId);
    }
  },
});

export { expect, ADMIN_EMAIL, PRIMARY_ADMIN_PASS, FALLBACK_ADMIN_PASS, BASE };
