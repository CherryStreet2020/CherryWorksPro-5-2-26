/**
 * Signup (Task #436): per-field validation, password-strength banner,
 * duplicate email, duplicate domain, happy path with TRIAL/14d
 * DB assertion, post-signup redirect to dashboard.
 */
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
  // The signup endpoint deliberately allows the same email across
  // different orgs (multi-tenant by design — see audit §6.2.15).
  // Cross-org dedup happens via the duplicate-firm-slug uniqueness
  // constraint on `orgs.slug` and the per-domain rate limiter.
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
    // The signup endpoint dedupes the slug by appending `-N` until
    // free (auth-routes.ts ~327-331). Same firmName therefore
    // succeeds with a different slug rather than 409ing.
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

test.describe("/signup multi-tenant duplicate-email contract", () => {
  // Intentional production semantics: signup auto-suffixes the org
  // slug (auth-routes.ts ~334), then the dup-email guard checks
  // `getUserByOrgSlugAndEmail(NEW_slug, email)`, which is by
  // definition empty for a fresh slug. So the same (firmName, email)
  // pair signing up twice is *not* rejected — it creates a second
  // org with a `-1`-suffixed slug and a new user row scoped to it.
  //
  // What this test pins down deterministically:
  //   1. Both signups return 200.
  //   2. Two distinct user rows exist for the same email, each in
  //      its own org.
  //   3. The first user's `org_id` is never re-pointed to the second
  //      org (no silent merge).
  //   4. The second org's slug is the `-1`-suffixed variant of the
  //      first (proving the auto-suffix path actually fired).
  test("same email + same firmName creates two isolated orgs and never re-points the first user", async () => {
    const id = randomBytes(4).toString("hex");
    const firmName = `${ISO_SLUG_PREFIX}${getRunId()}_dup_${id}`;
    const email = `dup-${id}@e2e-dup-${id}.test`;
    const password = `DupPass!${id}A1`;
    const createdOrgIds: string[] = [];
    const ctx = await freshApiContext();
    try {
      const first = await ctx.post(`${BASE}/api/auth/signup`, {
        data: { firmName, firstName: "Dup", lastName: "Test", email, password },
      });
      if (first.status() === 503) test.skip(true, "STRIPE_SECRET_KEY missing");
      expect(first.status()).toBe(200);
      const firstBody = await first.json();
      createdOrgIds.push(firstBody.org.id);
      const firstSlug: string = firstBody.org.slug;

      const second = await ctx.post(`${BASE}/api/auth/signup`, {
        data: { firmName, firstName: "Dup2", lastName: "Test", email, password },
      });
      expect(second.status()).toBe(200);
      const secondBody = await second.json();
      createdOrgIds.push(secondBody.org.id);

      // Auto-suffix proof: second slug = first slug + "-N" (N>=1).
      expect(secondBody.org.slug).toMatch(
        new RegExp(`^${firstSlug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}-\\d+$`),
      );
      expect(secondBody.org.id).not.toBe(firstBody.org.id);

      // No silent merge: each org owns its own user row for this email,
      // and the first user's org_id is unchanged.
      const { rows } = await pool.query(
        `SELECT id, org_id FROM users WHERE email = $1 ORDER BY created_at ASC`,
        [email],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].org_id).toBe(firstBody.org.id);
      expect(rows[1].org_id).toBe(secondBody.org.id);
      expect(rows[0].id).not.toBe(rows[1].id);
    } finally {
      for (const oid of createdOrgIds) {
        await deleteIsolatedOrg(oid).catch(() => undefined);
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
