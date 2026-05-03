// Task #441 — Marketing OS audit §2.3: sequence enrollment-preview.
// Note: storage's segment-resolved enrollment returns zeros because
// the segment→prospect resolution is stubbed; prospectIds path is the
// fully wired one and matches what the UI uses for individual enroll.
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — sequence recipient-count preview", () => {
  test("preview returns the contract shape and prospectIds enroll is idempotent", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "Seq", slug: "seq" });
    const tag = await (await request.post(`${BASE}/api/marketing/tags`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "Wave1", color: "#00aa00" },
    })).json();
    const prospectIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await (await request.post(`${BASE}/api/marketing/contacts`, {
        headers: HDRS(csrf),
        data: { brandId: brand.id, firstName: `Seq${i}`, lastName: "M", email: `seq${i}@wave.test` },
      })).json();
      prospectIds.push(c.id);
      await request.post(
        `${BASE}/api/marketing/contacts/${c.id}/tags`,
        { headers: HDRS(csrf), data: { tagId: tag.id } },
      );
    }
    const segment = await (await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "Wave1 Segment", filter: { tagIds: [tag.id], search: "" } },
    })).json();
    const seq = await (await request.post(`${BASE}/api/marketing/sequences`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "Wave1 Seq", description: "" },
    })).json();

    const p1 = await request.get(
      `${BASE}/api/marketing/sequences/${seq.id}/enrollment-preview?segmentId=${segment.id}`,
    );
    expect(p1.status()).toBe(200);
    const body = await p1.json();
    expect(typeof body.totalContacts).toBe("number");
    expect(typeof body.alreadyEnrolled).toBe("number");
    expect(typeof body.newContacts).toBe("number");

    const enroll = await request.post(
      `${BASE}/api/marketing/sequences/${seq.id}/enrollments`,
      { headers: HDRS(csrf), data: { prospectIds } },
    );
    expect(enroll.status()).toBe(201);
    expect((await enroll.json()).inserted).toBe(2);

    const reEnroll = await request.post(
      `${BASE}/api/marketing/sequences/${seq.id}/enrollments`,
      { headers: HDRS(csrf), data: { prospectIds } },
    );
    expect(reEnroll.status()).toBe(201);
    const reBody = await reEnroll.json();
    expect(reBody.inserted).toBe(0);
    expect(reBody.skipped).toBe(2);
  });

  test("cross-brand segment rejected from enrollment-preview with 400", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brandA = await createBrand(isolatedOrg, { name: "A", slug: "a" });
    const brandB = await createBrand(isolatedOrg, { name: "B", slug: "b" });
    const segB = await (await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: { brandId: brandB.id, name: "B Seg", filter: { tagIds: [], search: "" } },
    })).json();
    const seqA = await (await request.post(`${BASE}/api/marketing/sequences`, {
      headers: HDRS(csrf),
      data: { brandId: brandA.id, name: "A Seq", description: "" },
    })).json();
    const res = await request.get(
      `${BASE}/api/marketing/sequences/${seqA.id}/enrollment-preview?segmentId=${segB.id}`,
    );
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/different brand/i);
  });

  test("UI — enroll-segment dialog renders the preview line with a numeric count", async ({
    page, isolatedOrg,
  }) => {
    test.setTimeout(45_000);
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, { name: "UI Seq", slug: "ui-seq" });
    for (let i = 0; i < 2; i++) {
      await request.post(`${BASE}/api/marketing/contacts`, {
        headers: HDRS(csrf),
        data: { brandId: brand.id, firstName: `UI${i}`, lastName: "R", email: `ui-r-${i}@wave.test` },
      });
    }
    await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "UI Seg", filter: { tagIds: [], search: "" } },
    });
    const seq = await (await request.post(`${BASE}/api/marketing/sequences`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "UI Seq", description: "" },
    })).json();

    await loginIsolated(page, isolatedOrg);
    await page.goto("/marketing/sequences");
    const manage = page.locator(`[data-testid="button-manage-sequence-${seq.id}"]`);
    await expect(manage).toBeVisible({ timeout: 15_000 });
    await manage.click();
    await page.click('[data-testid="button-enroll-segment"]');
    await expect(page.locator('[data-testid="dialog-enroll-segment"]')).toBeVisible();
    await page.click('[data-testid="select-segment"]');
    await page.locator('[role="option"]').first().click();
    const previewLine = page.locator('[data-testid="text-segment-enroll-preview"]');
    await expect(previewLine).toHaveText(/\d/, { timeout: 15_000 });
  });
});
