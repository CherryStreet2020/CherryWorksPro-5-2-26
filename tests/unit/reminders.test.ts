import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";
let csrfToken = "";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map(c => c.split(";")[0]).join("; ");
  csrfToken = res.headers.get("x-csrf-token") || "";
});

describe("Payment Reminders", () => {
  it("POST /api/reminders/process returns correct shape", async () => {
    const res = await fetch(`${BASE}/api/reminders/process`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("sent");
    expect(data).toHaveProperty("skipped");
    expect(data).toHaveProperty("errors");
    expect(typeof data.sent).toBe("number");
    expect(typeof data.skipped).toBe("number");
    expect(typeof data.errors).toBe("number");
  });

  it("requires auth", async () => {
    const res = await fetch(`${BASE}/api/reminders/process`, { method: "POST" });
    // CSRF middleware rejects unauth writes with 403 before requireAuth runs
    expect([401, 403]).toContain(res.status);
  });
});
