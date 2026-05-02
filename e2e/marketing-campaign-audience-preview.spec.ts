/**
 * Task #295 — End-to-end coverage for the campaign recipient-count preview.
 *
 * Task #264 wired a live "≈ N recipients" preview into the campaign editor
 * backed by GET /api/marketing/campaigns/audience-preview, but no e2e test
 * pinned the behavior. A future refactor of the audience radio, segment
 * dropdown, or count endpoint could silently regress what an admin sees in
 * the editor — this spec walks the picker from a real admin's POV in a
 * browser and asserts the preview text mirrors the real recipient counts.
 *
 * Setup:
 *   - Provision a brand with 3 contacts. 2 of them have "Alpha" in their
 *     last name; the 3rd is "Beta".
 *   - Provision a saved segment whose filter searches for "Alpha", so the
 *     segment resolves to exactly 2 recipients while "all" resolves to 3.
 *
 * Assertions:
 *   - Default audience is "all" → preview shows "≈ 3 recipients".
 *   - Switch to "segment", pick the segment → preview shows "≈ 2 recipients".
 *   - Switch back to "all" → preview returns to "≈ 3 recipients".
 *
 * Cleanup is a hard-delete cascade via cleanupE2EBrandPollution which
 * sweeps marketing_contacts + marketing_segments + marketing_campaigns
 * before dropping the brand.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";
import { pool } from "../server/db";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
// Use the seeded QA admin (server/seed-role-test-users.ts) so this spec is
// self-contained on a fresh dev DB — same approach as the sibling
// audience-picker spec (Task #265).
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
const BRAND_NAME = `Audience Preview E2E ${RUN}`;
const BRAND_SLUG = `audience-preview-e2e-${RUN}`;
const SEGMENT_NAME = `T295 Alpha Segment ${RUN}`;
// The search predicate the segment uses to subset the brand's contacts.
// Two of the three seeded contacts have this substring in their last name.
const ALPHA_TOKEN = `Alpha${RUN}`;
const BETA_TOKEN = `Beta${RUN}`;

test.describe("Marketing OS — campaign recipient-count preview (Task #295)", () => {
  const createdBrandIds: string[] = [];

  test.beforeAll(async () => {
    // AdminSetupGate bypasses the firm-profile gate on /marketing/* whenever
    // the org has the marketing_os entitlement active. Force it ON so the
    // route gate doesn't 404 the editor.
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
      console.error("[marketing-campaign-audience-preview afterAll] cleanup failed:", err);
    }
  });

  test("preview text mirrors real recipient counts as the audience selection changes", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Reuse the page's BrowserContext request so cookies are shared with
    // the browser session — sibling specs do this same dance.
    const request = page.context().request;

    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    // ── Provision a brand with a known number of contacts.
    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = await brandRes.json();
    createdBrandIds.push(brand.id);

    // 3 contacts total — 2 with "Alpha" in the last name, 1 with "Beta".
    // The segment below searches for the Alpha token, so its resolved
    // count must be 2 while the brand's "all" count is 3.
    const contactPayloads = [
      { firstName: "Ada",   lastName: ALPHA_TOKEN, email: `ada-${RUN}@example.test` },
      { firstName: "Alan",  lastName: ALPHA_TOKEN, email: `alan-${RUN}@example.test` },
      { firstName: "Brian", lastName: BETA_TOKEN,  email: `brian-${RUN}@example.test` },
    ];
    for (const c of contactPayloads) {
      const r = await request.post(`${BASE}/api/marketing/contacts`, {
        data: { brandId: brand.id, ...c },
        headers,
      });
      expect(r.status(), `contact create failed: ${await r.text()}`).toBe(201);
    }

    // Provision a saved segment that resolves to the 2 Alpha contacts.
    const segmentRes = await request.post(`${BASE}/api/marketing/segments`, {
      data: {
        brandId: brand.id,
        name: SEGMENT_NAME,
        filter: { tagIds: [], search: ALPHA_TOKEN },
      },
      headers,
    });
    expect(segmentRes.status()).toBe(201);
    const segment = await segmentRes.json();

    // Sanity-check the API counts before relying on the UI to mirror them.
    const allPreview = await request.get(
      `${BASE}/api/marketing/campaigns/audience-preview?brandId=${brand.id}&audienceType=all`,
    );
    expect(allPreview.status()).toBe(200);
    expect((await allPreview.json()).count).toBe(3);

    const segPreview = await request.get(
      `${BASE}/api/marketing/campaigns/audience-preview?brandId=${brand.id}&audienceType=segment&segmentId=${segment.id}`,
    );
    expect(segPreview.status()).toBe(200);
    expect((await segPreview.json()).count).toBe(2);

    // ── Pin the active brand before navigating.
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

    // Open the create form. Default audience is "all", so the preview
    // should immediately resolve to the brand's full contact count.
    await page.click('[data-testid="button-new-campaign"]');
    await expect(page.locator('[data-testid="form-create-campaign"]')).toBeVisible();

    const previewLine = page.locator('[data-testid="text-audience-preview"]');
    await expect(previewLine).toHaveText("≈ 3 recipients", { timeout: 10_000 });

    // Switch to "A saved segment", pick our segment from the dropdown.
    // Until a segment is picked the preview should prompt the admin to
    // make a choice rather than showing a stale "all" count.
    await page.click('[data-testid="radio-audience-segment"]');
    await expect(previewLine).toHaveText(
      "Pick a segment to see the recipient count.",
      { timeout: 5_000 },
    );

    await page.click('[data-testid="select-audience-segment"]');
    await page.click(`[data-testid="option-segment-${segment.id}"]`);

    // Once the segment is picked the preview should mirror its 2-recipient
    // resolved count. Use a forgiving timeout to absorb the refetch.
    await expect(previewLine).toHaveText("≈ 2 recipients", { timeout: 10_000 });

    // Flip back to "All brand contacts" — the preview must return to 3.
    await page.click('[data-testid="radio-audience-all"]');
    await expect(previewLine).toHaveText("≈ 3 recipients", { timeout: 10_000 });

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
