import { test, expect } from "../tests/helpers/po/fixtures";
import { Pool } from "pg";

// MFA login UI: TOTP code branch, inline setup branch, cancel.
// Uses the isolatedOrg fixture (per-test fresh ADMIN with known password).
// Each test additionally seeds an mfa_enrollments row to drive the
// MFA-enforced branches of /api/auth/login.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

test.afterAll(async () => {
  await pool.end();
});

async function enableMfaEnforcement(opts: {
  userId: string;
  orgId: string;
  enabled: boolean;
}) {
  await pool.query(
    `INSERT INTO mfa_enrollments
       (user_id, org_id, secret, method, enabled, recovery_codes,
        used_recovery_codes, webauthn_credentials, enforce_for_admins)
     VALUES ($1, $2, $3, 'totp', $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, true)
     ON CONFLICT (user_id) DO UPDATE
       SET enforce_for_admins = true, enabled = $4, secret = $3`,
    [opts.userId, opts.orgId, "JBSWY3DPEHPK3PXP", opts.enabled],
  );
}

test.describe.serial("auth » MFA login UI", () => {
  test("requiresMfaCode → renders TOTP form, accepts dev bypass code, lands authenticated", async ({ page, isolatedOrg }) => {
    await enableMfaEnforcement({ userId: isolatedOrg.userId, orgId: isolatedOrg.orgId, enabled: true });

    await page.goto("/login");
    await page.getByTestId("input-email").fill(isolatedOrg.email);
    await page.getByTestId("input-password").fill(isolatedOrg.password);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("state-mfa-code")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login$/);

    await page.getByTestId("input-mfa-code").fill("111111");
    await page.getByTestId("button-mfa-verify").click();
    await expect(page.getByTestId("text-mfa-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByTestId("input-mfa-code").fill("000000");
    await page.getByTestId("button-mfa-verify").click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 8000 });

    const meRes = await page.request.get("/api/auth/me");
    expect(meRes.status()).toBe(200);
    expect((await meRes.json()).email).toBe(isolatedOrg.email);
  });

  test("requiresMfaSetup → renders inline setup, completes via dev bypass, lands authenticated", async ({ page, isolatedOrg }) => {
    await enableMfaEnforcement({ userId: isolatedOrg.userId, orgId: isolatedOrg.orgId, enabled: false });

    await page.goto("/login");
    await page.getByTestId("input-email").fill(isolatedOrg.email);
    await page.getByTestId("input-password").fill(isolatedOrg.password);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("state-mfa-setup-required")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("text-mfa-setup-secret")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("list-mfa-setup-recovery-codes")).toBeVisible();

    await page.getByTestId("input-mfa-setup-code").fill("000000");
    await page.getByTestId("button-mfa-setup-verify").click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 8000 });

    const meRes = await page.request.get("/api/auth/me");
    expect(meRes.status()).toBe(200);
    expect((await meRes.json()).email).toBe(isolatedOrg.email);

    const { rows } = await pool.query(
      `SELECT enabled, secret FROM mfa_enrollments WHERE user_id = $1`,
      [isolatedOrg.userId],
    );
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.secret).not.toBe("JBSWY3DPEHPK3PXP");
    expect((rows[0]?.secret as string).length).toBeGreaterThan(0);
  });

  test("MFA cancel button restores the email/password form", async ({ page, isolatedOrg }) => {
    await enableMfaEnforcement({ userId: isolatedOrg.userId, orgId: isolatedOrg.orgId, enabled: true });

    await page.goto("/login");
    await page.getByTestId("input-email").fill(isolatedOrg.email);
    await page.getByTestId("input-password").fill(isolatedOrg.password);
    await page.getByTestId("button-login").click();

    await expect(page.getByTestId("state-mfa-code")).toBeVisible();
    await page.getByTestId("button-mfa-cancel").click();

    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("button-login")).toBeVisible();
  });
});
