/**
 * Sprint 2n — Marketing OS Campaign + Sequence editor end-to-end coverage.
 *
 * Validates the two new editor pages from a real admin's POV in a browser:
 *
 *  Campaigns (/marketing/campaigns)
 *    - Create draft via UI: form fields drive the live EmailPreview as the
 *      planner types (subject, body, from-name, from-email, reply-to all
 *      mirror into the inbox-preview card)
 *    - Save → row appears in the table
 *    - Edit → preview re-mirrors edited copy → save persists
 *    - Delete via confirmation dialog → row removed
 *
 *  Sequences (/marketing/sequences)
 *    - Create draft with multiple steps; first-step body drives preview
 *    - Add a second step; switching the active step swaps the preview body
 *      and the "signature title" line ("Sends on enrollment" vs
 *      "Waits N days after previous step")
 *    - Adjust per-step delay → step card label and preview signature update
 *    - Reorder steps (move-up button) → order persists in the cards
 *    - Save → sequence shows up in the table
 *
 * Cleanup is a hard-delete cascade via cleanupE2EBrandPollution which (as
 * of Sprint 2n) sweeps marketing_campaigns + marketing_sequences before
 * dropping the brand.
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_EMAIL = "dean@cherrystconsulting.com";
const ADMIN_PASS = "CherryWorks2026!";

async function login(request: APIRequestContext) {
  // First call discovers if the user is a multi-org match. In that case
  // the API responds 200 with `{ needsOrgPick: true, orgs: [...] }` and
  // we have to retry with an explicit orgSlug — otherwise no session is
  // established and every follow-up request comes back 401.
  const first = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(first.status()).toBe(200);
  const body = await first.json();
  if (body?.needsOrgPick && Array.isArray(body.orgs) && body.orgs.length > 0) {
    // Prefer the canonical Cherry Street Consulting org if it's in the list,
    // otherwise pick the first match deterministically.
    const preferred = body.orgs.find((o: { slug: string }) => o.slug === "cherry-street-consulting")
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

const CAMPAIGN_NAME = `Launch Email ${RUN}`;
const CAMPAIGN_SUBJECT = `Hello world ${RUN}`;
const CAMPAIGN_BODY = `Welcome to the ${RUN} launch — we're excited to have you on board.`;
const CAMPAIGN_FROM_NAME = `Mira ${RUN}`;
const CAMPAIGN_FROM_EMAIL = `mira-${RUN}@example.test`;
const CAMPAIGN_REPLY_TO = `support-${RUN}@example.test`;

const CAMPAIGN_NEW_SUBJECT = `Updated subject ${RUN}`;
const CAMPAIGN_NEW_BODY = `Updated body ${RUN} for the edit pass.`;

const SEQUENCE_NAME = `Onboarding ${RUN}`;
const SEQUENCE_DESC = `Two-step nurture ${RUN}`;
const STEP1_SUBJECT = `Welcome ${RUN}`;
const STEP1_BODY = `Hi there — first touch on day zero ${RUN}.`;
const STEP2_SUBJECT = `Following up ${RUN}`;
const STEP2_BODY = `Just checking in five days later ${RUN}.`;

test.describe("Marketing OS — campaign + sequence editor end-to-end", () => {
  const createdBrandIds: string[] = [];

  // No firm-profile seeding needed: each test provisions a brand below,
  // and AdminSetupGate (see client/src/components/admin-setup-gate.tsx)
  // bypasses the gate on /marketing/* whenever the active org has at
  // least one brand or the marketing_os entitlement is active. Stamping
  // a placeholder firm address purely to satisfy the gate (Tasks #245 /
  // #261) is dead weight.

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error("[marketing-campaign-sequence-editors afterAll] cleanup failed:", err);
    }
  });

  test("admin can author, edit, and delete a campaign + multi-step sequence", async ({
    request: _unused,
    page,
  }) => {
    test.setTimeout(120_000);

    // We deliberately pull the APIRequestContext off the BrowserContext so
    // session cookies set by /api/auth/login are shared with the browser
    // tab; the test fixture's `request` lives in a separate cookie jar.
    const request = page.context().request;

    // ── Setup: log in via API and provision a brand for this run.
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = await brandRes.json();
    createdBrandIds.push(brand.id);

    // ── Browser session: pin the active brand before navigating.
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

    // ════════════════════════════════════════════════════════════════════
    //  CAMPAIGNS
    // ════════════════════════════════════════════════════════════════════
    // Hydrate auth + entitlements so AdminRoute and marketing route gate both pass
    // before we navigate to the editor (the route only registers when
    // useEntitlement("marketing_os") has resolved with active=true).
    await page.goto("/");
    await page.waitForResponse(
      (r) => r.url().includes("/api/auth/me") && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.waitForResponse(
      (r) => r.url().includes("/api/me/entitlements") && r.status() === 200,
      { timeout: 15_000 },
    );
    // Use a single-shot navigation+wait helper so both auth and entitlements
    // resolve under the page we're actually asserting against (page.goto reloads
    // the SPA, so any "wait once" we did on / does not carry forward).
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/me/entitlements") && r.status() === 200,
        { timeout: 20_000 },
      ),
      page.goto("/marketing/campaigns"),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({ timeout: 20_000 });

    // Open create form
    await page.click('[data-testid="button-new-campaign"]');
    await expect(page.locator('[data-testid="form-create-campaign"]')).toBeVisible();
    const preview = page.locator('[data-testid="premium-email-preview"]');
    await expect(preview).toBeVisible();

    // Type fields and assert the live preview mirrors them.
    await page.fill('[data-testid="input-campaign-name"]', CAMPAIGN_NAME);
    await page.fill('[data-testid="input-campaign-subject"]', CAMPAIGN_SUBJECT);
    await expect(preview).toContainText(CAMPAIGN_SUBJECT);

    await page.fill('[data-testid="input-campaign-from-name"]', CAMPAIGN_FROM_NAME);
    await page.fill('[data-testid="input-campaign-from-email"]', CAMPAIGN_FROM_EMAIL);
    await expect(preview).toContainText(CAMPAIGN_FROM_NAME);
    await expect(preview).toContainText(CAMPAIGN_FROM_EMAIL);

    await page.fill('[data-testid="input-campaign-reply-to"]', CAMPAIGN_REPLY_TO);
    await expect(preview).toContainText(`Reply: ${CAMPAIGN_REPLY_TO}`);

    await page.fill('[data-testid="input-campaign-body"]', CAMPAIGN_BODY);
    await expect(preview).toContainText(CAMPAIGN_BODY);

    // Save the draft
    await page.click('[data-testid="button-save-campaign"]');
    await expect(page.locator('[data-testid="form-create-campaign"]')).toBeHidden({ timeout: 10_000 });

    // Resolve the row so we can target follow-up actions.
    const campaignRow = page.locator(`[data-testid^="row-campaign-"]`, { hasText: CAMPAIGN_NAME });
    await expect(campaignRow).toBeVisible();
    const campaignRowId = await campaignRow.getAttribute("data-testid");
    expect(campaignRowId).toMatch(/^row-campaign-/);
    const campaignId = campaignRowId!.replace(/^row-campaign-/, "");
    await expect(page.locator(`[data-testid="text-campaign-name-${campaignId}"]`)).toHaveText(CAMPAIGN_NAME);
    await expect(page.locator(`[data-testid="text-campaign-subject-${campaignId}"]`)).toHaveText(CAMPAIGN_SUBJECT);

    // Edit → mutate subject + body, watch preview update, then save.
    await page.click(`[data-testid="button-edit-campaign-${campaignId}"]`);
    await expect(page.locator('[data-testid="form-edit-campaign"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-campaign-subject"]')).toHaveValue(CAMPAIGN_SUBJECT);

    const editPreview = page.locator('[data-testid="premium-email-preview"]');
    await page.fill('[data-testid="input-campaign-subject"]', CAMPAIGN_NEW_SUBJECT);
    await expect(editPreview).toContainText(CAMPAIGN_NEW_SUBJECT);
    await expect(editPreview).not.toContainText(CAMPAIGN_SUBJECT);

    await page.fill('[data-testid="input-campaign-body"]', CAMPAIGN_NEW_BODY);
    await expect(editPreview).toContainText(CAMPAIGN_NEW_BODY);

    await page.click('[data-testid="button-save-campaign"]');
    await expect(page.locator('[data-testid="form-edit-campaign"]')).toBeHidden({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="text-campaign-subject-${campaignId}"]`)).toHaveText(CAMPAIGN_NEW_SUBJECT);

    // Delete via confirmation dialog
    await page.click(`[data-testid="button-delete-campaign-${campaignId}"]`);
    await expect(page.locator('[data-testid="dialog-delete-campaign"]')).toBeVisible();
    await page.click('[data-testid="button-confirm-delete-campaign"]');
    await expect(page.locator(`[data-testid="row-campaign-${campaignId}"]`)).toBeHidden({ timeout: 10_000 });

    // ════════════════════════════════════════════════════════════════════
    //  SEQUENCES
    // ════════════════════════════════════════════════════════════════════
    await page.goto("/marketing/sequences");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible();

    await page.click('[data-testid="button-new-sequence"]');
    await expect(page.locator('[data-testid="form-create-sequence"]')).toBeVisible();

    await page.fill('[data-testid="input-sequence-name"]', SEQUENCE_NAME);
    await page.fill('[data-testid="input-sequence-description"]', SEQUENCE_DESC);
    await page.fill('[data-testid="input-sequence-from-name"]', CAMPAIGN_FROM_NAME);
    await page.fill('[data-testid="input-sequence-from-email"]', CAMPAIGN_FROM_EMAIL);
    await page.fill('[data-testid="input-sequence-reply-to"]', CAMPAIGN_REPLY_TO);

    // Step 1 (auto-created on entry, "Send immediately").
    const seqPreview = page.locator('[data-testid="premium-email-preview"]');
    await expect(seqPreview).toContainText("Sends on enrollment");

    await page.fill('[data-testid="input-step-subject-0"]', STEP1_SUBJECT);
    await page.fill('[data-testid="input-step-body-0"]', STEP1_BODY);
    await expect(seqPreview).toContainText(STEP1_SUBJECT);
    await expect(seqPreview).toContainText(STEP1_BODY);

    // Add step 2 — automatically becomes active per addStep().
    await page.click('[data-testid="button-add-step"]');
    await expect(page.locator('[data-testid="step-card-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="step-editor-1"]')).toBeVisible();

    // Default delay is 3 — preview should reflect it before any edits.
    await expect(seqPreview).toContainText("Waits 3 days after previous step");

    await page.fill('[data-testid="input-step-delay-1"]', "5");
    await expect(seqPreview).toContainText("Waits 5 days after previous step");
    await expect(page.locator('[data-testid="step-card-1"]')).toContainText("Wait 5 days");

    await page.fill('[data-testid="input-step-subject-1"]', STEP2_SUBJECT);
    await page.fill('[data-testid="input-step-body-1"]', STEP2_BODY);
    await expect(seqPreview).toContainText(STEP2_SUBJECT);
    await expect(seqPreview).toContainText(STEP2_BODY);
    // Step 1 content must NOT be in the preview while step 2 is active.
    await expect(seqPreview).not.toContainText(STEP1_BODY);

    // Switch back to step 1 — preview re-mirrors step 1.
    await page.click('[data-testid="step-card-0"]');
    await expect(seqPreview).toContainText(STEP1_SUBJECT);
    await expect(seqPreview).toContainText(STEP1_BODY);
    await expect(seqPreview).toContainText("Sends on enrollment");
    await expect(seqPreview).not.toContainText(STEP2_BODY);

    // Reorder: move step 2 up so it becomes step 1.
    // After the swap, the (former) step 2 card lives at index 0 and the
    // first card label switches to "Send immediately" (per the editor's
    // "i === 0 ? Send immediately : Wait N days" rule).
    await page.click('[data-testid="button-step-up-1"]');
    await expect(page.locator('[data-testid="step-card-0"]')).toContainText(STEP2_SUBJECT);
    await expect(page.locator('[data-testid="step-card-0"]')).toContainText("Send immediately");
    await expect(page.locator('[data-testid="step-card-1"]')).toContainText(STEP1_SUBJECT);
    await expect(page.locator('[data-testid="step-card-1"]')).toContainText("Wait 0 days");

    // Save the sequence.
    await page.click('[data-testid="button-save-sequence"]');
    await expect(page.locator('[data-testid="form-create-sequence"]')).toBeHidden({ timeout: 10_000 });

    const seqRow = page.locator(`[data-testid^="row-sequence-"]`, { hasText: SEQUENCE_NAME });
    await expect(seqRow).toBeVisible();
    const seqRowId = await seqRow.getAttribute("data-testid");
    const sequenceId = seqRowId!.replace(/^row-sequence-/, "");
    await expect(page.locator(`[data-testid="text-sequence-desc-${sequenceId}"]`)).toHaveText(SEQUENCE_DESC);

    // Verify the saved order via the API (cheap, deterministic, no UI race).
    const seqDetail = await request.get(`${BASE}/api/marketing/sequences/${sequenceId}`);
    expect(seqDetail.status()).toBe(200);
    const seqJson = (await seqDetail.json()) as {
      steps: Array<{ stepOrder: number; delayDays: number; subject: string }>;
    };
    expect(seqJson.steps).toHaveLength(2);
    const ordered = [...seqJson.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    // After the reorder, the step formerly at index 1 (STEP2, delay=5) is now
    // at order=0 and the step formerly at index 0 (STEP1, delay=0) is at
    // order=1. Per-step delay travels with the step itself even though the
    // editor *displays* index-0 as "Send immediately" regardless of its value.
    expect(ordered[0].subject).toBe(STEP2_SUBJECT);
    expect(ordered[0].delayDays).toBe(5);
    expect(ordered[1].subject).toBe(STEP1_SUBJECT);
    expect(ordered[1].delayDays).toBe(0);

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
