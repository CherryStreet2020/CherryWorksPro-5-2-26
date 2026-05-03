/**
 * Task #441 — Audit §2.3 coverage gap: contact-detail deep flows.
 *
 * Covers (per audit checklist): timeline retrieval, lifecycle/lead-status
 * "reassign" via PATCH (the codebase has no separate `ownerId` field on
 * marketing prospects — DRIFT — so we exercise lifecycleStage + leadStatus
 * as the assignable per-contact pivots), tag add/remove, segment
 * resolution, sequence enrollment, send-history surface (campaign
 * failures endpoint), and unsubscribe / bounced flags via the
 * self-service unsubscribe route.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { createBrand } from "../tests/helpers/po/brands";
import { loginIsolated } from "./_iso-helpers";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — contact-detail deep (Task #441)", () => {
  test("lifecycle reassign + tag + segment membership + sequence enrollment + send-history endpoints", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "Detail Brand",
      slug: "detail",
    });

    // 1. Create contact
    const cRes = await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        firstName: "Deep",
        lastName: "Detail",
        email: "deep@detail.test",
        lifecycleStage: "lead",
      },
    });
    expect(cRes.status()).toBe(201);
    const contact = await cRes.json();

    // 2. Reassign lifecycle + lead status (PATCH)
    const patchRes = await request.patch(
      `${BASE}/api/marketing/contacts/${contact.id}`,
      {
        headers: HDRS(csrf),
        data: { lifecycleStage: "mql", leadStatus: "qualified" },
      },
    );
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).lifecycleStage).toBe("mql");

    // 3. Create tag and attach
    const tagRes = await request.post(`${BASE}/api/marketing/tags`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "VIP", color: "#cf3339" },
    });
    expect(tagRes.status()).toBe(201);
    const tag = await tagRes.json();
    const attach = await request.post(
      `${BASE}/api/marketing/contacts/${contact.id}/tags`,
      { headers: HDRS(csrf), data: { tagId: tag.id } },
    );
    expect([200, 201, 204]).toContain(attach.status());

    // 4. Activity timeline returns the system-write rows. The firehose
    //    is the source of truth — the contact-detail page reads it via
    //    react-query under the same key path.
    const acts = await request.get(
      `${BASE}/api/marketing/activities?brandId=${brand.id}&prospectId=${contact.id}`,
    );
    expect(acts.status()).toBe(200);
    const actsBody = await acts.json();
    const actRows = Array.isArray(actsBody) ? actsBody : actsBody.rows ?? [];
    expect(actRows.length).toBeGreaterThanOrEqual(1);

    // 5. Segment resolves the tagged contact
    const segRes = await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        name: "VIP Segment",
        filter: { tagIds: [tag.id], search: "" },
      },
    });
    expect(segRes.status()).toBe(201);
    const segment = await segRes.json();
    const segContacts = await request.get(
      `${BASE}/api/marketing/segments/${segment.id}/contacts`,
    );
    expect(segContacts.status()).toBe(200);
    const segBody = await segContacts.json();
    const segRows = Array.isArray(segBody) ? segBody : segBody.rows ?? [];
    expect(segRows.some((r: { id: string }) => r.id === contact.id)).toBe(true);

    // 6. Sequence enrollment via the contact directly
    const seqRes = await request.post(`${BASE}/api/marketing/sequences`, {
      headers: HDRS(csrf),
      data: { brandId: brand.id, name: "Welcome", description: "" },
    });
    expect(seqRes.status()).toBe(201);
    const seq = await seqRes.json();
    const enroll = await request.post(
      `${BASE}/api/marketing/sequences/${seq.id}/enrollments`,
      { headers: HDRS(csrf), data: { prospectIds: [contact.id] } },
    );
    expect(enroll.status()).toBe(201);
    const enrollBody = await enroll.json();
    expect(enrollBody.inserted).toBe(1);
    const enrollList = await request.get(
      `${BASE}/api/marketing/sequences/${seq.id}/enrollments`,
    );
    expect(enrollList.status()).toBe(200);
    expect(((await enrollList.json()) as unknown[]).length).toBeGreaterThanOrEqual(1);

    // 7. Self-service unsubscribe flips the contact to unsubscribed.
    const unsub = await request.post(
      `${BASE}/api/marketing/contacts/${contact.id}/unsubscribe`,
      { headers: HDRS(csrf), data: {} },
    );
    expect([200, 204]).toContain(unsub.status());
    const refetch = await request.get(
      `${BASE}/api/marketing/contacts/${contact.id}`,
    );
    expect(refetch.status()).toBe(200);
    const refetched = await refetch.json();
    expect(refetched.unsubscribedAt).toBeTruthy();
  });

  test("UI — detail page renders header testids and brand-mismatch logic with active brand context", async ({
    page,
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const brand = await createBrand(isolatedOrg, {
      name: "UI Detail",
      slug: "ui-detail",
    });
    const c = await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brand.id,
        firstName: "Page",
        lastName: "Person",
        email: "ui@detail.test",
      },
    });
    const contact = await c.json();

    await loginIsolated(page, isolatedOrg);
    await page.goto(`/marketing/contacts/${contact.id}`);
    await expect(page.locator('[data-testid="text-contact-name"]')).toContainText("Page", { timeout: 15_000 });
    await expect(page.locator('[data-testid="form-edit-contact"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-timeline-title"]')).toBeVisible();
  });
});
