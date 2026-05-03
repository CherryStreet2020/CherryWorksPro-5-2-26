/**
 * Playwright test fixtures for the parallel-safe E2E layer (Tasks #432 + #435).
 *
 * Specs that import `test` from this module get the following fixtures
 * on top of the stock Playwright `test`:
 *
 *   - `isolatedOrg`         : per-test fresh org + admin (auto-cleanup),
 *                             plus a logged-in `APIRequestContext` and
 *                             CSRF token. Honors the
 *                             `firmProfileComplete` option fixture.
 *   - `firmProfileComplete` : Playwright option fixture (default `true`).
 *                             `test.use({ firmProfileComplete: false })`
 *                             switches the gated-surface assertion path.
 *   - `seedAdminPage`       : worker-cached page for the SHARED seed
 *                             admin (legacy). Read-only.
 *   - `seedRoleAdminPage`   : worker-cached page for the role-seed
 *                             org's ADMIN — never the shared dean@...
 *                             admin. Read-only by convention.
 *   - `seedManagerPage`     : worker-cached page for the role-seed org's
 *                             MANAGER. Read-only by convention.
 *   - `seedTeamMemberPage`  : worker-cached page for the role-seed org's
 *                             TEAM_MEMBER. Read-only by convention.
 *
 * Specs that don't need any of this keep using the stock `test` import
 * from `@playwright/test`. This file is purely additive.
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
import {
  roleSessionFixtures,
  type RoleSessionTestFixtures,
  type RoleSessionWorkerFixtures,
} from "./sessions";

export interface IsolatedOrgFixture extends IsolatedOrg {
  request: APIRequestContext;
  csrf: string;
}

interface Fixtures extends RoleSessionTestFixtures {
  isolatedOrg: IsolatedOrgFixture;
  seedAdminPage: Page;
  /**
   * Task #435 — Playwright option fixture controlling whether the
   * `isolatedOrg` fixture pre-populates orgs.email + address_city so
   * `AdminSetupGate` lets admin navigation through. Defaults to `true`.
   * Override per-spec via `test.use({ firmProfileComplete: false })`.
   */
  firmProfileComplete: boolean;
}

interface WorkerFixtures extends RoleSessionWorkerFixtures {
  seedAdminStorageStatePath: string;
}

const STORAGE_DIR = resolve(process.cwd(), "test-results/storage");

export const test = base.extend<Fixtures, WorkerFixtures>({
  // Option fixture — see Fixtures interface for docs.
  firmProfileComplete: [true, { option: true }],

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

  isolatedOrg: async ({ firmProfileComplete }, use) => {
    const iso = await createIsolatedOrg({ firmProfileComplete });
    const { request, csrf } = await buildIsolatedRequest(iso);
    try {
      await use({ ...iso, request, csrf });
    } finally {
      await request.dispose().catch(() => undefined);
      await deleteIsolatedOrg(iso.orgId);
    }
  },

  // Task #435 — role-seed org + per-role pre-auth pages. Defined in
  // ./sessions.ts so its public API matches the task spec; spread in
  // here so a single `test` import gives you everything.
  ...roleSessionFixtures,
});

export { expect, ADMIN_EMAIL, PRIMARY_ADMIN_PASS, FALLBACK_ADMIN_PASS, BASE };
