/**
 * Task #298 — End-to-end coverage for the AdminSetupGate bypass on
 * /marketing/* (Tasks #245 / #261).
 *
 * AdminSetupGate (client/src/components/admin-setup-gate.tsx) blocks
 * admins on every route until the firm profile is filled in, with one
 * exception: when the active org has at least one brand OR the
 * `marketing_os` entitlement is active, /marketing/* is allowed
 * through. Today this branch only has component-level coverage in
 * tests/unit/admin-setup-gate.test.tsx — every sibling marketing-OS
 * spec implicitly relies on the bypass to reach /marketing/* without
 * a complete firm profile, but none of them assert the bypass
 * actually fired in a real browser. A regression that re-enabled the
 * firm-profile check for /marketing/* would only surface as a flake
 * in unrelated specs.
 *
 * To isolate the bypass from any seeded firm profile or background
 * brand pollution we provision three brand-new admin orgs (each with
 * empty firm-profile fields, so `firmProfileComplete` resolves false)
 * and bake one configuration into each so we can prove every branch
 * of `marketingOsActive || hasBrands` independently without mutating
 * the server-side `listBrandsByOrg` cache mid-run:
 *
 *   • Org B  — brand row, no entitlement       → gate bypassed,
 *                                                 MarketingOsLockedCard
 *                                                 renders.
 *   • Org E  — no brands, entitlement active   → gate bypassed,
 *                                                 CampaignsPage editor
 *                                                 renders.
 *   • Org N  — no brands, no entitlement       → gate fires,
 *                                                 firm-profile banner
 *                                                 visible.
 *
 * All three orgs and their dependent rows are torn down in afterAll.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { pool } from "../server/db";
import { hashPassword } from "../server/auth";

const BASE = `http://localhost:${process.env.PORT || 5000}`;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Reuse the `marketing-editors-e2e-` slug prefix so the orphan brand
// CLI sweep at scripts/cleanup-e2e-brand-pollution.ts catches anything
// we accidentally leak.
const BRAND_SLUG_PREFIX = "marketing-editors-e2e-gate";

type Fixture = {
  label: string;
  orgSlug: string;
  orgName: string;
  email: string;
  withBrand: boolean;
  withEntitlement: boolean;
  orgId?: string;
  userId?: string;
  brandId?: string;
};

const ADMIN_PASS = "GateBypass2026!";

const fixtures: Record<"brand" | "entitlement" | "none", Fixture> = {
  brand: {
    label: "brand",
    orgSlug: `marketing-editors-e2e-gate-brand-${RUN}`,
    orgName: `MGB Brand-Only Org ${RUN}`,
    email: `admin-mgb-brand-${RUN}@cwpro.test`,
    withBrand: true,
    withEntitlement: false,
  },
  entitlement: {
    label: "entitlement",
    orgSlug: `marketing-editors-e2e-gate-ent-${RUN}`,
    orgName: `MGB Entitlement-Only Org ${RUN}`,
    email: `admin-mgb-ent-${RUN}@cwpro.test`,
    withBrand: false,
    withEntitlement: true,
  },
  none: {
    label: "none",
    orgSlug: `marketing-editors-e2e-gate-none-${RUN}`,
    orgName: `MGB No-Bypass Org ${RUN}`,
    email: `admin-mgb-none-${RUN}@cwpro.test`,
    withBrand: false,
    withEntitlement: false,
  },
};

async function loginAs(request: APIRequestContext, fx: Fixture) {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: fx.email, password: ADMIN_PASS },
  });
  expect(r.status()).toBe(200);
  const body = await r.json();
  // Each seeded admin only belongs to one org — guard in case the
  // login surface ever insists on an explicit slug anyway.
  if (body?.needsOrgPick && Array.isArray(body.orgs) && body.orgs.length > 0) {
    const second = await request.post(`${BASE}/api/auth/login`, {
      data: { email: fx.email, password: ADMIN_PASS, orgSlug: fx.orgSlug },
    });
    expect(second.status()).toBe(200);
  }
}

async function navigateToCampaigns(page: Page) {
  // Wait for the entitlement query under the new tab — the conditional
  // /marketing/* routes only register once useEntitlement("marketing_os")
  // has resolved, so navigating before that lands on the wouter fallback.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/me/entitlements") && r.status() === 200,
      { timeout: 20_000 },
    ),
    page.goto("/marketing/campaigns"),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
}

async function provisionFixture(fx: Fixture) {
  // Insert the bare org with no firm-profile fields so the
  // implementation-status route returns firmProfileComplete:false
  // (server/routes/settings-routes.ts derives "firm" from
  // org.addressStreet || org.addressCity || org.email || org.phone).
  const orgRow = await pool.query<{ id: string }>(
    `INSERT INTO orgs (name, slug, plan_tier, subscription_status, max_team_members, onboarding_complete)
       VALUES ($1, $2, 'ENTERPRISE', 'active', 999, true)
       RETURNING id`,
    [fx.orgName, fx.orgSlug],
  );
  fx.orgId = orgRow.rows[0].id;

  const hashed = await hashPassword(ADMIN_PASS);
  const userRow = await pool.query<{ id: string }>(
    `INSERT INTO users (org_id, email, password, name, first_name, last_name, role, is_active, onboarding_complete, temp_password)
       VALUES ($1, $2, $3, 'MGB Admin', 'MGB', 'Admin', 'ADMIN', true, true, false)
       RETURNING id`,
    [fx.orgId, fx.email, hashed],
  );
  fx.userId = userRow.rows[0].id;

  if (fx.withBrand) {
    const brandRow = await pool.query<{ id: string }>(
      `INSERT INTO brands (org_id, name, slug)
         VALUES ($1, $2, $3)
         RETURNING id`,
      [fx.orgId, `${fx.orgName} Brand`, `${BRAND_SLUG_PREFIX}-${fx.label}-${RUN}`],
    );
    fx.brandId = brandRow.rows[0].id;
  }

  if (fx.withEntitlement) {
    await pool.query(
      `INSERT INTO org_entitlements (org_id, feature, active, activated_at)
         VALUES ($1, 'marketing_os', true, now())
       ON CONFLICT (org_id, feature) DO UPDATE
         SET active = true, activated_at = now()`,
      [fx.orgId],
    );
  }
}

async function teardownFixture(fx: Fixture) {
  if (!fx.orgId) return;
  // Drop everything that FKs into users/orgs first. The marketing-OS
  // telemetry rows fire on /marketing/* page loads, so we always have
  // at least one to clean up; active_sessions is a similar bookkeeping
  // table populated by login. The brand row (the only table the
  // cleanup-e2e-brand-pollution sweep targets) is dropped explicitly
  // so we don't pollute the brands list.
  await pool.query(`DELETE FROM marketing_os_telemetry_events WHERE org_id = $1`, [fx.orgId]);
  await pool.query(`DELETE FROM active_sessions WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`, [fx.orgId]);
  await pool.query(`DELETE FROM brands WHERE org_id = $1`, [fx.orgId]);
  await pool.query(`DELETE FROM org_entitlements WHERE org_id = $1`, [fx.orgId]);

  // audit_logs is normally append-only — the
  // `prevent_audit_log_modification` trigger blocks DELETE/UPDATE for
  // app traffic and would otherwise FK-block the users/orgs deletes
  // below. Migration 0017 added a sanctioned bypass: a transaction-
  // local GUC (`app.allow_audit_log_modification = 'on'`) that lets
  // the trigger skip its guard for the duration of one transaction.
  // We grab a single dedicated connection so the GUC, the audit_logs
  // delete, and the org/user deletes all share the same session and
  // commit/rollback atomically — and so the bypass cannot leak onto
  // another pooled connection.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.allow_audit_log_modification', 'on', true)");
    await client.query(`DELETE FROM audit_logs WHERE org_id = $1`, [fx.orgId]);
    await client.query(`DELETE FROM users WHERE org_id = $1`, [fx.orgId]);
    await client.query(`DELETE FROM orgs WHERE id = $1`, [fx.orgId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

test.describe("AdminSetupGate — /marketing/* firm-profile bypass (Task #298)", () => {
  test.beforeAll(async () => {
    for (const fx of Object.values(fixtures)) {
      await provisionFixture(fx);
    }
  });

  test.afterAll(async () => {
    for (const fx of Object.values(fixtures)) {
      try {
        await teardownFixture(fx);
      } catch (err) {
        console.error(`[marketing-os-gate-bypass afterAll] cleanup failed for ${fx.label}:`, err);
      }
    }
  });

  test("blocks /marketing/* with the firm-profile gate when the org has no brands and no marketing_os entitlement", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page.context().request, fixtures.none);
    await navigateToCampaigns(page);

    // The gate's banner is the unambiguous signal that the firm-profile
    // setup view took over the route.
    await expect(page.locator('[data-testid="banner-firm-profile-incomplete"]')).toBeVisible({ timeout: 15_000 });
    // And the campaigns editor + locked card must NOT have rendered.
    await expect(page.locator('[data-testid="text-page-title"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="card-marketing-os-locked"]')).toHaveCount(0);
  });

  test("bypasses the firm-profile gate on /marketing/* when the org has at least one brand (entitlement off → locked card renders)", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page.context().request, fixtures.brand);
    await navigateToCampaigns(page);

    // Bypass evidence #1: no firm-profile banner. Bypass evidence #2:
    // /marketing/* actually rendered (the locked card route only fires
    // when AdminSetupGate lets the Router run on this URL).
    await expect(page.locator('[data-testid="banner-firm-profile-incomplete"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="card-marketing-os-locked"]')).toBeVisible({ timeout: 15_000 });
  });

  test("bypasses the firm-profile gate on /marketing/* when the marketing_os entitlement is active even with no brands (editor renders)", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page.context().request, fixtures.entitlement);
    await navigateToCampaigns(page);

    // No firm-profile banner; the real CampaignsPage rendered. With
    // zero brands the editor's `empty-state-no-brands` fork is the
    // first piece of CampaignsPage that paints (page-title sits behind
    // the brand-required guard further down the component). Asserting
    // it proves the entitlement-only branch of `marketingOsActive ||
    // hasBrands` cleared the gate without piggy-backing on the brand
    // branch we already covered above.
    await expect(page.locator('[data-testid="banner-firm-profile-incomplete"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="empty-state-no-brands"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="card-marketing-os-locked"]')).toHaveCount(0);
  });
});
