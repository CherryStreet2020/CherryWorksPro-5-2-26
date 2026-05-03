/**
 * Task #441 — Audit §6.1.7: brand-aware cross-brand isolation.
 *
 * Mints two brands inside a single isolated org and verifies that
 * every brand-scoped Marketing surface refuses to leak rows from
 * brand A into brand B (and vice versa). Also verifies the explicit
 * cross-brand guard rails on segments-in-campaigns and tag filters.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { setEntitlement } from "../tests/helpers/po/tier";
import { BASE } from "../tests/helpers/po/auth";
import { withTwoBrands, createBrand } from "../tests/helpers/po/brands";

const HDRS = (csrf: string) => ({ "x-csrf-token": csrf });

test.describe("Marketing OS — cross-brand isolation (Task #441 / audit §6.1.7)", () => {
  test("contacts, companies, tags, segments, sequences, campaigns — each brand-scoped query only returns its own rows", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const { brandA, brandB } = await withTwoBrands(isolatedOrg);

    // Seed one of each resource type in brand A.
    const cA = await (await request.post(`${BASE}/api/marketing/contacts`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandA.id,
        firstName: "OnlyA",
        lastName: "Contact",
        email: "onlya@brand-a.test",
      },
    })).json();
    const coA = await (await request.post(`${BASE}/api/marketing/companies`, {
      headers: HDRS(csrf),
      data: { brandId: brandA.id, name: "Only-A Co", domain: "only-a.test" },
    })).json();
    const tA = await (await request.post(`${BASE}/api/marketing/tags`, {
      headers: HDRS(csrf),
      data: { brandId: brandA.id, name: "OnlyA-Tag", color: "#000000" },
    })).json();
    const sA = await (await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandA.id,
        name: "Only-A Seg",
        filter: { tagIds: [], search: "" },
      },
    })).json();
    const seqA = await (await request.post(
      `${BASE}/api/marketing/sequences`,
      {
        headers: HDRS(csrf),
        data: { brandId: brandA.id, name: "Only-A Seq", description: "" },
      },
    )).json();
    const campA = await (await request.post(
      `${BASE}/api/marketing/campaigns`,
      {
        headers: HDRS(csrf),
        data: {
          brandId: brandA.id,
          name: "Only-A Camp",
          subject: "S",
          body: "<p/>",
          fromEmail: "noreply@brand-a.test",
          fromName: "A",
          audienceType: "all",
        },
      },
    )).json();

    // Helper: fetch a brand-scoped list endpoint and unwrap.
    const list = async (path: string) => {
      const r = await request.get(`${BASE}${path}`);
      expect(r.status()).toBe(200);
      const j = await r.json();
      return Array.isArray(j) ? j : j.rows ?? [];
    };

    // Brand B view — must NOT contain any of the A-scoped rows.
    const contactsB = await list(`/api/marketing/contacts?brandId=${brandB.id}`);
    expect(contactsB.find((r: { id: string }) => r.id === cA.id)).toBeUndefined();
    const companiesB = await list(`/api/marketing/companies?brandId=${brandB.id}`);
    expect(companiesB.find((r: { id: string }) => r.id === coA.id)).toBeUndefined();
    const tagsB = await list(`/api/marketing/tags?brandId=${brandB.id}`);
    expect(tagsB.find((r: { id: string }) => r.id === tA.id)).toBeUndefined();
    const segmentsB = await list(`/api/marketing/segments?brandId=${brandB.id}`);
    expect(segmentsB.find((r: { id: string }) => r.id === sA.id)).toBeUndefined();
    const sequencesB = await list(`/api/marketing/sequences?brandId=${brandB.id}`);
    expect(sequencesB.find((r: { id: string }) => r.id === seqA.id)).toBeUndefined();
    const campaignsB = await list(`/api/marketing/campaigns?brandId=${brandB.id}`);
    expect(campaignsB.find((r: { id: string }) => r.id === campA.id)).toBeUndefined();

    // Brand A view — DOES contain its own rows (positive assertion to
    // ensure we didn't accidentally test against an empty list).
    const contactsA = await list(`/api/marketing/contacts?brandId=${brandA.id}`);
    expect(contactsA.find((r: { id: string }) => r.id === cA.id)).toBeTruthy();
  });

  test("cross-brand guards: segment-in-campaign create rejected with 400 + segment filter cannot reference cross-brand tag", async ({
    isolatedOrg,
  }) => {
    const { request, csrf, orgId } = isolatedOrg;
    await setEntitlement(orgId, "marketing_os", true);
    const { brandA, brandB } = await withTwoBrands(isolatedOrg);

    const tagB = await (await request.post(`${BASE}/api/marketing/tags`, {
      headers: HDRS(csrf),
      data: { brandId: brandB.id, name: "B-Tag", color: "#ffffff" },
    })).json();
    const segB = await (await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandB.id,
        name: "B Seg",
        filter: { tagIds: [], search: "" },
      },
    })).json();

    // Try to create a brand-A campaign that references a brand-B segment.
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
    expect((await camp.json()).message).toMatch(/different brand|brand/i);

    // Try to create a brand-A segment whose filter cites a brand-B tag.
    const seg = await request.post(`${BASE}/api/marketing/segments`, {
      headers: HDRS(csrf),
      data: {
        brandId: brandA.id,
        name: "Cross Seg",
        filter: { tagIds: [tagB.id], search: "" },
      },
    });
    expect(seg.status()).toBe(400);
    const segBody = await seg.json();
    expect(segBody.invalidTagIds ?? []).toContain(tagB.id);
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
    expect((await res.json()).message).toMatch(/different brand|brand/i);
  });
});
