/**
 * The non-HttpOnly signed-in hint (cwp_signed_in) exists only so the client's first
 * paint at "/" matches what the server sent: absent → marketing home (the pre-rendered
 * document), present → auth skeleton. It must appear on login and disappear on logout,
 * and it must never be HttpOnly (the client reads it).
 */
import { describe, it, expect } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

async function csrf(): Promise<{ token: string; cookies: string[] }> {
  const r = await fetch(`${BASE}/api/csrf-token`);
  const body = await r.json();
  return { token: body.csrfToken ?? body.token, cookies: r.headers.getSetCookie().map((c) => c.split(";")[0]) };
}

describe("signed-in hint cookie", () => {
  it("is set (non-HttpOnly) on login and cleared on logout", async () => {
    const { token, cookies } = await csrf();
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies.join("; "), "X-CSRF-Token": token },
      body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
    });
    expect(login.status).toBe(200);
    const set = login.headers.getSetCookie();
    const hint = set.find((c) => c.startsWith("cwp_signed_in=1"));
    expect(hint, `set-cookie: ${set.join(" | ")}`).toBeDefined();
    expect(hint!.toLowerCase()).not.toContain("httponly");
    expect(hint!.toLowerCase()).toContain("samesite=lax");

    // login regenerates the session, so fetch a CSRF token for the signed-in session
    const jar0 = [...cookies, ...set.map((c) => c.split(";")[0])].join("; ");
    const csrf2 = await fetch(`${BASE}/api/csrf-token`, { headers: { Cookie: jar0 } });
    const body2 = await csrf2.json();
    const jar = [jar0, ...csrf2.headers.getSetCookie().map((c) => c.split(";")[0])].join("; ");
    const logout = await fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: jar, "X-CSRF-Token": body2.csrfToken ?? body2.token },
    });
    expect(logout.status).toBe(200);
    const cleared = logout.headers.getSetCookie().find((c) => c.startsWith("cwp_signed_in="));
    expect(cleared, "logout must clear the hint").toBeDefined();
    expect(cleared!).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
  });
});
