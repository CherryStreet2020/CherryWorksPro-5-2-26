// Session: idle-timeout (API JSON 401 + HTML 302 to /login?auth=required)
// and change-password (happy / mismatch / tempPassword auto-mount).
import { Pool } from "pg";
import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE, freshApiContext, freshIp } from "../tests/helpers/po/auth";

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  await pool.end().catch(() => undefined);
});

async function expireSession(userId: string) {
  const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
  const upd = await pool.query(
    `UPDATE session
        SET sess = jsonb_set(sess::jsonb, '{lastActivity}', to_jsonb($1::bigint), true)::json
      WHERE (sess::jsonb ->> 'userId') = $2`,
    [oneHourAgoMs, userId],
  );
  expect(upd.rowCount).toBeGreaterThan(0);
}

test.describe("Session — idle timeout", () => {
  test("API: idle session 401s the next request", async ({ isolatedOrg }) => {
    const ctx = await freshApiContext();
    try {
      expect((await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: isolatedOrg.password },
      })).status()).toBe(200);
      expect((await ctx.get(`${BASE}/api/auth/me`)).status()).toBe(200);

      await expireSession(isolatedOrg.userId);

      expect((await ctx.get(`${BASE}/api/auth/me`)).status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("UI: idle session redirects HTML navigation to /login?auth=required", async ({
    isolatedOrg,
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "X-Forwarded-For": freshIp() });
    await page.goto("/login");
    await page.fill('[data-testid="input-email"]', isolatedOrg.email);
    await page.fill('[data-testid="input-password"]', isolatedOrg.password);
    await page.click('[data-testid="button-login"]');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });

    // Quiesce + park so background XHRs can't bump lastActivity past
    // our UPDATE; then expire the session row in PG.
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await page.goto("about:blank");

    await expireSession(isolatedOrg.userId);

    // Server-side redirect: an HTML navigation must land on /login?auth=required
    // without any client-side fallback rendering needed.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login\?auth=required/, { timeout: 10000 });
  });
});

test.describe("Change-password", () => {
  test("happy: new password authenticates, old fails", async ({ isolatedOrg }) => {
    const newPass = `Changed!${Date.now()}A1`;
    const ctx = await freshApiContext();
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

      const ctx2 = await freshApiContext();
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

  test("mismatch: wrong currentPassword 401s, original still works", async ({ isolatedOrg }) => {
    const ctx = await freshApiContext();
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

      const ctx2 = await freshApiContext();
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
    await expect(
      page.locator('[data-testid="input-current-password"]'),
    ).toHaveCount(0);
  });
});
