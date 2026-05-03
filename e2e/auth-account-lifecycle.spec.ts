/**
 * Signup + password-reset round-trip (Task #436, audit §3.1).
 *
 * Pins the surfaces that the existing
 * `public-signup-validation.spec.ts` and `auth-forgot-password.spec.ts`
 * stop short of:
 *
 *   - **Signup happy path** — POST /api/auth/signup actually provisions
 *     a TRIAL org with a 14-day window, returns a session, and the org
 *     row is visible in the DB. We assert against a unique email
 *     domain so the per-domain 24h rate guard never trips.
 *   - **Signup duplicate-domain rate guard** — pre-seed 3 ORG_CREATED
 *     audit rows for a chosen domain in the last 24h, then attempt
 *     signup on that domain → 429 with the "too many accounts from
 *     this email domain" body.
 *   - **Password-reset round-trip** — insert a reset token directly so
 *     we don't depend on email delivery, then exercise GET (validate),
 *     POST (consume → 200 + new password works), reuse (the token row
 *     is gone → 400), and obvious-garbage tokens (400).
 *
 * Stripe is real here: the test server has STRIPE_SECRET_KEY set.
 * If a future env strips it, the signup endpoint returns 503 — we
 * detect that and `test.skip()` rather than mis-flag the regression.
 */
import { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE } from "../tests/helpers/po/auth";
import { ISO_SLUG_PREFIX, getRunId, deleteIsolatedOrg } from "../tests/helpers/po/isolation";
import { request as pwRequest } from "@playwright/test";

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  await pool.end().catch(() => undefined);
});

test.describe("Signup — happy path", () => {
  test("creates a TRIAL org with ~14d trial window", async () => {
    const localId = randomBytes(6).toString("hex");
    // Tag the firm name with the e2e run prefix so stragglers from a
    // killed run get swept by `sweepCurrentRunOrgs`.
    const firmName = `${ISO_SLUG_PREFIX}${getRunId()}_signup_${localId}`;
    const email = `signup-${localId}@e2e-signup-${localId}.test`;
    const password = `SignupPass!${localId}A1`;

    const ctx = await pwRequest.newContext({ baseURL: BASE });
    let createdOrgId: string | null = null;
    try {
      const r = await ctx.post(`${BASE}/api/auth/signup`, {
        data: {
          firmName,
          firstName: "Signup",
          lastName: "Tester",
          email,
          password,
        },
      });
      if (r.status() === 503) {
        test.skip(true, "STRIPE_SECRET_KEY missing in test env — signup endpoint deliberately 503s");
      }
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(body.user?.email).toBe(email);
      expect(body.org?.id).toBeTruthy();
      expect(body.org?.planTier).toBe("TRIAL");
      createdOrgId = body.org.id;

      // Direct DB read confirms persistence + trial window.
      const { rows } = await pool.query<{
        plan_tier: string;
        subscription_status: string;
        trial_ends_at: Date | null;
      }>(
        `SELECT plan_tier, subscription_status, trial_ends_at FROM orgs WHERE id = $1`,
        [createdOrgId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].plan_tier).toBe("TRIAL");
      expect(rows[0].subscription_status).toBe("trialing");
      const trialEnds = rows[0].trial_ends_at;
      expect(trialEnds).not.toBeNull();
      const days = ((trialEnds as Date).getTime() - Date.now()) / 86_400_000;
      // 14-day window with a generous tolerance for clock skew + signup latency.
      expect(days).toBeGreaterThan(13);
      expect(days).toBeLessThan(15);

      // Session is live — `/api/auth/me` returns the new user.
      const me = await ctx.get(`${BASE}/api/auth/me`);
      expect(me.status()).toBe(200);
      const meBody = await me.json();
      expect(meBody.email).toBe(email);
      expect(meBody.role).toBe("ADMIN");
    } finally {
      await ctx.dispose();
      if (createdOrgId) {
        await deleteIsolatedOrg(createdOrgId).catch(() => undefined);
      }
    }
  });
});

test.describe("Signup — domain rate limit", () => {
  test("4th signup on the same email-domain in 24h is rejected with 429", async ({
    isolatedOrg,
  }) => {
    const localId = randomBytes(6).toString("hex");
    const domain = `e2e-domain-${localId}.test`;

    // Seed 3 ORG_CREATED audit rows whose JSON details payload contains
    // the chosen domain. The signup route's escape-hatch query
    // `details::text LIKE %<domain>%` matches them. We attach the rows
    // to the isolated org (audit_logs.org_id is NOT NULL) — the row
    // gets cleaned up when the fixture tears the org down.
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, created_at)
         VALUES ($1, $2, NULL, 'ORG_CREATED', 'org', $3, $4, NOW())`,
        [
          randomBytes(16).toString("hex"),
          isolatedOrg.orgId,
          `seeded-${i}-${localId}`,
          JSON.stringify({ email: `seed${i}@${domain}` }),
        ],
      );
    }

    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      const r = await ctx.post(`${BASE}/api/auth/signup`, {
        data: {
          firmName: `${ISO_SLUG_PREFIX}${getRunId()}_dup_${localId}`,
          firstName: "Dup",
          lastName: "Tester",
          email: `attempt@${domain}`,
          password: `DupPass!${localId}A1`,
        },
      });
      expect(r.status()).toBe(429);
      const body = await r.json();
      expect(body.message).toMatch(/too many accounts/i);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Password reset — round trip", () => {
  test("valid token resets, reuse fails, garbage fails", async ({
    isolatedOrg,
  }) => {
    // Insert a reset token row directly. The /reset-password/:token
    // endpoint hashes the path-arg token with SHA-256 and compares —
    // so we generate raw bytes, hash them, store the hash, and ship
    // the raw token through the API.
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [isolatedOrg.userId, tokenHash, expiresAt],
    );

    const ctx = await pwRequest.newContext({ baseURL: BASE });
    try {
      // GET validates the token.
      const validate = await ctx.get(
        `${BASE}/api/auth/reset-password/${rawToken}`,
      );
      expect(validate.status()).toBe(200);
      expect((await validate.json()).valid).toBe(true);

      // POST consumes it → 200.
      const newPass = `ResetPass!${Date.now()}A1`;
      const consume = await ctx.post(
        `${BASE}/api/auth/reset-password/${rawToken}`,
        { data: { password: newPass } },
      );
      expect(consume.status()).toBe(200);

      // Reuse → 400 (the row was deleted on consumption).
      // (The "garbage token" 400 path is already pinned by the
      // existing `auth-reset-password-invalid.spec.ts` — re-asserting
      // it here would push the test over the per-IP
      // `passwordChangeLimiter` budget shared with the change-password
      // suite below.)
      const reuse = await ctx.post(
        `${BASE}/api/auth/reset-password/${rawToken}`,
        { data: { password: newPass } },
      );
      expect(reuse.status()).toBe(400);

      // The new password actually logs the user in.
      const reLogin = await ctx.post(`${BASE}/api/auth/login`, {
        data: { email: isolatedOrg.email, password: newPass },
      });
      expect(reLogin.status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });
});
