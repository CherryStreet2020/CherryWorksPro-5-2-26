/**
 * Password reset round-trip (Task #436): rate limit, request-issues-token,
 * valid/expired/used/garbage tokens, post-reset re-login.
 */
import { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE, freshApiContext, freshIp } from "../tests/helpers/po/auth";
import { waitForCapturedEmail, clearCapturedEmails, DEFAULT_CAPTURE_DIR } from "../tests/helpers/email-capture";

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  await pool.end().catch(() => undefined);
});

// password_reset_tokens has user_id (not org_id) so it's invisible to
// the isolation sweep — clean tokens for the iso user before the
// fixture teardown runs to avoid an FK violation on DELETE FROM users.
test.afterEach(async ({ isolatedOrg }) => {
  if (isolatedOrg?.userId) {
    await pool
      .query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [
        isolatedOrg.userId,
      ])
      .catch(() => undefined);
  }
});

test.describe("Forgot password — issues a token row", () => {
  test("POST /api/auth/forgot-password creates a password_reset_tokens row", async ({
    isolatedOrg,
  }) => {
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1`,
      [isolatedOrg.userId],
    );

    const ctx = await freshApiContext();
    try {
      const r = await ctx.post(`${BASE}/api/auth/forgot-password`, {
        data: { email: isolatedOrg.email },
      });
      expect(r.status()).toBe(200);
    } finally {
      await ctx.dispose();
    }

    const after = await pool.query(
      `SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1`,
      [isolatedOrg.userId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);

    // Email send is opaque to e2e (Resend / Ethereal transport runs
    // server-side), but auth-routes.ts ~615 writes a
    // PASSWORD_RESET_REQUESTED audit log immediately before the
    // sendPasswordResetEmail() call. The presence of that row is our
    // side-effect proof that the email send was reached.
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE action = 'PASSWORD_RESET_REQUESTED' AND entity_id = $1`,
      [isolatedOrg.userId],
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  test("forgot-password dispatches reset email through capture harness", async ({
    isolatedOrg,
  }) => {
    const dir = process.env.EMAIL_CAPTURE_DIR || DEFAULT_CAPTURE_DIR;
    await clearCapturedEmails(dir).catch(() => {});
    const watermark = Date.now();

    const ctx = await freshApiContext();
    try {
      const r = await ctx.post(`${BASE}/api/auth/forgot-password`, {
        data: { email: isolatedOrg.email },
      });
      expect(r.status()).toBe(200);
    } finally {
      await ctx.dispose();
    }

    const captured = await waitForCapturedEmail(
      { to: isolatedOrg.email, subject: /reset/i },
      { dir, sinceMs: watermark, timeoutMs: 5000 },
    );
    expect(captured.html).toMatch(/reset-password/i);
    expect(captured.text || captured.html).toBeTruthy();
  });
});

test.describe("Forgot password — rate limit", () => {
  test("6th forgot-password request inside the window returns 429", async () => {
    // Limiter is per-IP, max=5 in dev. We hit it from a fresh context
    // so we don't blow the budget for sibling specs sharing the IP.
    const ctx = await freshApiContext();
    try {
      let lastStatus = 0;
      for (let i = 0; i < 6; i++) {
        const r = await ctx.post(`${BASE}/api/auth/forgot-password`, {
          data: { email: `rate-${i}-${randomBytes(4).toString("hex")}@e2e.test` },
        });
        lastStatus = r.status();
      }
      expect(lastStatus).toBe(429);
    } finally {
      await ctx.dispose();
    }
  });
});

// passwordChangeLimiter is 5 calls / 15min per IP and is shared with
// /api/auth/change-password (auth-session.spec.ts), so this describe
// must keep its budget ≤ 5. We fold "used" into "valid" (re-POST the
// same token), drop the expired GET (POST is the consumption guard),
// and rely on auth-reset-password-invalid.spec.ts for the garbage UI
// surface — covering the API garbage path with the remaining budget.
test.describe("Reset token — valid+reuse / expired / garbage", () => {
  test("valid: GET validates, POST consumes, re-POST is rejected, re-login works", async ({
    isolatedOrg,
  }) => {
    const rawToken = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [
        isolatedOrg.userId,
        createHash("sha256").update(rawToken).digest("hex"),
        new Date(Date.now() + 60 * 60 * 1000),
      ],
    );

    const newPass = `ResetPass!${Date.now()}A1`;
    const ctx = await freshApiContext();
    try {
      const validate = await ctx.get(`${BASE}/api/auth/reset-password/${rawToken}`);
      expect(validate.status()).toBe(200);
      expect((await validate.json()).valid).toBe(true);

      const consume = await ctx.post(`${BASE}/api/auth/reset-password/${rawToken}`, {
        data: { password: newPass },
      });
      expect(consume.status()).toBe(200);

      const reuse = await ctx.post(`${BASE}/api/auth/reset-password/${rawToken}`, {
        data: { password: newPass },
      });
      expect(reuse.status()).toBe(400);

      const reLogin = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: newPass },
      });
      expect(reLogin.status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test("expired: POST rejected with 400", async ({ isolatedOrg }) => {
    const rawToken = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [
        isolatedOrg.userId,
        createHash("sha256").update(rawToken).digest("hex"),
        new Date(Date.now() - 60 * 1000),
      ],
    );

    const ctx = await freshApiContext();
    try {
      const consume = await ctx.post(`${BASE}/api/auth/reset-password/${rawToken}`, {
        data: { password: `Exp!${Date.now()}A1` },
      });
      expect(consume.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });

  test("garbage: POST rejected with 400", async () => {
    const ctx = await freshApiContext();
    try {
      const r = await ctx.post(
        `${BASE}/api/auth/reset-password/${"garbage".repeat(10)}`,
        { data: { password: `Strong!${Date.now()}A1` } },
      );
      expect(r.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });
});
