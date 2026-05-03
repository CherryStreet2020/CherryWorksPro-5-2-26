import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import { freshIp } from "../tests/helpers/po/auth";

/**
 * Defense-in-depth regression for the mfaPending session gate.
 *
 * After /api/auth/login returns {requiresMfaCode:true} the server has set
 * req.session.mfaPending=true and userId/orgId/role are populated. Without
 * the gate, a password-only authenticated session for an MFA-enforced admin
 * could reach role-protected endpoints (requireAdmin, requireManagerOrAbove)
 * before completing the second factor — a broken-access-control flaw.
 *
 * This spec exercises the API contract directly:
 *   1. Login with MFA enforcement → session is mfaPending=true.
 *   2. /api/auth/me, a requireAdmin endpoint, and a requireManagerOrAbove
 *      endpoint must all return 401 { mfaPending: true }.
 *   3. After /api/mfa/totp/validate succeeds (dev-bypass "000000"),
 *      the same endpoints succeed (200) because the flag is cleared.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = "Sup3r$ecure!E2E";

async function hash(): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hashSync(PASS, 10);
}

async function seedMfaAdmin(): Promise<{ orgId: string; userId: string; email: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `mfa-gate-${stamp}@e2e.cherryworks.test`;
  const orgSlug = `mfa-gate-e2e-${stamp}`;
  const orgName = `MFA Gate E2E ${stamp}`;
  const password = await hash();

  const orgRes = await pool.query(
    `INSERT INTO orgs (name, slug, plan_tier, subscription_status, max_team_members, trial_ends_at)
     VALUES ($1, $2, 'TRIAL', 'trialing', 999, NOW() + INTERVAL '14 days')
     RETURNING id`,
    [orgName, orgSlug],
  );
  const orgId = orgRes.rows[0].id as string;

  const userRes = await pool.query(
    `INSERT INTO users (org_id, email, password, name, first_name, last_name, role, is_active, onboarding_complete, temp_password)
     VALUES ($1, $2, $3, 'MFA Gate Admin', 'MFA', 'GateAdmin', 'ADMIN', true, true, false)
     RETURNING id`,
    [orgId, email, password],
  );
  const userId = userRes.rows[0].id as string;

  await pool.query(
    `INSERT INTO mfa_enrollments (user_id, org_id, secret, method, enabled, recovery_codes, used_recovery_codes, webauthn_credentials, enforce_for_admins)
     VALUES ($1, $2, 'JBSWY3DPEHPK3PXP', 'totp', true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, true)`,
    [userId, orgId],
  );

  return { orgId, userId, email };
}

test.describe.serial("auth » MFA pending session gate", () => {
  const createdOrgIds: string[] = [];

  test.afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await pool.query(`DELETE FROM mfa_enrollments WHERE org_id = $1`, [orgId]).catch(() => {});
      await pool.query(`DELETE FROM audit_logs WHERE org_id = $1`, [orgId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE org_id = $1`, [orgId]).catch(() => {});
      await pool.query(`DELETE FROM orgs WHERE id = $1`, [orgId]).catch(() => {});
    }
    await pool.end();
  });

  test("mfaPending session is rejected by requireAuth, requireAdmin, requireManagerOrAbove until /api/mfa/totp/validate succeeds", async ({ baseURL }) => {
    const seed = await seedMfaAdmin();
    createdOrgIds.push(seed.orgId);

    const ctx: APIRequestContext = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });

    // Step 1: login with valid password → session.mfaPending=true.
    const loginRes = await ctx.post("/api/auth/login", {
      data: { email: seed.email, password: PASS },
    });
    expect(loginRes.status(), await loginRes.text()).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.requiresMfaCode).toBe(true);

    // Step 2: every protected surface must reject with 401 + mfaPending=true.
    const meBefore = await ctx.get("/api/auth/me");
    expect(meBefore.status()).toBe(401);
    expect((await meBefore.json()).mfaPending).toBe(true);

    const adminBefore = await ctx.get("/api/admin/audit-logs/actions");
    expect(adminBefore.status()).toBe(401);
    expect((await adminBefore.json()).mfaPending).toBe(true);

    const managerBefore = await ctx.get("/api/clients");
    expect(managerBefore.status()).toBe(401);
    expect((await managerBefore.json()).mfaPending).toBe(true);

    // Step 3: complete the challenge with the dev-bypass code. Mutating
    // routes require a CSRF double-submit token (cookie + header).
    const csrfRes = await ctx.get("/api/csrf-token");
    expect(csrfRes.status()).toBe(200);
    const csrfToken = (await csrfRes.json()).token as string;
    expect(csrfToken).toBeTruthy();
    const validate = await ctx.post("/api/mfa/totp/validate", {
      data: { code: "000000" },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(validate.status(), await validate.text()).toBe(200);
    expect((await validate.json()).verified).toBe(true);

    // Step 4: the same endpoints now succeed for the same session.
    const meAfter = await ctx.get("/api/auth/me");
    expect(meAfter.status()).toBe(200);
    expect((await meAfter.json()).email).toBe(seed.email);

    const adminAfter = await ctx.get("/api/admin/audit-logs/actions");
    expect(adminAfter.status()).toBe(200);

    const managerAfter = await ctx.get("/api/clients");
    expect(managerAfter.status()).toBe(200);

    await ctx.dispose();
  });
});
