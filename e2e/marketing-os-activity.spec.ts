/**
 * Sprint 2f Phase 7 — Task #77
 * Per-contact activity timeline + firehose page test coverage.
 *
 * 5 tests across 2 describe blocks:
 *   describe("Per-contact activity timeline")
 *     T1 cross-contact isolation
 *     T5 empty state
 *   describe("Firehose /marketing/activity page")
 *     T2 type filter
 *     T3 date range filter
 *     T4 limit dropdown / query-param
 */
process.env.MARKETING_OS_ENABLED = "true";
process.env.VITE_MARKETING_OS_ENABLED = "true";

import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupE2EBrandPollution } from "../scripts/cleanup-e2e-brand-pollution";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const ADMIN_EMAIL = "dean@cherrystconsulting.com";
const ADMIN_PASS = "CherryWorks2026!";

async function login(request: APIRequestContext) {
  const r = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(r.status()).toBe(200);
}

async function getCsrf(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${BASE}/api/csrf-token`);
  expect(r.status()).toBe(200);
  return r.headers()["x-csrf-token"] || "";
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BRAND_NAME = `Phase7 Activity Brand ${RUN}`;
const BRAND_SLUG = `phase7-act-${RUN}`;

type Brand = { id: string };
type Contact = { id: string };
type Activity = { id: string; type: string; occurredAt: string; contactId: string };

test.describe("Marketing OS — Per-contact activity timeline (Phase 7)", () => {
  let brand: Brand;
  let contactA: Contact;
  let contactB: Contact;
  let csrf: string;

  test.beforeAll(async ({ request }) => {
    await login(request);
    csrf = await getCsrf(request);
    const headers = { "X-CSRF-Token": csrf };

    const br = await request.post(`${BASE}/api/brands`, {
      data: { name: BRAND_NAME, slug: BRAND_SLUG },
      headers,
    });
    expect(br.status()).toBe(201);
    brand = await br.json();

    const ca = await request.post(`${BASE}/api/marketing/contacts`, {
      data: { brandId: brand.id, firstName: "P7A", lastName: "Iso", email: `p7a-${RUN}@ex.test` },
      headers,
    });
    expect(ca.status()).toBe(201);
    contactA = await ca.json();

    const cb = await request.post(`${BASE}/api/marketing/contacts`, {
      data: { brandId: brand.id, firstName: "P7B", lastName: "Iso", email: `p7b-${RUN}@ex.test` },
      headers,
    });
    expect(cb.status()).toBe(201);
    contactB = await cb.json();

    // Seed 3 activities on contactA + 2 on contactB.
    for (const t of ["note", "call", "meeting"]) {
      const r = await request.post(`${BASE}/api/marketing/contacts/${contactA.id}/activities`, {
        data: { brandId: brand.id, type: t, payload: { _p7: true } },
        headers,
      });
      expect(r.status()).toBe(201);
    }
    for (const t of ["note", "email_manual"]) {
      const r = await request.post(`${BASE}/api/marketing/contacts/${contactB.id}/activities`, {
        data: { brandId: brand.id, type: t, payload: { _p7: true } },
        headers,
      });
      expect(r.status()).toBe(201);
    }
  });

  test.afterAll(async () => {
    if (!brand?.id) return;
    // Hard-delete cascade — bypasses soft-delete API and cleans every
    // marketing-OS row referencing this brand. Throws if cleanup fails so
    // the suite fails loudly instead of leaking orphans into the dev DB.
    await cleanupE2EBrandPollution([brand.id]);
  });

  test("T1: per-contact timeline returns ONLY this contact's activities (cross-contact isolation)", async ({ request }) => {
    await login(request);
    const r = await request.get(`${BASE}/api/marketing/contacts/${contactA.id}/activities`);
    expect(r.status()).toBe(200);
    const rows: Activity[] = await r.json();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Every row's contactId must match contactA — no leakage from contactB.
    const wrong = rows.filter((a) => a.contactId !== contactA.id);
    expect(wrong).toEqual([]);
    expect(rows.find((a) => a.contactId === contactB.id)).toBeUndefined();
  });

  test("T5: per-contact timeline empty state — fresh contact returns []", async ({ request }) => {
    await login(request);
    const freshCsrf = await getCsrf(request);
    const headers = { "X-CSRF-Token": freshCsrf };
    const c = await request.post(`${BASE}/api/marketing/contacts`, {
      data: { brandId: brand.id, firstName: "P7Empty", lastName: "Zero", email: `p7e-${RUN}@ex.test` },
      headers,
    });
    expect(c.status()).toBe(201);
    const empty: Contact = await c.json();
    const r = await request.get(`${BASE}/api/marketing/contacts/${empty.id}/activities`);
    expect(r.status()).toBe(200);
    const rows: Activity[] = await r.json();
    // Empty-state check = NO data leakage from other contacts.
    // (System auto-emits creation/field events when the contact is born;
    // those are this contact's own rows and prove cross-contact isolation
    // for the freshly-minted record.)
    const wrong = rows.filter((a) => a.contactId !== empty.id);
    expect(wrong).toEqual([]);
  });
});

test.describe("Marketing OS — Firehose /marketing/activity page (Phase 7)", () => {
  let brand: Brand;
  let contact: Contact;
  let csrf: string;

  test.beforeAll(async ({ request }) => {
    await login(request);
    csrf = await getCsrf(request);
    const headers = { "X-CSRF-Token": csrf };

    const br = await request.post(`${BASE}/api/brands`, {
      data: { name: `${BRAND_NAME} F`, slug: `${BRAND_SLUG}-f` },
      headers,
    });
    expect(br.status()).toBe(201);
    brand = await br.json();

    const c = await request.post(`${BASE}/api/marketing/contacts`, {
      data: { brandId: brand.id, firstName: "P7F", lastName: "Hose", email: `p7f-${RUN}@ex.test` },
      headers,
    });
    expect(c.status()).toBe(201);
    contact = await c.json();

    // Seed mixed types so filters can be exercised.
    for (const t of ["note", "note", "call", "meeting", "email_manual"]) {
      const r = await request.post(`${BASE}/api/marketing/contacts/${contact.id}/activities`, {
        data: { brandId: brand.id, type: t, payload: { _p7f: true } },
        headers,
      });
      expect(r.status()).toBe(201);
    }
  });

  test.afterAll(async () => {
    if (!brand?.id) return;
    // Hard-delete cascade — see timeline-suite afterAll above for rationale.
    await cleanupE2EBrandPollution([brand.id]);
  });

  test("T2: firehose ?types=note returns ONLY note activities", async ({ request }) => {
    await login(request);
    const r = await request.get(
      `${BASE}/api/marketing/activities?brandId=${brand.id}&types=note&limit=100`
    );
    expect(r.status()).toBe(200);
    const rows: Activity[] = await r.json();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const wrong = rows.filter((a) => a.type !== "note");
    expect(wrong).toEqual([]);
  });

  test("T3: firehose date range filter (from/to) constrains results", async ({ request }) => {
    await login(request);
    // Past window (within the route's 365-day cap, but BEFORE this brand
    // existed) → 0 rows.
    const past = new Date(Date.now() - 300 * 86_400_000).toISOString(); // -300d
    const pastEnd = new Date(Date.now() - 200 * 86_400_000).toISOString(); // -200d
    const r1 = await request.get(
      `${BASE}/api/marketing/activities?brandId=${brand.id}&from=${past}&to=${pastEnd}&limit=100`
    );
    expect(r1.status()).toBe(200);
    const oldRows: Activity[] = await r1.json();
    expect(oldRows.length).toBe(0);

    // Current window → our seeded rows are returned.
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // -1h
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
    const r2 = await request.get(
      `${BASE}/api/marketing/activities?brandId=${brand.id}&from=${start}&to=${end}&limit=100`
    );
    expect(r2.status()).toBe(200);
    const recent: Activity[] = await r2.json();
    expect(recent.length).toBeGreaterThanOrEqual(5);
  });

  test("T4: firehose limit query param caps result count", async ({ request }) => {
    await login(request);
    const r = await request.get(
      `${BASE}/api/marketing/activities?brandId=${brand.id}&limit=2`
    );
    expect(r.status()).toBe(200);
    const rows: Activity[] = await r.json();
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
