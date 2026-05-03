/**
 * Idle-session timeout + change-password (Task #436, audit §3.1).
 *
 * Coverage:
 *   - **Idle timeout** — log in via API, expire the session row's
 *     `lastActivity` field directly in PG so the next protected request
 *     trips `SESSION_IDLE_TIMEOUT_MS` (server/routes.ts ~187-205) and
 *     returns 401. No 30-minute sleep required.
 *   - **Change-password happy path** — current+new password swap
 *     works, and the new password authenticates on a fresh login.
 *   - **Change-password mismatch** — wrong current password returns
 *     401 and leaves the password unchanged.
 *   - **TempPassword auto-mount** — if the user record has
 *     `temp_password = true`, navigating to ANY route after login
 *     auto-renders the change-password page (App.tsx:579 short-circuit)
 *     instead of the dashboard, even without manual `/change-password`
 *     navigation.
 */
import { Pool } from "pg";
import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE } from "../tests/helpers/po/auth";
import { request as pwRequest } from "@playwright/test";

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  await pool.end().catch(() => undefined);
});

test.describe("Session — idle timeout", () => {
  test("expiring lastActivity in the session row 401s the next request", async ({
    isolatedOrg,
  }) => {
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      // Fresh login establishes a row in the `session` table.
      const login = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      });
      expect(login.status()).toBe(200);
      // /api/auth/me works while session is fresh.
      const before = await ctx.get(`${BASE}/api/auth/me`);
      expect(before.status()).toBe(200);

      // Backdate `lastActivity` past SESSION_IDLE_TIMEOUT_MS (30 min).
      // We can't tell the SID from the cookie without parsing it, so
      // we update every session row owned by THIS user — there's only
      // one, because the fixture context just logged in.
      const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
      const update = await pool.query(
        `UPDATE session
            SET sess = jsonb_set(sess::jsonb, '{lastActivity}', to_jsonb($1::bigint), true)::json
          WHERE (sess::jsonb ->> 'userId') = $2`,
        [oneHourAgoMs, isolatedOrg.userId],
      );
      expect(update.rowCount).toBeGreaterThan(0);

      // The next protected call trips the idle-timeout middleware →
      // session destroyed → 401.
      const after = await ctx.get(`${BASE}/api/auth/me`);
      expect(after.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Change-password — happy + mismatch", () => {
  test("happy: current+new swap works, new password authenticates", async ({
    isolatedOrg,
  }) => {
    const newPass = `Changed!${Date.now()}A1`;
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      const login = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      });
      expect(login.status()).toBe(200);
      const csrf = (await ctx.get(`${BASE}/api/csrf-token`)).headers()["x-csrf-token"] || "";

      const change = await ctx.patch(`${BASE}/api/auth/change-password`, {
        headers: { "X-CSRF-Token": csrf },
        data: { currentPassword: isolatedOrg.password, newPassword: newPass },
      });
      expect(change.status()).toBe(200);

      // Old password should fail; new password should succeed.
      const ctx2 = await pwRequest.newContext({ baseURL: BASE });
      try {
        const oldFail = await ctx2.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: isolatedOrg.password },
        });
        expect(oldFail.status()).toBe(401);
        const newOk = await ctx2.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: newPass },
        });
        expect(newOk.status()).toBe(200);
      } finally {
        await ctx2.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("mismatch: wrong currentPassword returns 401 and password is unchanged", async ({
    isolatedOrg,
  }) => {
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      const login = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      });
      expect(login.status()).toBe(200);
      const csrf = (await ctx.get(`${BASE}/api/csrf-token`)).headers()["x-csrf-token"] || "";

      const change = await ctx.patch(`${BASE}/api/auth/change-password`, {
        headers: { "X-CSRF-Token": csrf },
        data: {
          currentPassword: "TotallyTheWrongPassword!1",
          newPassword: `ShouldNotApply!${Date.now()}A1`,
        },
      });
      expect(change.status()).toBe(401);

      // Original password still works.
      const ctx2 = await pwRequest.newContext({ baseURL: BASE });
      try {
        const stillOk = await ctx2.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: isolatedOrg.password },
        });
        expect(stillOk.status()).toBe(200);
      } finally {
        await ctx2.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Change-password — tempPassword auto-mount", () => {
  test("user with temp_password=true is auto-redirected to /change-password", async ({
    isolatedOrg,
    page,
  }) => {
    // Flip the user record so the tempPassword short-circuit in
    // App.tsx fires on the next render.
    await pool.query(
      `UPDATE users SET temp_password = true WHERE id = $1`,
      [isolatedOrg.userId],
    );

    // Log in via the UI so the React tree mounts and reads
    // /api/auth/me with the freshly-updated tempPassword flag.
    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', isolatedOrg.email);
    await page.fill('[data-testid="input-password"]', isolatedOrg.password);
    await page.click('[data-testid="button-login"]');

    // Even though we asked for `/`, App.tsx renders ChangePasswordPage
    // because user.tempPassword is true — assert by the page heading.
    await expect(
      page.locator('[data-testid="text-change-password-title"]'),
    ).toBeVisible({ timeout: 15000 });
    // The "current password" field is hidden in the temp-password
    // branch (see change-password.tsx — `!isTempPassword && (...)`).
    await expect(
      page.locator('[data-testid="input-current-password"]'),
    ).toHaveCount(0);
  });
});
