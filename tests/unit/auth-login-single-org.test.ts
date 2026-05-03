/**
 * Task #458 — Single-org admin login is a single round trip.
 *
 * Task #457 removed the duplicate `cherry-street-consulting` org so the
 * seeded admins live on exactly one workspace. The frontend picker UI in
 * `client/src/pages/login.tsx` only renders when the API returns
 * `{needsOrgPick: true, ...}`, so this test pins the API contract:
 * a single-org admin must get a session payload (no `needsOrgPick` and
 * no `orgs` array) on the first POST, with the session cookie set.
 *
 * Pairs with `e2e/login-single-org-no-picker.spec.ts`, which proves the
 * same outcome from the user-facing UI.
 */
import { describe, it, expect } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";

async function rawLogin(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const body = await res.json();
  return { status: res.status, body, setCookies };
}

describe("POST /api/auth/login — single-org admin", () => {
  it("returns the user payload in one round trip (no needsOrgPick)", async () => {
    const r = await rawLogin("admin.test@cwpro.dev", "admin123");
    expect(r.status).toBe(200);
    // The hallmark of the picker branch — must NOT be present for a
    // single-org admin. If this ever flips back to true the login UI
    // will render the workspace picker even though there's nothing
    // meaningful to pick.
    expect(r.body.needsOrgPick).toBeUndefined();
    expect(r.body.orgs).toBeUndefined();
    // The success branch in `finalizeLogin` returns the safe user
    // (id + email + role + orgId) and sets the session cookie.
    expect(r.body.id).toBeTruthy();
    expect(r.body.email).toBe("admin.test@cwpro.dev");
    expect(r.body.role).toBe("ADMIN");
    expect(r.body.orgId).toBeTruthy();
    expect(
      r.setCookies.some((c) => c.startsWith("connect.sid=")),
      "session cookie should be set on a single-org login",
    ).toBe(true);
  });
});
