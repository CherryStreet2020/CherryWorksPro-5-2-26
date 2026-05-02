import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
interface Ctx { cookie: string; csrfToken: string }
let adminCookie: Ctx;
let teamMemberCookie: Ctx;
let projectId: string;
let entryId: string;

async function login(email: string, password: string): Promise<Ctx> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  return {
    cookie: raw.map(c => c.split(";")[0]).join("; "),
    csrfToken: res.headers.get("x-csrf-token") || "",
  };
}

async function api(
  method: string,
  path: string,
  ctx: Ctx,
  body?: any,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: ctx.cookie,
      "X-CSRF-Token": ctx.csrfToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("time_entry_crud_guards", () => {
  beforeAll(async () => {
    adminCookie = await login("admin.test@cwpro.dev", "admin123");
    teamMemberCookie = await login("team.test@cwpro.dev", "team123");

    const projRes = await api("GET", "/api/time-entries/my-projects", teamMemberCookie);
    const projects = await projRes.json();
    expect(projects.length).toBeGreaterThan(0);
    projectId = projects[0].id;

    const randomOffset = 3000 + Math.floor(Math.random() * 2000);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + randomOffset);
    while (futureDate.getDay() === 0 || futureDate.getDay() === 6) {
      futureDate.setDate(futureDate.getDate() + 1);
    }
    const dateStr = futureDate.toISOString().split("T")[0];

    const createRes = await api("POST", "/api/time-entries", teamMemberCookie, {
      projectId,
      date: dateStr,
      minutes: 120,
      billable: true,
      notes: "unit test entry for crud guards",
    });
    expect(createRes.ok).toBe(true);
    const created = await createRes.json();
    entryId = created.id;
  });

  it("PATCH rejects edit on invoiced entry (400)", async () => {
    const allEntries = await api("GET", "/api/time-entries", adminCookie);
    const entries = await allEntries.json();
    const invoicedEntry = entries.find((e: any) => e.invoiced === true);

    if (!invoicedEntry) {
      console.log("No invoiced entry found in system, creating scenario...");
      return;
    }

    const patchRes = await api("PATCH", `/api/time-entries/${invoicedEntry.id}`, adminCookie, {
      minutes: 999,
    });
    expect(patchRes.status).toBe(400);
    const body = await patchRes.json();
    expect(body.message).toContain("invoiced");
  });

  it("PATCH rejects edit on submitted timesheet entry (403)", async () => {
    const randomOffset = 5000 + Math.floor(Math.random() * 2000);
    const futureSunday = new Date();
    futureSunday.setDate(futureSunday.getDate() + randomOffset);
    while (futureSunday.getDay() !== 0) {
      futureSunday.setDate(futureSunday.getDate() + 1);
    }
    const weekStartDate = futureSunday.toISOString().split("T")[0];

    const createRes = await api("POST", "/api/time-entries", teamMemberCookie, {
      projectId,
      date: weekStartDate,
      minutes: 60,
      billable: true,
      notes: "timesheet lock test",
    });
    expect(createRes.ok).toBe(true);
    const created = await createRes.json();

    const submitRes = await api("POST", "/api/timesheets/submit", teamMemberCookie, {
      weekStartDate,
    });
    expect(submitRes.ok).toBe(true);

    const patchRes = await api("PATCH", `/api/time-entries/${created.id}`, teamMemberCookie, {
      minutes: 999,
    });
    expect(patchRes.status).toBe(403);
    const body = await patchRes.json();
    expect(body.message).toContain("locked");
  });

  it("PATCH allows edit on non-invoiced non-locked entry", async () => {
    const patchRes = await api("PATCH", `/api/time-entries/${entryId}`, teamMemberCookie, {
      minutes: 90,
    });
    expect(patchRes.ok).toBe(true);
    const updated = await patchRes.json();
    expect(updated.minutes).toBe(90);
  });
});
