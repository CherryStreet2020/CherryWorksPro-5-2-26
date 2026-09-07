import { describe, it, expect } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { cookie: cookies.map((c: string) => c.split(";")[0]).join("; "), csrf: res.headers.get("x-csrf-token") || "" };
}
const api = (m: string, p: string, s: { cookie: string; csrf: string }, body?: any) =>
  fetch(`${BASE}${p}`, { method: m, headers: { "Content-Type": "application/json", Cookie: s.cookie, "X-CSRF-Token": s.csrf }, body: body ? JSON.stringify(body) : undefined });

describe("saved Jira connection", () => {
  it("starts disconnected; test/import without a token explain what to do; bad input is a 400", async () => {
    const admin = await login("admin.test@cwpro.dev", "admin123");
    const view = await (await api("GET", "/api/support/import/jira-connection", admin)).json();
    expect(view.connected).toBe(false);
    const t = await api("POST", "/api/support/import/jira-test", admin, {});
    expect(t.status).toBe(400);
    expect((await t.json()).message).toMatch(/No saved Jira connection/);
    const bad = await api("PUT", "/api/support/import/jira-connection", admin, { baseUrl: "https://evil.example", email: "x", apiToken: "short", projectKey: "abs" });
    expect(bad.status).toBe(400);
    const del = await api("DELETE", "/api/support/import/jira-connection", admin);
    expect((await del.json()).connected).toBe(false);
  });
  it("is admin-only", async () => {
    const team = await login("team.test@cwpro.dev", "team123");
    expect((await api("GET", "/api/support/import/jira-connection", team)).status).toBe(403);
  });
});
