/**
 * Task #266 — Integration test for the on-demand cleanup route.
 *
 * Verifies POST /api/telemetry/marketing-os/cleanup/run:
 *   - Requires admin auth (anonymous = 401).
 *   - Runs the sweep and returns { ran: true, lastRun: {...} } with the
 *     freshly recorded run so the client can refresh the "Last cleanup"
 *     line without a follow-up GET.
 *   - When the advisory lock is held by another in-flight call, returns
 *     { ran: false, skipped: true, reason: "lock-held" } so the UI can
 *     surface a friendly "try again" message.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TEST_BASE as BASE_URL } from "../helpers/base";
import { db, pool } from "../../server/db";
import { marketingOsTelemetryCleanupRuns } from "@shared/schema";

interface Ctx {
  cookies: string;
  csrfToken: string;
}

async function loginAs(email: string, password: string): Promise<Ctx> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const csrfCookies = csrfRes.headers.getSetCookie();
  const csrfToken = csrfRes.headers.get("x-csrf-token")!;
  const cookieJar = csrfCookies.map((c) => c.split(";")[0]).join("; ");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieJar,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  expect(loginRes.status).toBe(200);
  const allCookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");
  return {
    cookies: allCookies,
    csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken,
  };
}

describe("POST /api/telemetry/marketing-os/cleanup/run (#266)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await loginAs("admin.test@cwpro.dev", "admin123");
  });

  afterAll(async () => {
    await db.delete(marketingOsTelemetryCleanupRuns);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(
      `${BASE_URL}/api/telemetry/marketing-os/cleanup/run`,
      { method: "POST", redirect: "manual" },
    );
    expect([401, 403]).toContain(res.status);
  });

  it("runs the sweep and returns the freshly recorded last run", async () => {
    const res = await fetch(
      `${BASE_URL}/api/telemetry/marketing-os/cleanup/run`,
      {
        method: "POST",
        headers: {
          Cookie: ctx.cookies,
          "X-CSRF-Token": ctx.csrfToken,
        },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ran).toBe(true);
    expect(body.lastRun).toBeTruthy();
    expect(typeof body.lastRun.ranAt).toBe("string");
    expect(typeof body.lastRun.cutoff).toBe("string");
    expect(typeof body.lastRun.deletedCount).toBe("number");
    expect(body.lastRun.retentionDays).toBeGreaterThanOrEqual(1);
  });

  it("reports skipped when the advisory lock is already held", async () => {
    // Simulate another replica holding the production lock key by grabbing
    // it on a dedicated client. The route must observe `pg_try_advisory_lock`
    // returning false and respond with the structured skipped envelope.
    const PROD_LOCK_KEY = 220_001;
    const client = await pool.connect();
    try {
      const lockRes = await client.query(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [PROD_LOCK_KEY],
      );
      expect(Boolean(lockRes.rows[0]?.acquired)).toBe(true);

      const res = await fetch(
        `${BASE_URL}/api/telemetry/marketing-os/cleanup/run`,
        {
          method: "POST",
          headers: {
            Cookie: ctx.cookies,
            "X-CSRF-Token": ctx.csrfToken,
          },
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ran).toBe(false);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe("lock-held");
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [PROD_LOCK_KEY])
        .catch(() => {});
      client.release();
    }
  });
});
