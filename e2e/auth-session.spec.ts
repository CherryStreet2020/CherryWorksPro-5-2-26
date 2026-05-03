/**
 * Session (Task #436): idle-timeout via direct PG mutation,
 * change-password happy + mismatch + tempPassword auto-mount.
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
      const login = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      });
      expect(login.status()).toBe(200);
      expect((await ctx.get(`${BASE}/api/auth/me`)).status()).toBe(200);

      const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
      const update = await pool.query(
        `UPDATE session
            SET sess = jsonb_set(sess::jsonb, '{lastActivity}', to_jsonb($1::bigint), true)::json
          WHERE (sess::jsonb ->> 'userId') = $2`,
        [oneHourAgoMs, isolatedOrg.userId],
      );
      expect(update.rowCount).toBeGreaterThan(0);

      expect((await ctx.get(`${BASE}/api/auth/me`)).status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Change-password", () => {
  test("happy: current+new swap; new password authenticates, old fails", async ({
    isolatedOrg,
  }) => {
    const newPass = `Changed!${Date.now()}A1`;
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      expect((await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      })).status()).toBe(200);
      const csrf = (await ctx.get(`${BASE}/api/csrf-token`)).headers()["x-csrf-token"] || "";

      const change = await ctx.patch(`${BASE}/api/auth/change-password`, {
        headers: { "X-CSRF-Token": csrf },
        data: { currentPassword: isolatedOrg.password, newPassword: newPass },
      });
      expect(change.status()).toBe(200);

      const ctx2 = await pwRequest.newContext({ baseURL: BASE });
      try {
        expect((await ctx2.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: isolatedOrg.password },
        })).status()).toBe(401);
        expect((await ctx2.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: newPass },
        })).status()).toBe(200);
      } finally {
        await ctx2.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("mismatch: wrong currentPassword returns 401, original still works", async ({
    isolatedOrg,
  }) => {
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      expect((await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      })).status()).toBe(200);
      const csrf = (await ctx.get(`${BASE}/api/csrf-token`)).headers()["x-csrf-token"] || "";

      const change = await ctx.patch(`${BASE}/api/auth/change-password`, {
        headers: { "X-CSRF-Token": csrf },
        data: {
          currentPassword: "TotallyTheWrongPassword!1",
          newPassword: `ShouldNotApply!${Date.now()}A1`,
        },
      });
      expect(change.status()).toBe(401);

      const ctx2 = await pwRequest.newContext({ baseURL: BASE });
      try {
        expect((await ctx2.post(`${BASE}/api/auth/login`, {
          data: { email: isolatedOrg.email, password: isolatedOrg.password },
        })).status()).toBe(200);
      } finally {
        await ctx2.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("tempPassword auto-mount: app routes to /change-password regardless of URL", async ({
    isolatedOrg,
    page,
  }) => {
    await pool.query(`UPDATE users SET temp_password = true WHERE id = $1`, [
      isolatedOrg.userId,
    ]);
    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', isolatedOrg.email);
    await page.fill('[data-testid="input-password"]', isolatedOrg.password);
    await page.click('[data-testid="button-login"]');

    await expect(
      page.locator('[data-testid="text-change-password-title"]'),
    ).toBeVisible({ timeout: 15000 });
    // The "current password" field is hidden in the temp-password branch.
    await expect(
      page.locator('[data-testid="input-current-password"]'),
    ).toHaveCount(0);
  });
});
