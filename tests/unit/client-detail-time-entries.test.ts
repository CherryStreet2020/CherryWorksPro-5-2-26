import { describe, it, expect, afterAll } from "vitest";
import { TEST_BASE as BASE } from "../helpers/base";

interface Ctx { cookie: string; csrfToken: string }
let admin: Ctx = { cookie: "", csrfToken: "" };
let clientId = "";
let projectId = "";
const entryIds: string[] = [];
const ENTRY_COUNT = 13; // more than the ten-row Overview sample

async function api(method: string, path: string, ctx: Ctx, body?: any) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Cookie: ctx.cookie, "X-CSRF-Token": ctx.csrfToken },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

async function login(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return {
    cookie: cookies.map((c: string) => c.split(";")[0]).join("; "),
    csrfToken: res.headers.get("x-csrf-token") || "",
  };
}

describe("client detail: Time & Billing sees every entry, not the ten most recent", () => {
  it("setup: client, project, and more than ten time entries", async () => {
    admin = await login("admin.test@cwpro.dev", "admin123");
    const c = await api("POST", "/api/clients", admin, { name: `Time Tab Client ${Date.now()}` });
    expect(c.ok).toBe(true);
    clientId = (await c.json()).id;

    const p = await api("POST", "/api/projects", admin, { clientId, name: "Time Tab Project", status: "ACTIVE" });
    expect(p.ok).toBe(true);
    projectId = (await p.json()).id;

    for (let i = 0; i < ENTRY_COUNT; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const r = await api("POST", "/api/time-entries", admin, { projectId, date, minutes: 30, billable: true, notes: `entry ${i}` });
      expect(r.status, `entry ${i}`).toBe(200);
      entryIds.push((await r.json()).id);
    }
  });

  it("GET /api/clients/:id returns the full list and a ten-row recent sample", async () => {
    const res = await api("GET", `/api/clients/${clientId}`, admin);
    expect(res.ok).toBe(true);
    const detail = await res.json();

    expect(Array.isArray(detail.timeEntries)).toBe(true);
    expect(detail.timeEntries.length).toBe(ENTRY_COUNT);
    expect(detail.recentTimeEntries.length).toBe(10);

    const totalMinutes = detail.timeEntries.reduce((s: number, te: any) => s + te.minutes, 0);
    expect(totalMinutes).toBe(ENTRY_COUNT * 30);

    // Newest first, and the recent sample is a prefix of the full list.
    const dates = detail.timeEntries.map((te: any) => te.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(detail.recentTimeEntries.map((te: any) => te.id)).toEqual(detail.timeEntries.slice(0, 10).map((te: any) => te.id));

    // Each entry carries what the tab renders.
    for (const te of detail.timeEntries) {
      expect(te.projectName).toBe("Time Tab Project");
      expect(typeof te.userName).toBe("string");
      expect(typeof te.minutes).toBe("number");
    }
  });

  afterAll(async () => {
    for (const id of entryIds) await api("DELETE", `/api/time-entries/${id}`, admin).catch(() => {});
    if (projectId) await api("DELETE", `/api/projects/${projectId}`, admin).catch(() => {});
    if (clientId) await api("DELETE", `/api/clients/${clientId}`, admin).catch(() => {});
  });
});
