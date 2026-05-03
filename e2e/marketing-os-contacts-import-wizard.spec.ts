/**
 * Task #441 — Audit §2.3 / §6.1.7 coverage gap: contacts-import wizard.
 *
 * Drives the four-step wizard primarily via the API surface
 * (POST/GET /api/marketing/contacts/import) since that's what the UI
 * itself drives. A small UI smoke confirms the page renders and the
 * upload dropzone is wired. Heavy CSV parsing is covered by the
 * existing client-side Papa.parse code path; we focus on the
 * server-side wizard contracts: dryRun preview, real async import,
 * malformed-mapping rejection, and a partial-failure surface.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — contacts import wizard (Task #441)", () => {
  test("dry-run preview returns projected create/update/skip counts without writing", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Import Brand",
      slug: "imp",
    });

    // Seed one existing prospect so dryRun's dedupe lookup has something
    // to project against.
    const seed = await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        firstName: "Existing",
        lastName: "Person",
        email: "existing@example.test",
      },
    });
    expect(seed.status()).toBe(201);

    const res = await request.post(
      `${BASE}/api/marketing/contacts/import`,
      {
        headers: HDRS(csrf),
        data: {
          brandId: brand.id,
          fileName: "preview.csv",
          dryRun: true,
          mapping: {
            "First Name": "firstName",
            "Last Name": "lastName",
            "Email": "email",
          },
          dedupeStrategy: "skip",
          rows: [
            // Will create
            { "First Name": "New", "Last Name": "Lead", "Email": "new1@example.test" },
            { "First Name": "Other", "Last Name": "Lead", "Email": "new2@example.test" },
            // Will skip (duplicate of seed under skip strategy)
            { "First Name": "Existing", "Last Name": "Person", "Email": "existing@example.test" },
            // Error: missing required first name
            { "First Name": "", "Last Name": "Nope", "Email": "noname@example.test" },
          ],
        },
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.created).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.errors.length).toBeGreaterThanOrEqual(1);

    // Verify dryRun did NOT actually create anything new.
    const after = await request.get(
      `${BASE}/api/marketing/contacts?brandId=${brand.id}`,
    );
    expect(after.status()).toBe(200);
    const list = await after.json();
    const rows = Array.isArray(list) ? list : list.rows ?? [];
    const emails = new Set<string>(rows.map((r: { email: string }) => (r.email ?? "").toLowerCase()));
    expect(emails.has("existing@example.test")).toBe(true);
    expect(emails.has("new1@example.test")).toBe(false);
  });

  test("malformed mapping (missing required First/Last Name) rejected at the API boundary", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Bad Map Brand",
      slug: "bad-map",
    });

    // Mapping omits firstName entirely — every row will be planned as an
    // "error" since the worker requires it. dryRun surfaces the error
    // count without writing.
    const res = await request.post(
      `${BASE}/api/marketing/contacts/import`,
      {
        headers: HDRS(csrf),
        data: {
          brandId: brand.id,
          fileName: "bad.csv",
          dryRun: true,
          mapping: { "Email": "email" }, // no firstName, no lastName
          dedupeStrategy: "skip",
          rows: [
            { "Email": "a@example.test" },
            { "Email": "b@example.test" },
          ],
        },
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.errors.length).toBe(2);
    expect(body.errors[0].message).toBeTruthy();
  });

  test("real import enqueues, polls to completion, and reports partial-failure errors", async ({
    isolatedOrg,
  }) => {
    test.setTimeout(45_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Real Import",
      slug: "real-imp",
    });

    const res = await request.post(
      `${BASE}/api/marketing/contacts/import`,
      {
        headers: HDRS(csrf),
        data: {
          brandId: brand.id,
          fileName: "real.csv",
          mapping: {
            "First Name": "firstName",
            "Last Name": "lastName",
            "Email": "email",
          },
          dedupeStrategy: "skip",
          rows: [
            { "First Name": "Alpha", "Last Name": "One", "Email": "alpha@e2e.test" },
            { "First Name": "Beta",  "Last Name": "Two", "Email": "beta@e2e.test" },
            // Partial-failure row: missing firstName
            { "First Name": "",      "Last Name": "Bad", "Email": "bad@e2e.test" },
          ],
        },
      },
    );
    expect(res.status()).toBe(202);
    const enq = await res.json();
    const importId: string = enq.importId;
    expect(importId).toBeTruthy();
    expect(enq.rowCount).toBe(3);

    // Poll up to ~15s for the worker to drain.
    const deadline = Date.now() + 15_000;
    let final: { status: string; imported: number; errorCount: number; tagged: number; rowCount: number } | null = null;
    while (Date.now() < deadline) {
      const s = await request.get(
        `${BASE}/api/marketing/contacts/import/${importId}`,
      );
      expect(s.status()).toBe(200);
      const j = await s.json();
      if (j.status === "completed" || j.status === "failed") {
        final = j;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(final, "import did not reach a terminal state in time").not.toBeNull();
    expect(final!.status).toBe("completed");
    expect(final!.imported).toBe(2);
    expect(final!.errorCount).toBe(1);

    // The two valid rows should now be visible on the contacts list.
    const list = await request.get(
      `${BASE}/api/marketing/contacts?brandId=${brand.id}`,
    );
    expect(list.status()).toBe(200);
    const body = await list.json();
    const rows = Array.isArray(body) ? body : body.rows ?? [];
    const emails = new Set<string>(rows.map((r: { email: string | null }) => (r.email ?? "").toLowerCase()));
    expect(emails.has("alpha@e2e.test")).toBe(true);
    expect(emails.has("beta@e2e.test")).toBe(true);
    expect(emails.has("bad@e2e.test")).toBe(false);
  });

  test("UI smoke — wizard page renders the upload dropzone for an entitled admin", async ({
    page,
    isolatedOrg,
  }) => {
    const { orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    await createBrand(isolatedOrg, { name: "UI Smoke", slug: "ui-smoke" });
    await loginIsolated(page, isolatedOrg);

    await page.goto("/marketing/contacts/import");
    await expect(
      page.locator('[data-testid="page-contacts-import"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="dropzone-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="step-indicator"]')).toBeVisible();
  });
});
