/**
 * Smoke spec for the Task #435 shared E2E fixture library.
 *
 * Exercises each helper at least once and asserts the right surface:
 *   - per-role pre-auth pages (manager + team member) reach /api/auth/me
 *   - tier downgrade triggers <UpgradeWall> on /approvals
 *   - setEntitlement upserts a row visible via /api/me/entitlements
 *   - completeFirmProfile / clearFirmProfile flips the
 *     `firmProfileComplete` field on /api/implementation-status
 *   - each third-party stub variant fires at least once
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setOrgTier, setEntitlement } from "../tests/helpers/po/tier";
import { completeFirmProfile, clearFirmProfile, FIRM_PROFILE_EMAIL } from "../tests/helpers/po/setup-gate";
import {
  stripeStub,
  graphStub,
  gmailStub,
  groqStub,
  tesseractStub,
  frankfurterStub,
  clearbitStub,
  plaidStub,
  resendStub,
  type StripeWebhookOptions,
} from "../tests/helpers/po/stubs";

test.describe.configure({ mode: "parallel" });

test.describe("Shared fixture library (Task #435)", () => {
  test("seedManagerPage is authenticated as MANAGER", async ({ seedManagerPage }) => {
    const r = await seedManagerPage.request.get("/api/auth/me");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.role).toBe("MANAGER");
    expect(body).not.toHaveProperty("password");
  });

  test("seedTeamMemberPage is authenticated as TEAM_MEMBER", async ({ seedTeamMemberPage }) => {
    const r = await seedTeamMemberPage.request.get("/api/auth/me");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.role).toBe("TEAM_MEMBER");
  });

  test("seedRoleAdminPage is authenticated as a non-shared ADMIN", async ({ seedRoleAdminPage }) => {
    const r = await seedRoleAdminPage.request.get("/api/auth/me");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.role).toBe("ADMIN");
    // Critical constraint: must NOT be the seeded dean@cherrystconsulting.com admin.
    expect(body.email).not.toBe("dean@cherrystconsulting.com");
  });

  test("setOrgTier downgrade engages the Approvals UpgradeWall", async ({
    isolatedOrg,
    browser,
  }) => {
    // Default isolatedOrg is BUSINESS — the page renders its content.
    // After downgrading to STARTER (< requiredTier=PROFESSIONAL) the
    // page must render the upgrade wall instead.
    const ok = await setOrgTier(isolatedOrg.orgId, "STARTER");
    expect(ok).toBe(true);

    // Login a fresh browser context as the isolated admin.
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto("/login");
      await page.fill('[data-testid="input-email"]', isolatedOrg.email);
      await page.fill('[data-testid="input-password"]', isolatedOrg.password);
      await page.click('[data-testid="button-login"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });

      await page.goto("/approvals");
      await expect(page.locator('[data-testid="upgrade-wall-approvals"]')).toBeVisible({ timeout: 15000 });

      // Restore so any pooled webhook reconciliation doesn't fight us.
      await setOrgTier(isolatedOrg.orgId, "BUSINESS");
    } finally {
      await ctx.close();
    }
  });

  test("setEntitlement upserts a persisted row", async ({ isolatedOrg }) => {
    // multi_brand is NOT tier-derived, so the read-path overlay can't
    // mask a manual flip — perfect probe for setEntitlement.
    await setEntitlement(isolatedOrg.orgId, "multi_brand", true);
    const on = await isolatedOrg.request.get("/api/me/entitlements");
    expect(on.status()).toBe(200);
    const onBody = await on.json();
    expect(onBody.multi_brand).toBe(true);

    await setEntitlement(isolatedOrg.orgId, "multi_brand", false);
    const off = await isolatedOrg.request.get("/api/me/entitlements");
    const offBody = await off.json();
    expect(offBody.multi_brand).toBe(false);
  });

  test("completeFirmProfile + clearFirmProfile flip the gate signal", async ({
    isolatedOrg,
  }) => {
    // Default fixture pre-completes the firm profile.
    const before = await isolatedOrg.request.get("/api/implementation-status");
    expect(before.status()).toBe(200);
    expect((await before.json()).firmProfileComplete).toBe(true);

    await clearFirmProfile(isolatedOrg.orgId);
    const cleared = await isolatedOrg.request.get("/api/implementation-status");
    expect((await cleared.json()).firmProfileComplete).toBe(false);

    await completeFirmProfile(isolatedOrg.orgId);
    const re = await isolatedOrg.request.get("/api/implementation-status");
    const reBody = await re.json();
    expect(reBody.firmProfileComplete).toBe(true);
    // Sanity — completeFirmProfile sets the documented default email.
    expect(typeof FIRM_PROFILE_EMAIL).toBe("string");
  });

  test("third-party stubs install per-page route handlers without throwing", async ({
    browser,
  }) => {
    // We don't navigate to a real third-party page (network). The
    // assertion is that every stub variant registers cleanly and a
    // browser-context `fetch()` (which `page.route` definitely
    // intercepts — unlike `page.request.get`, which bypasses handlers
    // for cross-origin requests) returns the stubbed body. We still
    // need a navigated page so `fetch()` has a window context — about:blank
    // works fine.
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto("about:blank");

      await stripeStub.success(page);
      await graphStub.success(page);
      await gmailStub.success(page);
      await groqStub.success(page);
      await frankfurterStub.success(page);
      await clearbitStub.success(page);
      await plaidStub.success(page);

      const frankfurter = await page.evaluate(async () => {
        const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
        return { status: r.status, body: await r.json() };
      });
      expect(frankfurter.status).toBe(200);
      expect(frankfurter.body.rates).toHaveProperty("EUR");

      const clearbit = await page.evaluate(async () => {
        const r = await fetch("https://logo.clearbit.com/example.com");
        return { status: r.status };
      });
      expect(clearbit.status).toBe(200);

      const groq = await page.evaluate(async () => {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
        });
        return { status: r.status };
      });
      expect(groq.status).toBe(200);

      // Failure variant — re-register on a fresh page to override.
      const page2 = await ctx.newPage();
      await page2.goto("about:blank");
      await frankfurterStub.failure(page2, 503);
      const failed = await page2.evaluate(async () => {
        const r = await fetch("https://api.frankfurter.app/latest");
        return { status: r.status };
      });
      expect(failed.status).toBe(503);
      await page2.close();
    } finally {
      await ctx.close();
    }
  });

  test("resendStub.build produces a well-formed inbound bounce payload", () => {
    const payload = resendStub.build({ type: "email.bounced", to: "x@y.test" }) as {
      type: string;
      data: { to: string[]; bounce: { type: string } };
    };
    expect(payload.type).toBe("email.bounced");
    expect(payload.data.to).toEqual(["x@y.test"]);
    expect(payload.data.bounce.type).toBe("permanent");
  });

  test("stripeStub.buildEvent produces a well-formed checkout.session.completed event", () => {
    const opts: StripeWebhookOptions = { type: "checkout.session.completed" };
    const ev = stripeStub.buildEvent(opts) as {
      object: string;
      type: string;
      data: { object: { id: string } };
    };
    expect(ev.object).toBe("event");
    expect(ev.type).toBe("checkout.session.completed");
    expect(ev.data.object.id).toBe("cs_test_e2e");
  });

  test("tesseract + groq timeout stubs install without throwing", async ({ browser }) => {
    // Tesseract is in-process — its stub is documented as a no-op
    // marker (see stubs.ts). We exercise it here so the lint and
    // smoke coverage both prove it's wired up.
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto("about:blank");
      await tesseractStub.success(page);
      await tesseractStub.failure(page);
      await tesseractStub.timeout(page);

      // Groq timeout — verify the route handler is registered. We
      // don't actually wait HANG_MS; instead we register the timeout
      // route on a fresh page and immediately race a fetch with a
      // 1500ms abort signal — the abort wins, proving the request
      // was hung by the stub rather than fast-failed by network.
      await groqStub.timeout(page);
      const result = await page.evaluate(async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        try {
          await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            signal: ctrl.signal,
          });
          return "completed";
        } catch (e: unknown) {
          return (e as Error).name;
        } finally {
          clearTimeout(timer);
        }
      });
      expect(result).toBe("AbortError");
    } finally {
      await ctx.close();
    }
  });
});

test.describe("firmProfileComplete option fixture (Task #435)", () => {
  test.describe("default (true)", () => {
    test("isolatedOrg pre-completes the firm profile", async ({ isolatedOrg }) => {
      const r = await isolatedOrg.request.get("/api/implementation-status");
      expect((await r.json()).firmProfileComplete).toBe(true);
    });
  });

  test.describe("opt-out via test.use", () => {
    test.use({ firmProfileComplete: false });
    test("isolatedOrg leaves the firm profile incomplete", async ({ isolatedOrg }) => {
      const r = await isolatedOrg.request.get("/api/implementation-status");
      expect((await r.json()).firmProfileComplete).toBe(false);
    });
  });
});
