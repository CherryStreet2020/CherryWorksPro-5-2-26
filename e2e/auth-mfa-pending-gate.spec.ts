import { test, expect } from "../tests/helpers/po/fixtures";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import { freshIp } from "../tests/helpers/po/auth";

// Defense-in-depth regression for the mfaPending session gate. After
// /api/auth/login returns {requiresMfaCode:true} the server has set
// req.session.mfaPending=true; without the gate, that password-only
// session could reach role-protected endpoints before the second factor.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

test.afterAll(async () => {
  await pool.end();
});

async function enableEnrolledMfa(userId: string, orgId: string, enabled = true) {
  await pool.query(
    `INSERT INTO mfa_enrollments
       (user_id, org_id, secret, method, enabled, recovery_codes,
        used_recovery_codes, webauthn_credentials, enforce_for_admins)
     VALUES ($1, $2, 'JBSWY3DPEHPK3PXP', 'totp', $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, true)
     ON CONFLICT (user_id) DO UPDATE
       SET enforce_for_admins = true, enabled = $3, secret = 'JBSWY3DPEHPK3PXP'`,
    [userId, orgId, enabled],
  );
}

test.describe.serial("auth » MFA pending session gate", () => {
  test("mfaPending session is rejected by requireAuth, requireAdmin, requireManagerOrAbove until /api/mfa/totp/validate succeeds", async ({ baseURL, isolatedOrg }) => {
    await enableEnrolledMfa(isolatedOrg.userId, isolatedOrg.orgId);

    const ctx: APIRequestContext = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });

    const loginRes = await ctx.post("/api/auth/login", {
      data: { email: isolatedOrg.email, password: isolatedOrg.password },
    });
    expect(loginRes.status(), await loginRes.text()).toBe(200);
    expect((await loginRes.json()).requiresMfaCode).toBe(true);

    const meBefore = await ctx.get("/api/auth/me");
    expect(meBefore.status()).toBe(401);
    expect((await meBefore.json()).mfaPending).toBe(true);

    const adminBefore = await ctx.get("/api/admin/audit-logs/actions");
    expect(adminBefore.status()).toBe(401);
    expect((await adminBefore.json()).mfaPending).toBe(true);

    const managerBefore = await ctx.get("/api/clients");
    expect(managerBefore.status()).toBe(401);
    expect((await managerBefore.json()).mfaPending).toBe(true);

    const csrfToken = (await (await ctx.get("/api/csrf-token")).json()).token as string;
    const validate = await ctx.post("/api/mfa/totp/validate", {
      data: { code: "000000" },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(validate.status(), await validate.text()).toBe(200);
    expect((await validate.json()).verified).toBe(true);

    const meAfter = await ctx.get("/api/auth/me");
    expect(meAfter.status()).toBe(200);
    expect((await meAfter.json()).email).toBe(isolatedOrg.email);

    expect((await ctx.get("/api/admin/audit-logs/actions")).status()).toBe(200);
    expect((await ctx.get("/api/clients")).status()).toBe(200);

    await ctx.dispose();
  });

  test("enrolled user in mfaPending=code cannot reach /api/mfa/totp/setup or /verify (overwrite-secret bypass)", async ({ baseURL, isolatedOrg }) => {
    await enableEnrolledMfa(isolatedOrg.userId, isolatedOrg.orgId);

    const ctx: APIRequestContext = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });

    const loginRes = await ctx.post("/api/auth/login", {
      data: { email: isolatedOrg.email, password: isolatedOrg.password },
    });
    expect(loginRes.status()).toBe(200);
    expect((await loginRes.json()).requiresMfaCode).toBe(true);

    const csrfToken = (await (await ctx.get("/api/csrf-token")).json()).token as string;

    // Attack: try to overwrite the existing enabled TOTP secret. Both
    // endpoints must be blocked by the reason-aware gate.
    const setup = await ctx.post("/api/mfa/totp/setup", {
      headers: { "x-csrf-token": csrfToken },
    });
    expect(setup.status()).toBe(401);
    expect((await setup.json()).mfaPending).toBe(true);

    const verify = await ctx.post("/api/mfa/totp/verify", {
      data: { code: "000000" },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(verify.status()).toBe(401);
    expect((await verify.json()).mfaPending).toBe(true);

    const { rows } = await pool.query(
      `SELECT secret FROM mfa_enrollments WHERE user_id = $1`,
      [isolatedOrg.userId],
    );
    expect(rows[0]?.secret).toBe("JBSWY3DPEHPK3PXP");

    await ctx.dispose();
  });
});
