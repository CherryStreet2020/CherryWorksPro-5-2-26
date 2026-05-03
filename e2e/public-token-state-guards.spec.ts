/**
 * Public estimate token — used / wrong-state guards (Task #444).
 * Mints a real estimate, transitions it out of SENT, and asserts
 * the public accept/decline endpoints return the documented 400.
 */
import { test, expect } from "../tests/helpers/po/fixtures";

test.use({ navigationTimeout: 30_000 });

async function createSentEstimate(isolatedOrg: any): Promise<{ id: string; token: string }> {
  // 1. Create a client.
  const tag = Date.now().toString(36);
  const clientRes = await isolatedOrg.request.post("/api/clients", {
    data: { name: `Wrong-State Client ${tag}` },
    headers: { "X-CSRF-Token": isolatedOrg.csrf },
  });
  expect(clientRes.ok(), `client create: ${clientRes.status()}`).toBe(true);
  const client = await clientRes.json();

  // 2. Create a DRAFT estimate with one billable line.
  const estRes = await isolatedOrg.request.post("/api/estimates", {
    data: {
      clientId: client.id,
      issuedDate: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Consulting", quantity: 1, unitRate: 100 }],
    },
    headers: { "X-CSRF-Token": isolatedOrg.csrf },
  });
  expect(estRes.ok(), `estimate create: ${estRes.status()}`).toBe(true);
  const est = await estRes.json();

  // 3. Send → mints publicToken and flips status to SENT.
  const sendRes = await isolatedOrg.request.post(`/api/estimates/${est.id}/send`, {
    data: {},
    headers: { "X-CSRF-Token": isolatedOrg.csrf },
  });
  expect(sendRes.ok(), `estimate send: ${sendRes.status()}`).toBe(true);
  const sendBody = await sendRes.json();
  expect(typeof sendBody.publicToken).toBe("string");
  expect(sendBody.publicToken.length).toBe(64);
  return { id: est.id, token: sendBody.publicToken };
}

test.describe("Public estimate — wrong-state action guards", () => {
  test("accepted estimate: public decline returns 400 (cannot decline in current state)", async ({
    isolatedOrg,
    request,
  }) => {
    const { id, token } = await createSentEstimate(isolatedOrg);

    // Admin-side accept transitions SENT → ACCEPTED. The public
    // decline route requires SENT, so the next public POST must 400.
    const acceptRes = await isolatedOrg.request.post(`/api/estimates/${id}/accept`, {
      data: {},
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(acceptRes.ok(), `admin accept: ${acceptRes.status()}`).toBe(true);

    const publicDecline = await request.post(`/api/public/estimates/${token}/decline`);
    expect(publicDecline.status()).toBe(400);
    const body = await publicDecline.json();
    expect(body.message).toMatch(/cannot be declined/i);

    // Re-running accept on an already-ACCEPTED estimate via the
    // public route is a "used token" scenario — must also 400.
    const publicAcceptAgain = await request.post(`/api/public/estimates/${token}/accept`);
    expect(publicAcceptAgain.status()).toBe(400);
    const body2 = await publicAcceptAgain.json();
    expect(body2.message).toMatch(/cannot be accepted/i);
  });

  test("declined estimate: public accept returns 400 (cannot accept in current state)", async ({
    isolatedOrg,
    request,
  }) => {
    const { id, token } = await createSentEstimate(isolatedOrg);

    const declineRes = await isolatedOrg.request.post(`/api/estimates/${id}/decline`, {
      data: {},
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(declineRes.ok(), `admin decline: ${declineRes.status()}`).toBe(true);

    const publicAccept = await request.post(`/api/public/estimates/${token}/accept`);
    expect(publicAccept.status()).toBe(400);
    const body = await publicAccept.json();
    expect(body.message).toMatch(/cannot be accepted/i);
  });
});
