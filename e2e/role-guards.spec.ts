/**
 * Role-guard smoke (Task #431, audit §3.1 "Role guards … Partially
 * covered via API specs").
 *
 * Asserts on the API surface that admin-only routes refuse anonymous
 * callers (401/403) and that the `/api/auth/me` shape is honoured for
 * a logged-in admin. The full ADMIN-vs-MANAGER-vs-TEAM_MEMBER matrix
 * across every protected route is deferred — see the coverage report.
 */
import { test, expect } from "@playwright/test";
import { BASE, loginApi } from "../tests/helpers/po/auth";

const ADMIN_ONLY_GETS = [
  "/api/admin/email/masked-suppressions",
  "/api/me/entitlements/details",
];

test.describe("Role guards — admin-only API surface", () => {
  test("anonymous callers get 401 on admin-only GETs", async ({ request }) => {
    for (const path of ADMIN_ONLY_GETS) {
      const r = await request.get(`${BASE}${path}`);
      expect(
        [401, 403],
        `${path} returned ${r.status()} for anonymous`,
      ).toContain(r.status());
    }
  });

  test("authed admin can read /api/auth/me", async ({ request }) => {
    await loginApi(request);
    const r = await request.get(`${BASE}/api/auth/me`);
    expect(r.status()).toBe(200);
    const me = await r.json();
    expect(me.email).toBeTruthy();
    expect(me.role).toBe("ADMIN");
    expect(me.orgId).toBeTruthy();
  });
});
