import { describe, it, expect } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), csrf: res.headers.get("x-csrf-token") || "" };
}

describe("onboarding lifecycle endpoints", () => {
  it("signup-status is public and enabled by default", async () => {
    const res = await fetch(`${BASE}/api/auth/signup-status`);
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(true);
  });

  it("verify-email rejects junk and short tokens without leaking anything", async () => {
    for (const token of ["", "short", "f".repeat(64)]) {
      const res = await fetch(`${BASE}/api/auth/verify-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("TOKEN_INVALID");
    }
  });

  it("resend-verification needs a session; a legacy (backfilled) account is already verified", async () => {
    const anon = await fetch(`${BASE}/api/auth/resend-verification`, { method: "POST" });
    expect([401, 403]).toContain(anon.status); // no session: CSRF or auth refuses it
    const admin = await login("admin.test@cwpro.dev", "admin123");
    const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: admin.cookie } })).json();
    expect(me.emailVerifiedAt).toBeTruthy();
    const res = await fetch(`${BASE}/api/auth/resend-verification`, { method: "POST", headers: { Cookie: admin.cookie, "X-CSRF-Token": admin.csrf } });
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyVerified).toBe(true);
  });

  it("billing status exposes the plan-gate fields", async () => {
    const admin = await login("admin.test@cwpro.dev", "admin123");
    const b = await (await fetch(`${BASE}/api/billing/status`, { headers: { Cookie: admin.cookie } })).json();
    expect(typeof b.hasSubscription).toBe("boolean");
    expect(b.planInactive).toBe(false);
  });

  it("platform signup switch is invisible to a tenant admin (404, existence-hiding)", async () => {
    const admin = await login("admin.test@cwpro.dev", "admin123");
    const get = await fetch(`${BASE}/api/platform/settings/signup`, { headers: { Cookie: admin.cookie } });
    expect(get.status).toBe(404);
    const put = await fetch(`${BASE}/api/platform/settings/signup`, { method: "PUT", headers: { Cookie: admin.cookie, "X-CSRF-Token": admin.csrf, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(put.status).toBe(404);
  });
});
