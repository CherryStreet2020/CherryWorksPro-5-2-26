/**
 * Task #299 — End-to-end coverage for the Sequence Failures dialog.
 *
 * Task #270 added a "Failures" affordance to the Marketing OS sequences
 * page in two places:
 *
 *   1. A per-row icon on the sequences list that opens a dialog showing
 *      every recipient who failed any step in that sequence (the row
 *      shows the failed step number alongside the recipient).
 *   2. A per-step icon inside the sequence editor that opens the same
 *      dialog filtered to a single step (the Step column collapses
 *      because every row is for the same step).
 *
 * This spec drives both entry points from a real admin's POV:
 *
 *   - Provision a brand, a contact, and a 2-step sequence via the API.
 *   - Seed two `email_send_attempts` rows directly against the DB so the
 *     test does not depend on the worker actually trying (and failing)
 *     to send: one permanent failure on step 0 and one on step 1, both
 *     for the same contact.
 *   - Open the sequence-level dialog from the list view and assert
 *     both failed rows are present with their step numbers (1 and 2,
 *     since the UI renders step_index + 1).
 *   - Open the editor, click the per-step Failures icon for step 2,
 *     and assert the dialog shows ONLY the step-2 failure (the Step
 *     column header is dropped because the dialog is filtered to a
 *     single step — see SequenceFailuresDialog in
 *     client/src/pages/marketing-os/sequences.tsx).
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";
import { pool } from "../server/db";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_EMAIL = "admin.test@cwpro.dev";
const ADMIN_PASS = "admin123";

async function login(request: APIRequestContext) {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(r.status()).toBe(200);
}

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BRAND_NAME = `Marketing Editors E2E ${RUN}`;
// Reuse the cleanup script's allow-listed slug prefix.
const BRAND_SLUG = `marketing-editors-e2e-${RUN}`;
const CONTACT_FIRST = "Failure";
const CONTACT_LAST = `Dialog-${RUN}`;
const CONTACT_EMAIL = `failures-dialog-${RUN}@example.test`;
const SEQUENCE_NAME = `Failures Dialog Sequence ${RUN}`;
const STEP1_SUBJECT = `Day-zero ping ${RUN}`;
const STEP1_BODY = `Step 0 body ${RUN}.`;
const STEP2_SUBJECT = `Day-five follow-up ${RUN}`;
const STEP2_BODY = `Step 1 body ${RUN}.`;

test.describe("Marketing OS — sequence failures dialog (Task #299)", () => {
  const createdBrandIds: string[] = [];

  test.afterAll(async () => {
    try {
      await cleanupE2EBrandPollution(createdBrandIds);
    } catch (err) {
      console.error(
        "[marketing-sequence-failures-dialog afterAll] cleanup failed:",
        err,
      );
    }
  });

  test("admin can open sequence-level and per-step Failures dialogs", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const request = page.context().request;

    // ── Auth + provision: brand, contact, 2-step sequence.
    await login(request);
    const csrf = await getCsrfToken(request);
    const headers = { "X-CSRF-Token": csrf };

    const brandRes = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(brandRes.status()).toBe(201);
    const brand = (await brandRes.json()) as { id: string };
    createdBrandIds.push(brand.id);

    const contactRes = await request.post(`${BASE}/api/marketing/contacts`, {
      data: {
        brandId: brand.id,
        firstName: CONTACT_FIRST,
        lastName: CONTACT_LAST,
        email: CONTACT_EMAIL,
      },
      headers,
    });
    expect(contactRes.status()).toBe(201);
    const contact = (await contactRes.json()) as { id: string };

    // The contact row carries org_id, which we need for the seeded
    // email_send_attempts rows below (the failures route filters by
    // org_id + sequence_id).
    const { rows: contactRows } = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM client_contacts WHERE id = $1`,
      [contact.id],
    );
    expect(contactRows.length).toBe(1);
    const orgId = contactRows[0].org_id;

    const seqRes = await request.post(`${BASE}/api/marketing/sequences`, {
      data: {
        brandId: brand.id,
        name: SEQUENCE_NAME,
        description: `Failures dialog spec ${RUN}`,
      },
      headers,
    });
    expect(seqRes.status()).toBe(201);
    const sequence = (await seqRes.json()) as { id: string };

    const stepsRes = await request.put(
      `${BASE}/api/marketing/sequences/${sequence.id}/steps`,
      {
        data: {
          steps: [
            { delayDays: 0, subject: STEP1_SUBJECT, body: STEP1_BODY },
            { delayDays: 5, subject: STEP2_SUBJECT, body: STEP2_BODY },
          ],
        },
        headers,
      },
    );
    expect(stepsRes.status()).toBe(200);

    // ── Seed two permanent_failure attempts: one per step, same contact.
    //    We insert directly so the test isn't coupled to the worker's
    //    suppression / retry policy plumbing — the failures dialog is a
    //    pure read view over email_send_attempts and it should render
    //    whatever rows the storage layer surfaces.
    await pool.query(
      `INSERT INTO email_send_attempts
         (org_id, kind, sequence_id, step_index, contact_id, recipient_email,
          attempt_number, status, error_code, error_message, attempted_at)
       VALUES
         ($1, 'sequence', $2, 0, $3, $4, 1, 'permanent_failure',
          'recipient_suppressed', 'Suppressed for test', NOW() - INTERVAL '2 minutes'),
         ($1, 'sequence', $2, 1, $3, $4, 1, 'permanent_failure',
          'recipient_suppressed', 'Suppressed for test', NOW() - INTERVAL '1 minute')`,
      [orgId, sequence.id, contact.id, CONTACT_EMAIL],
    );

    // ── Browser session: pin the active brand before navigating so the
    //    sequences page doesn't bounce us through the brand-picker.
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
      page.goto("/marketing/sequences"),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await expect(page.locator('[data-testid="text-page-title"]')).toBeVisible({
      timeout: 20_000,
    });

    // ════════════════════════════════════════════════════════════════════
    //  PART 1 — Sequence-level Failures dialog (per-row icon).
    // ════════════════════════════════════════════════════════════════════
    const sequenceRow = page.locator(`[data-testid="row-sequence-${sequence.id}"]`);
    await expect(sequenceRow).toBeVisible({ timeout: 10_000 });

    await page.click(`[data-testid="button-failures-sequence-${sequence.id}"]`);
    const dialog = page.locator('[data-testid="dialog-sequence-failures"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Both seeded failures should render — the recipient name is
    // "<first> <last>" and each row exposes its step number (1-based).
    const expectedName = `${CONTACT_FIRST} ${CONTACT_LAST}`;
    const row0 = page.locator('[data-testid="row-sequence-failure-0"]');
    const row1 = page.locator('[data-testid="row-sequence-failure-1"]');
    await expect(row0).toBeVisible();
    await expect(row1).toBeVisible();

    // The route orders by step_index ASC, so row 0 = step 1, row 1 = step 2.
    await expect(
      page.locator('[data-testid="text-sequence-failure-name-0"]'),
    ).toHaveText(expectedName);
    await expect(
      page.locator('[data-testid="text-sequence-failure-step-0"]'),
    ).toHaveText("1");
    await expect(
      page.locator('[data-testid="text-sequence-failure-step-1"]'),
    ).toHaveText("2");

    // Status column should show "Gave up" for permanent_failure rows.
    await expect(
      page.locator('[data-testid="text-sequence-failure-status-0"]'),
    ).toHaveText("Gave up");

    // Close the sequence-level dialog before opening the editor.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // ════════════════════════════════════════════════════════════════════
    //  PART 2 — Per-step Failures dialog from the editor.
    // ════════════════════════════════════════════════════════════════════
    await page.click(`[data-testid="button-edit-sequence-${sequence.id}"]`);
    // Wait for the editor to render the persisted steps — the per-step
    // Failures icon is only enabled after the GET-by-id response wires
    // up `data.steps[i].stepOrder`.
    await expect(page.locator('[data-testid="step-card-1"]')).toBeVisible({
      timeout: 10_000,
    });

    const stepFailuresBtn = page.locator('[data-testid="button-step-failures-1"]');
    await expect(stepFailuresBtn).toBeVisible();
    await expect(stepFailuresBtn).toBeEnabled();
    await stepFailuresBtn.click();

    // The dialog re-opens, this time scoped to step 2 (stepOrder = 1
    // → "step 2" in the UI).
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText("Recipients who didn't receive step 2");

    // When filtered to a single step, the dialog drops the Step column,
    // so `text-sequence-failure-step-*` should NOT exist. We should see
    // exactly one row (the seeded step-1 failure) and no row for step 0.
    await expect(page.locator('[data-testid="row-sequence-failure-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="row-sequence-failure-1"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="text-sequence-failure-step-0"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="text-sequence-failure-name-0"]'),
    ).toHaveText(expectedName);
    await expect(
      page.locator('[data-testid="text-sequence-failure-status-0"]'),
    ).toHaveText("Gave up");

    expect(
      consoleErrors,
      `unexpected page/console errors: ${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });
});
