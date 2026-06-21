/**
 * Security regression: the SAML Assertion Consumer Service
 * (POST /api/saml/acs/:orgSlug) used to establish an authenticated session from
 * identity fields (email/name/groups) taken straight from the request body,
 * without verifying the signed SAML assertion — an unauthenticated SSO auth
 * bypass / privilege escalation (audit #1, CRITICAL). It could log an attacker
 * in as any existing user, or JIT-provision a fresh ADMIN from groups:["Admins"].
 *
 * The fix disables SSO sign-in until a real signed-assertion flow is built: the
 * ACS and SP-login endpoints now establish no session and return 503. This spec
 * pins that the attack body forges nothing.
 */
import { test, expect } from "@playwright/test";

test.describe("SAML ACS auth-bypass closed (CRITICAL #1)", () => {
  test("ACS does not forge a session from request-body identity", async ({ request }) => {
    // Anonymous context starts unauthenticated.
    const pre = await request.get("/api/auth/me", { failOnStatusCode: false });
    expect([401, 403]).toContain(pre.status());

    // The exact old exploit: POST identity straight to the ACS, including an
    // admin group to JIT-provision an ADMIN.
    const acs = await request.post("/api/saml/acs/cherry-street-consulting", {
      data: { email: "attacker@evil.com", name: "Attacker", groups: ["Admins"] },
      failOnStatusCode: false,
    });
    expect(acs.status()).not.toBe(200);
    expect(acs.status()).toBe(503);
    const body = await acs.text();
    expect(body).not.toContain("\"success\":true");
    expect(body).not.toContain("\"role\"");

    // Same context is STILL unauthenticated — no session was established.
    const post = await request.get("/api/auth/me", { failOnStatusCode: false });
    expect([401, 403]).toContain(post.status());
  });

  test("logging in as an existing email via ACS is refused", async ({ request }) => {
    // The seeded admin's email — the old code would have logged in as them.
    const acs = await request.post("/api/saml/acs/cherry-street-consulting", {
      data: { email: "dean@cherrystconsulting.com" },
      failOnStatusCode: false,
    });
    expect(acs.status()).toBe(503);
    const me = await request.get("/api/auth/me", { failOnStatusCode: false });
    expect([401, 403]).toContain(me.status());
  });

  test("SP-initiated login entrypoint is disabled", async ({ request }) => {
    const resp = await request.get("/api/saml/login/cherry-street-consulting", { failOnStatusCode: false });
    expect(resp.status()).toBe(503);
  });
});
