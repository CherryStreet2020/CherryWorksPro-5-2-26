import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { freshIp, BASE } from "../tests/helpers/po/auth";

/**
 * MFA challenge UI on the login page.
 *
 * The product behavior under test:
 *   1. When an org enforces MFA for admins and the admin already has an
 *      enabled enrollment, /api/auth/login returns {requiresMfaCode:true}.
 *      login.tsx should swap to the TOTP form, NOT set the user, and
 *      accept "000000" as the dev/test bypass code.
 *   2. When MFA is enforced but the admin has no enrollment yet, the
 *      response is {requiresMfaSetup:true} and the page should show a
 *      "set up MFA" CTA pointing at /settings/security.
 *
 * Both branches reuse a fresh isolated org so they can't race the shared
 * seed admin. The test seeds the org+user+enrollment via direct SQL.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PASS = "Sup3r$ecure!E2E";
// Pre-hashed bcrypt of PASS (10 rounds). Pre-hashing keeps the spec fast and
// avoids importing server-side auth modules into Playwright.
async function hash(): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hashSync(PASS, 10);
}

async function seedOrg(opts: { withEnrollment: boolean }): Promise<{ orgId: string; userId: string; email: string; orgSlug: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `mfa-${stamp}@e2e.cherryworks.test`;
  const orgSlug = `mfa-e2e-${stamp}`;
  const orgName = `MFA E2E ${stamp}`;
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
     VALUES ($1, $2, $3, 'MFA Admin', 'MFA', 'Admin', 'ADMIN', true, true, false)
     RETURNING id`,
    [orgId, email, password],
  );
  const userId = userRes.rows[0].id as string;

  // Always seed an "enforce_for_admins" row on the org so the login path
  // takes the MFA branch. If withEnrollment, also enable the user's TOTP.
  await pool.query(
    `INSERT INTO mfa_enrollments (user_id, org_id, secret, method, enabled, recovery_codes, used_recovery_codes, webauthn_credentials, enforce_for_admins)
     VALUES ($1, $2, $3, 'totp', $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, true)`,
    [userId, orgId, "JBSWY3DPEHPK3PXP", opts.withEnrollment],
  );

  return { orgId, userId, email, orgSlug };
}

test.describe.serial("auth » MFA login UI", () => {
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

  test("requiresMfaCode → renders TOTP form, accepts dev bypass code, lands authenticated", async ({ page }) => {
    const seed = await seedOrg({ withEnrollment: true });
    createdOrgIds.push(seed.orgId);

    await page.setExtraHTTPHeaders({ "X-Forwarded-For": freshIp() });
    await page.goto(`${BASE}/login`);

    await page.getByTestId("input-email").fill(seed.email);
    await page.getByTestId("input-password").fill(PASS);
    await page.getByTestId("button-login").click();

    // The MFA challenge form should appear; user should NOT be navigated
    // away from /login because the session is still mfaPending.
    const mfaForm = page.getByTestId("state-mfa-code");
    await expect(mfaForm).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login$/);

    // Wrong code → inline error, still on /login.
    await page.getByTestId("input-mfa-code").fill("111111");
    await page.getByTestId("button-mfa-verify").click();
    await expect(page.getByTestId("text-mfa-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // Dev bypass code "000000" is accepted by /api/mfa/totp/validate.
    await page.getByTestId("input-mfa-code").fill("000000");
    await page.getByTestId("button-mfa-verify").click();

    // Successful verification navigates off /login.
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 8000 });

    // /api/auth/me should now return the user (mfaPending cleared / not enforced for the read).
    const meRes = await page.request.get(`${BASE}/api/auth/me`);
    expect(meRes.status()).toBe(200);
    const me = await meRes.json();
    expect(me.email).toBe(seed.email);
  });

  test("requiresMfaSetup → renders inline setup, completes via dev bypass, lands authenticated", async ({ page }) => {
    const seed = await seedOrg({ withEnrollment: false });
    createdOrgIds.push(seed.orgId);

    await page.setExtraHTTPHeaders({ "X-Forwarded-For": freshIp() });
    await page.goto(`${BASE}/login`);

    await page.getByTestId("input-email").fill(seed.email);
    await page.getByTestId("input-password").fill(PASS);
    await page.getByTestId("button-login").click();

    // The setup-required panel renders inline because /api/auth/me would
    // 401 while mfaPending=true; navigating to /settings/security would
    // bounce back to /login. The MFA gate's reason-aware allowlist is
    // what makes /api/mfa/totp/{setup,verify} reachable here.
    const setupBlock = page.getByTestId("state-mfa-setup-required");
    await expect(setupBlock).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login$/);

    // Inline setup auto-fires beginMfaSetup(), which POSTs /api/mfa/totp/setup.
    await expect(page.getByTestId("text-mfa-setup-secret")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("list-mfa-setup-recovery-codes")).toBeVisible();

    // Dev bypass code "000000" completes verify in non-prod; on success
    // the gate clears mfaPending and the page navigates to "/".
    await page.getByTestId("input-mfa-setup-code").fill("000000");
    await page.getByTestId("button-mfa-setup-verify").click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 8000 });

    const meRes = await page.request.get(`${BASE}/api/auth/me`);
    expect(meRes.status()).toBe(200);
    expect((await meRes.json()).email).toBe(seed.email);

    // The enrollment row should now be enabled with the issued secret.
    const { rows } = await pool.query(
      `SELECT enabled, secret FROM mfa_enrollments WHERE user_id = $1`,
      [seed.userId],
    );
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.secret).not.toBe("JBSWY3DPEHPK3PXP");
    expect(typeof rows[0]?.secret).toBe("string");
    expect((rows[0]?.secret as string).length).toBeGreaterThan(0);
  });

  test("MFA cancel button restores the email/password form", async ({ page }) => {
    const seed = await seedOrg({ withEnrollment: true });
    createdOrgIds.push(seed.orgId);

    await page.setExtraHTTPHeaders({ "X-Forwarded-For": freshIp() });
    await page.goto(`${BASE}/login`);

    await page.getByTestId("input-email").fill(seed.email);
    await page.getByTestId("input-password").fill(PASS);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("state-mfa-code")).toBeVisible();
    await page.getByTestId("button-mfa-cancel").click();

    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("button-login")).toBeVisible();
  });
});
