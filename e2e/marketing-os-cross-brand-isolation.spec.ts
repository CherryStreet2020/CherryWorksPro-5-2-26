/**
 * Task #441 — Audit §6.1.7: brand-aware cross-brand isolation.
 *
 * API: every brand-scoped Marketing surface refuses to leak brand-A
 * rows into brand-B (and vice versa); explicit guards on
 * segment-in-campaign + tag-in-segment + audience-preview reject
 * cross-brand references with 400.
 *
 * UI: switching the active brand from A to B clears the search filter
 * on the contacts page (filters are brand-scoped).
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { withTwoBrands, createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — cross-brand isolation (Task #441 / audit §6.1.7)", () => {
  test("brand-scoped queries return only their own rows", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const { brandA, brandB } = await withTwoBrands(isolatedOrg);

    const cA = await (await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandA.id,
        firstName: "OnlyA",
        lastName: "Contact",
        email: "onlya@brand-a.test",
      },
    })).json();
    const cB = await (await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandB.id,
        firstName: "OnlyB",
        lastName: "Contact",
        email: "onlyb@brand-b.test",
      },
    })).json();
    // GET /api/marketing/contacts returns the array directly (no
    // {rows} envelope); the legacy `.rows ?? []` fallback was masking
    // empty results.
    const aRaw = await (await request.get(
      `${BASE}/api/marketing/contacts?brandId=${brandA.id}`,
    )).json();
    const aRows = Array.isArray(aRaw) ? aRaw : (aRaw.rows ?? []);
    const aIds = new Set(aRows.map((r: { id: string }) => r.id));
    expect(aIds.has(cA.id)).toBe(true);
    expect(aIds.has(cB.id)).toBe(false);

    const bRaw = await (await request.get(
      `${BASE}/api/marketing/contacts?brandId=${brandB.id}`,
    )).json();
    const bRows = Array.isArray(bRaw) ? bRaw : (bRaw.rows ?? []);
    const bIds = new Set(bRows.map((r: { id: string }) => r.id));
    expect(bIds.has(cB.id)).toBe(true);
    expect(bIds.has(cA.id)).toBe(false);
  });

  test("guards: segment-in-campaign and tag-in-segment reject cross-brand references with 400", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const { brandA, brandB } = await withTwoBrands(isolatedOrg);
    const tagB = await (await request.post(`${BASE}/api/marketing/tags`, {
      headers: HDRS(csrf),
      data: { brandId: brandB.id, name: "B Tag", color: "#000000" },
    })).json();
    const segB = await (await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandB.id,
        name: "B Seg",
        filter: { tagIds: [tagB.id], search: "" },
      },
    })).json();

    const camp = await request.post(`${BASE}/api/marketing/campaigns`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandA.id,
        name: "Cross Camp",
        subject: "S",
        body: "<p/>",
        fromEmail: "noreply@brand-a.test",
        fromName: "A",
        audienceType: "segment",
        audienceSegmentId: segB.id,
      },
    });
    expect(camp.status()).toBe(400);
    expect((await camp.json()).message).toMatch(/brand/i);

    const seg = await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandA.id,
        name: "Cross Seg",
        filter: { tagIds: [tagB.id], search: "" },
      },
    });
    expect(seg.status()).toBe(400);
    expect((await seg.json()).invalidTagIds ?? []).toContain(tagB.id);
  });

  test("audience-preview rejects brandId/segmentId mismatch with 400", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brandA = await createBrand(isolatedOrg, { name: "Aud A", slug: "aud-a" });
    const brandB = await createBrand(isolatedOrg, { name: "Aud B", slug: "aud-b" });
    const segB = await (await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandB.id,
        name: "Aud B Seg",
        filter: { tagIds: [], search: "" },
      },
    })).json();
    const res = await request.get(
      `${BASE}/api/marketing/campaigns/audience-preview?brandId=${brandA.id}&audienceType=segment&segmentId=${segB.id}`,
    );
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/brand/i);
  });

  test("UI — switching the active brand on /marketing/contacts isolates the row from brand A", async ({
    page,
    isolatedOrg,
  }) => {
    test.setTimeout(45_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const { brandA, brandB } = await withTwoBrands(isolatedOrg);
    // Seed a brand-A-only contact so the grid has a deterministic row
    // to look for after each brand switch.
    const onlyA = await (await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandA.id,
        firstName: "Alice",
        lastName: "OnlyA",
        email: "alice-only-a@brand-a.test",
      },
    })).json();

    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/contacts");

    // Land on either the brand picker (new isolated org) or the grid.
    const pickA = page.locator(`[data-testid="button-pick-brand-${brandA.id}"]`);
    const search = page.locator('[data-testid="input-search-contacts"]');
    await Promise.race([
      pickA.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
      search.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
    ]);
    if (await pickA.isVisible().catch(() => false)) {
      await pickA.click();
    }
    await expect(search).toBeVisible({ timeout: 15_000 });

    // Brand A → row visible.
    await expect(
      page.locator(`[data-testid="row-contact-${onlyA.id}"]`),
    ).toBeVisible({ timeout: 15_000 });

    // Switch to brand B via the header switcher; confirm the active
    // brand chip flips and the brand-A row disappears from the grid.
    await page.click('[data-testid="button-brand-switcher"]');
    await page.click(`[data-testid="menu-item-brand-${brandB.id}"]`);
    await expect(
      page.locator('[data-testid="text-active-brand"]'),
    ).toContainText(brandB.name, { timeout: 10_000 });
    await expect(
      page.locator(`[data-testid="row-contact-${onlyA.id}"]`),
    ).toHaveCount(0, { timeout: 10_000 });
  });
});
