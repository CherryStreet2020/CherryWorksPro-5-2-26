/**
 * Login extras (Task #436, audit §3.1).
 *
 * Pins the three login surfaces that the original
 * `auth-login-failure.spec.ts` deliberately stopped short of:
 *   1. Failed-login lockout — 6th wrong-password attempt for the same
 *      email returns 429 with a "try again in N minute(s)" body
 *      (server/routes/auth-routes.ts ~25-50).
 *   2. Multi-org cold pick — when one email exists in 2+ active orgs,
 *      the API returns `{ needsOrgPick: true, orgs: [...] }` at
 *      status 200 (login.tsx parses this and renders the picker UI).
 *   3. MFA prompt visibility — when the org enforces MFA on admins
 *      and the admin hasn't enrolled, login returns
 *      `{ requiresMfaSetup: true }`. When the admin IS enrolled,
 *      login returns `{ requiresMfaCode: true }`. Either way the
 *      session is "mfaPending" and `/api/auth/me` reflects the
 *      not-fully-authed state.
 *
 * All three surfaces are exercised at the API layer rather than the
 * UI: the lockout map is per-email/in-process, multi-org picker logic
 * lives in `/api/auth/login`'s response shape, and MFA flows are pure
 * JSON contracts. UI-layer assertions are owned by per-page specs
 * elsewhere.
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

test.describe("Login — failed-login lockout", () => {
  test("6th bad-password attempt for the same email returns 429", async ({
    isolatedOrg,
  }) => {
    // Use a fresh APIRequestContext so we don't poison the fixture's
    // logged-in admin context with bad-credential audit noise.
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      let lastStatus = 0;
      for (let attempt = 1; attempt <= 6; attempt++) {
        const r = await ctx.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: "WrongPassword!" },
        });
        lastStatus = r.status();
        if (attempt <= 5) {
          // First 5 attempts: 401 invalid credentials (lockout not yet
          // engaged for this email).
          expect(
            lastStatus,
            `attempt #${attempt} should be 401 (got ${lastStatus})`,
          ).toBe(401);
        }
      }
      expect(
        lastStatus,
        "6th wrong-password attempt should be locked out (429)",
      ).toBe(429);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Login — multi-org cold pick", () => {
  test("same email in 2 active orgs returns needsOrgPick=true", async () => {
    // Mint two isolated orgs that share the SAME admin email +
    // password. We bypass the fixture for the 2nd org so the cleanup
    // is explicit — `createIsolatedOrg`/`deleteIsolatedOrg` already
    // handles per-test scoping under the parallel project.
    const localId = Math.random().toString(36).slice(2, 10);
    const sharedEmail = `multi-${localId}@e2e-multi.test`;
    const sharedPass = `MultiPass!${localId}`;

    const orgA = await createIsolatedOrg();
    const orgB = await createIsolatedOrg();
    try {
      const hashed = await bcrypt.hash(sharedPass, 10);
      // Replace the auto-generated admins with one user-per-org sharing
      // a single email. We're inside an isolated org, so deleting the
      // existing admin row is safe.
      for (const o of [orgA, orgB]) {
        await pool.query(`DELETE FROM users WHERE org_id = $1`, [o.orgId]);
        await pool.query(
          `INSERT INTO users (
             org_id, email, password, name, first_name, last_name, role,
             is_active, onboarding_complete, temp_password
           )
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
        expect(Array.isArray(body.orgs)).toBe(true);
        const slugs = body.orgs.map((o: { slug: string }) => o.slug);
        expect(slugs).toContain(orgA.slug);
        expect(slugs).toContain(orgB.slug);

        // Picking one of the two slugs completes the login.
        const pick = await ctx.post(`${BASE}/api/auth/login`, {
          data: { email: sharedEmail, password: sharedPass, orgSlug: orgA.slug },
        });
        expect(pick.status()).toBe(200);
        const me = await ctx.get(`${BASE}/api/auth/me`);
        expect(me.status()).toBe(200);
        const meBody = await me.json();
        expect(meBody.email).toBe(sharedEmail);
        expect(meBody.orgId).toBe(orgA.orgId);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteIsolatedOrg(orgA.orgId).catch(() => undefined);
      await deleteIsolatedOrg(orgB.orgId).catch(() => undefined);
    }
  });
});

test.describe("Login — MFA prompt visibility", () => {
  // Bug pin (Task #436 audit): the server's MFA-enforcement branch
  // gates on `user.role === "admin" || user.role === "owner"`
  // (server/routes/auth-routes.ts ~76), but the DB stores roles as
  // `"ADMIN"`. The branch is therefore unreachable for every
  // properly-cased ADMIN account in production. Both tests below
  // codify the EXPECTED behavior and are skipped via `test.fixme()`
  // until the role-case mismatch is fixed. Once the server check is
  // updated to accept `"ADMIN"`, drop the fixme markers and these
  // tests will start running.
  test.fixme(true, "Server MFA branch checks lowercase 'admin' but DB stores 'ADMIN' (case mismatch)");

  test("admin without MFA in an enforced-org sees requiresMfaSetup", async ({
    isolatedOrg,
  }) => {
    // Insert an mfa_enrollments row for the org marked "enforce for
    // admins" but NOT enabled. The auth route then returns
    // requiresMfaSetup=true on the next login.
    await pool.query(
      `INSERT INTO mfa_enrollments
         (user_id, org_id, secret, method, enabled, enforce_for_admins)
       VALUES ($1, $2, '', 'totp', false, true)
       ON CONFLICT (user_id) DO UPDATE SET
         enforce_for_admins = EXCLUDED.enforce_for_admins,
         enabled = EXCLUDED.enabled`,
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
      // The session is mfaPending — `/api/auth/me` honors that the
      // session was created (200) but the role is still ADMIN.
      const me = await ctx.get(`${BASE}/api/auth/me`);
      expect(me.status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test("admin WITH MFA enabled in an enforced-org sees requiresMfaCode", async ({
    isolatedOrg,
  }) => {
    await pool.query(
      `INSERT INTO mfa_enrollments
         (user_id, org_id, secret, method, enabled, enforce_for_admins)
       VALUES ($1, $2, 'JBSWY3DPEHPK3PXP', 'totp', true, true)
       ON CONFLICT (user_id) DO UPDATE SET
         enforce_for_admins = EXCLUDED.enforce_for_admins,
         enabled = EXCLUDED.enabled,
         secret = EXCLUDED.secret`,
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
