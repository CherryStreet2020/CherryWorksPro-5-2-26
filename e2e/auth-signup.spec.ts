// /signup coverage: per-field UI validation, password-strength API
// branches, happy-path TRIAL provisioning, multi-tenant email
// semantics (per-org uniqueness), and per-domain rate limit.
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { test, expect } from "../tests/helpers/po/fixtures";
import { BASE, freshApiContext, freshIp } from "../tests/helpers/po/auth";
import { ISO_SLUG_PREFIX, getRunId, deleteIsolatedOrg } from "../tests/helpers/po/isolation";

let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  await pool.end().catch(() => undefined);
});

test.describe("/signup form validation (UI)", () => {
  test("submit disabled until every required field + strong password", async ({
    page,
  }) => {
    await page.goto("/signup");
    await expect(page.locator('[data-testid="signup-form-card"]')).toBeVisible({
      timeout: 15000,
    });
    const submit = page.locator('[data-testid="button-signup-submit"]');
    await expect(submit).toBeDisabled();

    const id = Date.now();
    await page.fill('[data-testid="input-firm-name"]', `QA ${id}`);
    await expect(submit).toBeDisabled();
    await page.fill('[data-testid="input-signup-firstName"]', "Q");
    await expect(submit).toBeDisabled();
    await page.fill('[data-testid="input-signup-lastName"]', "A");
    await expect(submit).toBeDisabled();
    await page.fill('[data-testid="input-signup-email"]', `qa-${id}@example.com`);
    await expect(submit).toBeDisabled();

    // Each individual strength rule violation must keep submit disabled.
    for (const weak of ["short", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"]) {
      await page.fill('[data-testid="input-signup-password"]', weak);
      await expect(submit).toBeDisabled();
    }

    await page.fill('[data-testid="input-signup-password"]', "StrongPass1!");
    await expect(submit).toBeEnabled({ timeout: 5000 });
  });
});

test.describe("/signup password strength (API)", () => {
  test.describe.configure({ mode: "serial" });
  // Hit the API directly so we can assert the exact error message
  // from validatePasswordStrength() per rule.
  const cases: Array<[string, RegExp]> = [
    ["short", /at least 8 characters/i],
    ["alllowercase1", /uppercase/i],
    ["ALLUPPERCASE1", /lowercase/i],
    ["NoDigitsHere", /number/i],
  ];
  for (const [pw, msg] of cases) {
    test(`rejects ${JSON.stringify(pw)} with ${msg}`, async () => {
      const id = randomBytes(4).toString("hex");
      const ctx = await freshApiContext();
      try {
        const r = await ctx.post(`${BASE}/api/auth/signup`, {
          data: {
            firmName: `${ISO_SLUG_PREFIX}${getRunId()}_pw_${id}`,
            firstName: "Pw",
            lastName: "Test",
            email: `pw-${id}@e2e-pw-${id}.test`,
            password: pw,
          },
        });
        expect(r.status()).toBe(400);
        expect((await r.json()).message).toMatch(msg);
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("/signup happy path", () => {
  test("creates TRIAL org with 14-day window, redirects, session live", async ({
    page,
  }) => {
    const id = randomBytes(6).toString("hex");
    const firmName = `${ISO_SLUG_PREFIX}${getRunId()}_signup_${id}`;
    const email = `signup-${id}@e2e-signup-${id}.test`;
    const password = `SignupPass!${id}A1`;
    let createdOrgId: string | null = null;

    try {
      // Drive the API for the actual provisioning so the test isn't
      // gated by HTML5 validation, then verify the UI redirects to
      // the authenticated shell. Use a unique X-Forwarded-For so the
      // per-IP signupLimiter (5/15min) is isolated from sibling specs.
      await page.setExtraHTTPHeaders({ "X-Forwarded-For": freshIp() });
      await page.goto("/signup");
      const ctx = page.context().request;
      const r = await ctx.post(`${BASE}/api/auth/signup`, {
        data: { firmName, firstName: "Signup", lastName: "Tester", email, password },
      });
      if (r.status() === 503) {
        test.skip(true, "STRIPE_SECRET_KEY missing in test env");
      }
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(body.user.email).toBe(email);
      expect(body.org.planTier).toBe("TRIAL");
      createdOrgId = body.org.id;

      const { rows } = await pool.query(
        `SELECT plan_tier, subscription_status, trial_ends_at FROM orgs WHERE id = $1`,
        [createdOrgId],
      );
      expect(rows[0].plan_tier).toBe("TRIAL");
      expect(rows[0].subscription_status).toBe("trialing");
      const days = ((rows[0].trial_ends_at as Date).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(13);
      expect(days).toBeLessThan(15);

      const me = await ctx.get(`${BASE}/api/auth/me`);
      expect(me.status()).toBe(200);
      expect((await me.json()).role).toBe("ADMIN");

      // Drive the browser to "/" and confirm we land in the
      // authenticated shell (not bounced to /login).
      await page.goto("/");
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
    } finally {
      if (createdOrgId) {
        await deleteIsolatedOrg(createdOrgId).catch(() => undefined);
      }
    }
  });
});

test.describe("/signup multi-tenant email semantics", () => {
  test("same email + DIFFERENT firmName succeeds in a separate org", async ({
    isolatedOrg,
  }) => {
    const id = randomBytes(4).toString("hex");
    const firmName = `${ISO_SLUG_PREFIX}${getRunId()}_multi_${id}`;
    const ctx = await freshApiContext();
    let createdOrgId: string | null = null;
    try {
      const r = await ctx.post(`${BASE}/api/auth/signup`, {
        data: {
          firmName,
          firstName: "Multi",
          lastName: "Tenant",
          email: isolatedOrg.email,
          password: `MultiPass!${id}A1`,
        },
      });
      if (r.status() === 503) test.skip(true, "STRIPE_SECRET_KEY missing");
      expect(r.status()).toBe(200);
      const body = await r.json();
      createdOrgId = body.org.id;
      expect(body.org.id).not.toBe(isolatedOrg.orgId);
      expect(body.user.email).toBe(isolatedOrg.email);
    } finally {
      if (createdOrgId) {
        await deleteIsolatedOrg(createdOrgId).catch(() => undefined);
      }
      await ctx.dispose();
    }
  });

  test("same firmName auto-suffixes the slug (no collision error)", async ({
    isolatedOrg,
  }) => {
    const ctx = await freshApiContext();
    let createdOrgId: string | null = null;
    try {
      const id = randomBytes(4).toString("hex");
      const r = await ctx.post(`${BASE}/api/auth/signup`, {
        data: {
          firmName: isolatedOrg.slug.replace(/-/g, " "),
          firstName: "Slug",
          lastName: "Collide",
          email: `slug-collide-${id}@e2e-collide-${id}.test`,
          password: `Coll!${id}A1`,
        },
      });
      if (r.status() === 503) test.skip(true, "STRIPE_SECRET_KEY missing");
      expect(r.status()).toBe(200);
      const body = await r.json();
      createdOrgId = body.org.id;
      expect(body.org.slug).not.toBe(isolatedOrg.slug);
    } finally {
      if (createdOrgId) {
        await deleteIsolatedOrg(createdOrgId).catch(() => undefined);
      }
      await ctx.dispose();
    }
  });
});

test.describe("/signup duplicate-email contract", () => {
  // Production contract: email uniqueness is scoped per-org by the
  // `users_org_email_unique` index on `(orgId, email)`. /signup always
  // creates a new org so it cannot itself trip the constraint, but a
  // second user-row insert into the SAME org with the same email MUST
  // be rejected by the DB. This locks down both halves explicitly.
  test("(orgId, email) is unique: second user with the same email in the same org is rejected", async ({ isolatedOrg }) => {
    let threw = false;
    try {
      await pool.query(
        `INSERT INTO users (org_id, email, password, name, first_name, last_name, role,
                            is_active, onboarding_complete, temp_password)
         VALUES ($1, $2, 'x', 'Dup', 'Dup', 'User', 'TEAM_MEMBER', true, true, false)`,
        [isolatedOrg.orgId, isolatedOrg.email],
      );
    } catch (err: any) {
      threw = true;
      expect(String(err?.message || err)).toMatch(/unique|duplicate/i);
    }
    expect(threw).toBe(true);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND email = $2`,
      [isolatedOrg.orgId, isolatedOrg.email],
    );
    expect(rows[0].n).toBe(1);
  });

  test("/signup with the same email in a different org succeeds (multi-tenant by design)", async ({ isolatedOrg }) => {
    const id = randomBytes(4).toString("hex");
    const ctx = await freshApiContext();
    let createdOrgId: string | null = null;
    try {
      const r = await ctx.post(`${BASE}/api/auth/signup`, {
        data: {
          firmName: `${ISO_SLUG_PREFIX}${getRunId()}_dup2_${id}`,
          firstName: "Dup",
          lastName: "Tenant",
          email: isolatedOrg.email,
          password: `DupPass!${id}A1`,
        },
      });
      if (r.status() === 503) test.skip(true, "STRIPE_SECRET_KEY missing");
      expect(r.status()).toBe(200);
      const body = await r.json();
      createdOrgId = body.org.id;
      expect(body.org.id).not.toBe(isolatedOrg.orgId);
    } finally {
      if (createdOrgId) {
        await deleteIsolatedOrg(createdOrgId).catch(() => undefined);
      }
      await ctx.dispose();
    }
  });
});

test.describe("/signup duplicate domain", () => {
  test("4th signup on the same email-domain in 24h returns 429", async ({
    isolatedOrg,
  }) => {
    const id = randomBytes(6).toString("hex");
    const domain = `e2e-domain-${id}.test`;
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, created_at)
         VALUES ($1, $2, NULL, 'ORG_CREATED', 'org', $3, $4, NOW())`,
        [
          randomBytes(16).toString("hex"),
          isolatedOrg.orgId,
          `seeded-${i}-${id}`,
          JSON.stringify({ email: `seed${i}@${domain}` }),
        ],
      );
    }

    const ctx = await freshApiContext();
    try {
      const r = await ctx.post(`${BASE}/api/auth/signup`, {
        data: {
          firmName: `${ISO_SLUG_PREFIX}${getRunId()}_dup_${id}`,
          firstName: "Dup",
          lastName: "Domain",
          email: `attempt@${domain}`,
          password: `DupPass!${id}A1`,
        },
      });
      expect(r.status()).toBe(429);
      expect((await r.json()).message).toMatch(/too many accounts/i);
    } finally {
      await ctx.dispose();
    }
  });
});
