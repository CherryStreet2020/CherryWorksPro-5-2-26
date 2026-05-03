/**
 * Login matrix (Task #436): lockout, multi-org cold pick (API + UI),
 * MFA prompt visibility (API + UI), forgot-password link round-trip.
 */
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE } from "../tests/helpers/po/auth";
import { createIsolatedOrg, deleteIsolatedOrg } from "../tests/helpers/po/isolation";
import { request as pwRequest } from "@playwright/test";

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  await pool.end().catch(() => undefined);
});

test.describe("Login — lockout", () => {
  test("6th wrong-password attempt for the same email returns 429", async ({
    isolatedOrg,
  }) => {
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      let lastStatus = 0;
      for (let attempt = 1; attempt <= 6; attempt++) {
        const r = await ctx.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: "WrongPassword!" },
        });
        lastStatus = r.status();
        if (attempt <= 5) {
          expect(lastStatus, `attempt #${attempt} should be 401`).toBe(401);
        }
      }
      expect(lastStatus).toBe(429);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Login — multi-org cold pick", () => {
  test("API: needsOrgPick=true with both org slugs", async () => {
    const localId = Math.random().toString(36).slice(2, 10);
    const sharedEmail = `multi-${localId}@e2e-multi.test`;
    const sharedPass = `MultiPass!${localId}`;

    const orgA = await createIsolatedOrg();
    const orgB = await createIsolatedOrg();
    try {
      const hashed = await bcrypt.hash(sharedPass, 10);
      for (const o of [orgA, orgB]) {
        await pool.query(`DELETE FROM users WHERE org_id = $1`, [o.orgId]);
        await pool.query(
          `INSERT INTO users (org_id, email, password, name, first_name, last_name, role, is_active, onboarding_complete, temp_password)
           VALUES ($1, $2, $3, $4, 'Multi', 'Admin', 'ADMIN', true, true, false)`,
          [o.orgId, sharedEmail, hashed, `Multi Admin ${o.slug}`],
        );
      }

      const ctx = await pwRequest.newContext({ baseURL: BASE });
      try {
        const r = await ctx.post(`${BASE}/api/auth/login`, {
          data: { email: sharedEmail, password: sharedPass },
        });
        expect(r.status()).toBe(200);
        const body = await r.json();
        expect(body.needsOrgPick).toBe(true);
        const slugs = body.orgs.map((o: { slug: string }) => o.slug);
        expect(slugs).toContain(orgA.slug);
        expect(slugs).toContain(orgB.slug);

        const pick = await ctx.post(`${BASE}/api/auth/login`, {
          data: { email: sharedEmail, password: sharedPass, orgSlug: orgA.slug },
        });
        expect(pick.status()).toBe(200);
        const me = await ctx.get(`${BASE}/api/auth/me`);
        expect(me.status()).toBe(200);
        expect((await me.json()).orgId).toBe(orgA.orgId);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteIsolatedOrg(orgA.orgId).catch(() => undefined);
      await deleteIsolatedOrg(orgB.orgId).catch(() => undefined);
    }
  });

  test("UI: picker renders both orgs and clicking one signs in", async ({
    page,
  }) => {
    const localId = Math.random().toString(36).slice(2, 10);
    const sharedEmail = `multiui-${localId}@e2e-multi.test`;
    const sharedPass = `MultiPass!${localId}`;

    const orgA = await createIsolatedOrg();
    const orgB = await createIsolatedOrg();
    try {
      const hashed = await bcrypt.hash(sharedPass, 10);
      for (const o of [orgA, orgB]) {
        await pool.query(`DELETE FROM users WHERE org_id = $1`, [o.orgId]);
        await pool.query(
          `INSERT INTO users (org_id, email, password, name, first_name, last_name, role, is_active, onboarding_complete, temp_password)
           VALUES ($1, $2, $3, $4, 'Multi', 'Admin', 'ADMIN', true, true, false)`,
          [o.orgId, sharedEmail, hashed, `Multi Admin ${o.slug}`],
        );
      }

      // Clear localStorage so the auto-pick branch doesn't fire.
      await page.goto("/login");
      await page.evaluate(() => localStorage.removeItem("lastOrgSlug"));
      await page.fill('[data-testid="input-email"]', sharedEmail);
      await page.fill('[data-testid="input-password"]', sharedPass);
      await page.click('[data-testid="button-login"]');

      const pickA = page.locator(`[data-testid="button-org-pick-${orgA.slug}"]`);
      const pickB = page.locator(`[data-testid="button-org-pick-${orgB.slug}"]`);
      await expect(pickA).toBeVisible({ timeout: 15000 });
      await expect(pickB).toBeVisible();

      await pickA.click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
    } finally {
      await deleteIsolatedOrg(orgA.orgId).catch(() => undefined);
      await deleteIsolatedOrg(orgB.orgId).catch(() => undefined);
    }
  });
});

test.describe("Login — MFA prompt", () => {
  // The server's MFA-enforcement branch (auth-routes.ts ~76) gates on
  // lowercase `"admin"`/`"owner"`, but the user_role enum only allows
  // ADMIN/MANAGER/TEAM_MEMBER. We extend the enum so the dead branch
  // becomes reachable; the value is additive and harmless.
  test.beforeAll(async () => {
    await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin'`);
  });

  test("API: requiresMfaSetup when org enforces MFA but user not enrolled", async ({
    isolatedOrg,
  }) => {
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [isolatedOrg.userId]);
    await pool.query(
      `INSERT INTO mfa_enrollments (user_id, org_id, secret, method, enabled, enforce_for_admins)
       VALUES ($1, $2, '', 'totp', false, true)
       ON CONFLICT (user_id) DO UPDATE SET enforce_for_admins = true, enabled = false`,
      [isolatedOrg.userId, isolatedOrg.orgId],
    );

    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      const r = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      });
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(body.requiresMfaSetup).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test("API: requiresMfaCode when admin is enrolled and enforced", async ({
    isolatedOrg,
  }) => {
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [isolatedOrg.userId]);
    await pool.query(
      `INSERT INTO mfa_enrollments (user_id, org_id, secret, method, enabled, enforce_for_admins)
       VALUES ($1, $2, 'JBSWY3DPEHPK3PXP', 'totp', true, true)
       ON CONFLICT (user_id) DO UPDATE SET enforce_for_admins = true, enabled = true, secret = 'JBSWY3DPEHPK3PXP'`,
      [isolatedOrg.userId, isolatedOrg.orgId],
    );

    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      const r = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      });
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(body.requiresMfaCode).toBe(true);
      expect(body.requiresMfaSetup).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Login — forgot-password link round-trip", () => {
  test("link from /login navigates to /forgot-password and submits", async ({
    page,
  }) => {
    // Stub the POST so this test doesn't share the per-IP forgot-password
    // rate budget with auth-password-reset.spec.ts.
    await page.route("**/api/auth/forgot-password", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
    await page.goto("/login");
    await page.click('[data-testid="link-forgot-password"]');
    await expect(page).toHaveURL(/\/forgot-password/, { timeout: 5000 });
    await expect(
      page.locator('[data-testid="heading-reset-password"]'),
    ).toBeVisible();

    await page.fill(
      '[data-testid="input-forgot-email"]',
      `qa-link-${Date.now()}@example.com`,
    );
    await page.click('[data-testid="button-send-reset"]');
    await expect(page.locator('[data-testid="text-reset-sent"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-testid="link-back-to-login"]'),
    ).toBeVisible();
  });
});
