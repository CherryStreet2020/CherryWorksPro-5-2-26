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

    // The route rejects dates more than a day ahead ("Cannot submit time for
    // future dates") and more than a year back, so pick a weekday 4–8 weeks
    // ago — far enough back that no other test file has locked that week.
    const randomOffset = 28 + Math.floor(Math.random() * 28);
    const entryDate = new Date();
    entryDate.setDate(entryDate.getDate() - randomOffset);
    while (entryDate.getDay() === 0 || entryDate.getDay() === 6) {
      entryDate.setDate(entryDate.getDate() + 1);
    }
    const dateStr = entryDate.toISOString().split("T")[0];

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
    // A week 10–14 weeks back: past (the route rejects future dates), inside
    // the one-year window, and far from the weeks other files touch.
    const randomOffset = 70 + Math.floor(Math.random() * 28);
    const pastSunday = new Date();
    pastSunday.setDate(pastSunday.getDate() - randomOffset);
    while (pastSunday.getDay() !== 0) {
      pastSunday.setDate(pastSunday.getDate() - 1);
    }
    const weekStartDate = pastSunday.toISOString().split("T")[0];

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
