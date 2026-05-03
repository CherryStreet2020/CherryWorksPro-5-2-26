import { test, expect } from "../tests/helpers/po/fixtures";
import {
  closeRevPool,
  insertClient,
  sweepOrgRevenue,
} from "./_revenue-helpers";

test.afterEach(async ({ isolatedOrg }) => {
  await sweepOrgRevenue(isolatedOrg.orgId);
});
test.afterAll(async () => {
  await closeRevPool();
});

async function createDraftEstimate(
  iso: { request: import("@playwright/test").APIRequestContext; csrf: string },
  clientId: string,
): Promise<{ id: string }> {
  const r = await iso.request.post("/api/estimates", {
    headers: { "x-csrf-token": iso.csrf },
    data: {
      clientId,
      issuedDate: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Scope of work", quantity: 1, unitRate: 1000 }],
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return await r.json();
}

async function sendEstimate(
  iso: { request: import("@playwright/test").APIRequestContext; csrf: string },
  estId: string,
): Promise<string> {
  const r = await iso.request.post(`/api/estimates/${estId}/send`, {
    headers: { "x-csrf-token": iso.csrf },
    data: {},
  });
  expect(r.status(), await r.text()).toBe(200);
  const body = await r.json();
  expect(typeof body.publicToken).toBe("string");
  expect(body.publicToken.length).toBe(64);
  return body.publicToken;
}

test.describe("Estimates — public token accept/decline + convert", () => {
  test("public GET / decline via token: SENT → DECLINED", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const est = await createDraftEstimate(isolatedOrg, clientId);
    const token = await sendEstimate(isolatedOrg, est.id);

    const get = await isolatedOrg.request.get(`/api/public/estimates/${token}`);
    expect(get.status()).toBe(200);
    const pub = await get.json();
    expect(pub.id).toBe(est.id);
    expect(pub.status).toBe("SENT");

    const decline = await isolatedOrg.request.post(
      `/api/public/estimates/${token}/decline`,
    );
    expect(decline.status()).toBe(200);

    const after = await isolatedOrg.request.get(`/api/estimates/${est.id}`);
    expect((await after.json()).status).toBe("DECLINED");

    // Idempotency / state-guard: a second decline on a non-SENT estimate is rejected.
    const second = await isolatedOrg.request.post(
      `/api/public/estimates/${token}/decline`,
    );
    expect(second.status()).toBe(400);
  });

  test("public accept + convert-to-invoice: ACCEPTED → INVOICED with lines copied", async ({
    isolatedOrg,
  }) => {
    const clientId = await insertClient(isolatedOrg.orgId);
    const est = await createDraftEstimate(isolatedOrg, clientId);
    const token = await sendEstimate(isolatedOrg, est.id);

    const accept = await isolatedOrg.request.post(
      `/api/public/estimates/${token}/accept`,
    );
    expect(accept.status()).toBe(200);

    const convert = await isolatedOrg.request.post(
      `/api/estimates/${est.id}/convert-to-invoice`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(convert.status(), await convert.text()).toBe(201);
    const invoice = await convert.json();
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.sourceEstimateId).toBe(est.id);
    expect(Number(invoice.total)).toBeCloseTo(1000, 2);
    expect(Array.isArray(invoice.lines)).toBe(true);
    expect(invoice.lines.length).toBe(1);

    const refetch = await isolatedOrg.request.get(`/api/estimates/${est.id}`);
    expect((await refetch.json()).status).toBe("INVOICED");
  });

  test("invalid public token returns 404", async ({ isolatedOrg }) => {
    const fake = "0".repeat(64);
    const r = await isolatedOrg.request.get(`/api/public/estimates/${fake}`);
    expect(r.status()).toBe(404);
  });
});
