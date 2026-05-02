/**
 * Task #265 — End-to-end coverage for the campaign audience picker.
 *
 * Task #234 added the "All brand contacts" / "A saved segment" picker to
 * the campaign editor and an Audience column on the list view, but only
 * the recipient resolver had unit coverage. This spec walks the picker
 * from a real admin's POV in a browser:
 *
 *   1. Create a saved segment for the active brand.
 *   2. Open the campaign editor, switch the audience radio to "A saved
 *      segment", choose the segment from the dropdown, and save.
 *   3. Confirm the campaigns list view's Audience column shows the
 *      segment's name on the new row.
 *   4. Re-open the campaign in edit mode and toggle audience back to
 *      "All brand contacts" to confirm the picker round-trips a stored
 *      segment back to "all" without errors.
 *
 * Cleanup is a hard-delete cascade via cleanupE2EBrandPollution which
 * sweeps marketing_campaigns + marketing_segments before dropping the
 * brand.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";
import { pool } from "../server/db";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
// Use the seeded QA admin (server/seed-role-test-users.ts) so this spec is
// self-contained on a fresh dev DB. The Cherry Street user the sibling
// editor spec uses isn't always present in CI snapshots.
const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";
const ADMIN_ORG_SLUG = "cwpro-dev-qa";

async function login(request: APIRequestContext) {
  const first = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(first.status()).toBe(200);
  const body = await first.json();
  if (body?.needsOrgPick && Array.isArray(body.orgs) && body.orgs.length > 0) {
    const preferred = body.orgs.find((o: { slug: string }) => o.slug === ADMIN_ORG_SLUG)
      ?? body.orgs[0];
    const second = await request.post(`${BASE}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASS, orgSlug: preferred.slug },
    });
    expect(second.status()).toBe(200);
  }
}

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BRAND_NAME = `Marketing Editors E2E ${RUN}`;
const BRAND_SLUG = `marketing-editors-e2e-${RUN}`;
const SEGMENT_NAME = `T265 Audience Segment ${RUN}`;
const CAMPAIGN_NAME = `T265 Audience Campaign ${RUN}`;
const CAMPAIGN_SUBJECT = `Hello audience ${RUN}`;

test.describe("Marketing OS — campaign audience picker (Task #265)", () => {
  const createdBrandIds: string[] = [];

  test.beforeAll(async () => {
    // AdminSetupGate (client/src/components/admin-setup-gate.tsx) bypasses
    // the firm-profile gate on /marketing/* whenever the org has the
    // marketing_os entitlement active or at least one brand. Force the
    // entitlement ON for the QA org so the route gate also stops
    // returning stealth-404s; no firm-profile seeding required (Tasks
    // #245 / #261).
    await pool.query(
      `INSERT INTO org_entitlements (org_id, feature, active, activated_at)
         SELECT id, 'marketing_os', true, now() FROM orgs WHERE slug = $1
       ON CONFLICT (org_id, feature) DO UPDATE SET active = true`,
      [ADMIN_ORG_SLUG],
    );
  });

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-campaign-audience-picker afterAll] cleanup failed:", err);
    }
  });

  test("picks a saved segment, persists it, and surfaces it on the list view", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Reuse the page's BrowserContext request so cookies are shared with
    // the browser session — sibling specs do this same dance.
    const request = page.context().request;

    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // Provision a brand for this run.
    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = await brandRes.json();
    createdBrandIds.push(brand.id);

    // Provision a saved segment under the same brand. The segment
    // resolver doesn't matter here — we only need a row whose name and
    // id show up in the picker dropdown and Audience column.
    const segmentRes = await request.post(`${BASE}/api/marketing/segments`, {
      data: {
        brandId: brand.id,
        name: SEGMENT_NAME,
        filter: { tagIds: [], search: "" },
      },
      headers,
    });
    expect(segmentRes.status()).toBe(201);
    const segment = await segmentRes.json();

    // Pin the active brand before navigating.
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console.error: ${m.text()}`);
    });

    await page.addInitScript((brandId) => {
      try {
        localStorage.setItem("cwp_active_brand_id", brandId);
      } catch {
        /* swallow */
      }
    }, brand.id);

    // Hydrate auth + entitlements before navigating to the editor.
    await page.goto("/");
    await page.waitForResponse(
      (r) => r.url().includes("/api/auth/me") && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.waitForResponse(
      (r) => r.url().includes("/api/me/entitlements") && r.status() === 200,
      { timeout: 15_000 },
    );

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/me/entitlements") && r.status() === 200,
        { timeout: 20_000 },
      ),
      page.goto("/marketing/campaigns"),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await expect(page.locator('[data-testid="text-page-title"]'))
      .toBeVisible({ timeout: 20_000 });

    // ── Open the create form and pick the saved segment.
    await page.click('[data-testid="button-new-campaign"]');
    await expect(page.locator('[data-testid="form-create-campaign"]')).toBeVisible();

    await page.fill('[data-testid="input-campaign-name"]', CAMPAIGN_NAME);
    await page.fill('[data-testid="input-campaign-subject"]', CAMPAIGN_SUBJECT);

    // Default audience is "all"; switch to segment and pick from the dropdown.
    await page.click('[data-testid="radio-audience-segment"]');
    await page.click('[data-testid="select-audience-segment"]');
    await page.click(`[data-testid="option-segment-${segment.id}"]`);

    // Save and wait for the editor to close.
    await page.click('[data-testid="button-save-campaign"]');
    await expect(page.locator('[data-testid="form-create-campaign"]'))
      .toBeHidden({ timeout: 10_000 });

    // Resolve the new campaign row.
    const campaignRow = page.locator(
      `[data-testid^="row-campaign-"]`,
      { hasText: CAMPAIGN_NAME },
    );
    await expect(campaignRow).toBeVisible();
    const rowId = await campaignRow.getAttribute("data-testid");
    expect(rowId).toMatch(/^row-campaign-/);
    const campaignId = rowId!.replace(/^row-campaign-/, "");

    // ── List view's Audience column shows the segment's name.
    await expect(
      page.locator(`[data-testid="text-campaign-audience-${campaignId}"]`),
    ).toHaveText(SEGMENT_NAME);

    // ── Cross-check against the API to make sure the segment id
    // actually persisted (defensive: the column could otherwise be
    // populated from in-memory form state on first render).
    const fetched = await request.get(
      `${BASE}/api/marketing/campaigns/${campaignId}`,
    );
    expect(fetched.status()).toBe(200);
    const fetchedJson = await fetched.json();
    expect(fetchedJson.audienceType).toBe("segment");
    expect(fetchedJson.audienceSegmentId).toBe(segment.id);

    // ── Re-open the editor: the saved segment is preselected; switch
    // back to "All brand contacts" and confirm the column flips too.
    await page.click(`[data-testid="button-edit-campaign-${campaignId}"]`);
    await expect(page.locator('[data-testid="form-edit-campaign"]')).toBeVisible();
    await expect(page.locator('[data-testid="radio-audience-segment"]'))
      .toBeChecked();

    await page.click('[data-testid="radio-audience-all"]');
    await page.click('[data-testid="button-save-campaign"]');
    await expect(page.locator('[data-testid="form-edit-campaign"]'))
      .toBeHidden({ timeout: 10_000 });

    await expect(
      page.locator(`[data-testid="text-campaign-audience-${campaignId}"]`),
    ).toHaveText("All brand contacts");

    const refetched = await request.get(
      `${BASE}/api/marketing/campaigns/${campaignId}`,
    );
    expect(refetched.status()).toBe(200);
    const refetchedJson = await refetched.json();
    expect(refetchedJson.audienceType).toBe("all");
    expect(refetchedJson.audienceSegmentId).toBeNull();

    // Console-error budget: same allow-list as sibling marketing-OS specs.
    const realErrors = consoleErrors.filter(
      (e) =>
        !/Failed to load resource.*401/i.test(e) &&
        !/autocomplete attributes/i.test(e) &&
        !/DevTools/i.test(e),
    );
    expect(realErrors, `Unexpected console errors: ${realErrors.join(" | ")}`).toEqual([]);
  });
});
