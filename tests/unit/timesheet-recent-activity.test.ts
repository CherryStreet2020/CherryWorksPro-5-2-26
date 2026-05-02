import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";

let cookie = "";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map((c) => c.split(";")[0]).join("; ");
});

describe("GET /api/timesheets/recent-activity", () => {
  it("requires authentication", async () => {
    const res = await fetch(`${BASE}/api/timesheets/recent-activity`);
    expect([401, 403]).toContain(res.status);
  });

  it("returns an array of audit entries for an authorised admin", async () => {
    const res = await fetch(`${BASE}/api/timesheets/recent-activity`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const entry of body) {
      expect(typeof entry.id).toBe("string");
      expect(["TIMESHEET_SUBMITTED", "TIMESHEET_RECALLED", "TIMESHEET_APPROVED", "TIMESHEET_REJECTED"]).toContain(entry.action);
      expect(entry.entityType).toBe("timesheet");
      expect(typeof entry.actorName).toBe("string");
    }
  });

  it("respects the limit query parameter", async () => {
    const res = await fetch(`${BASE}/api/timesheets/recent-activity?limit=3`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(3);
  });
});
