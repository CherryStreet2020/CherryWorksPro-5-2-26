/**
 * Task #247 — Route-level test for GET /api/admin/email/failure-alerts.
 *
 * Task #226 added unit-level coverage for `listFailureAlerts` (date range,
 * pagination, org scoping). This test exercises the HTTP boundary so that
 * regressions in query-param parsing (`from`, `to`, `limit`, `offset`) and
 * the JSON envelope shape (`alerts`, `total`, `limit`, `offset`, `from`,
 * `to`, `retentionDays`, `orgScope`, `thresholdPerHour`) are caught before
 * they reach the admin UI's pagination control.
 *
 * Talks to the dedicated test server booted by tests/setup/global-setup.ts.
 * Reuses the seeded admin user (admin.test@cwpro.dev) from
 * tests/integration/seed-role-users so we do not need to mint one.
 *
 * To stay isolated from other suites that may also seed alerts, we use a
 * per-run time window placed far in the future — `listFailureAlerts`
 * orders by ts desc with no upper-bound cap, and `pruneOldFailureAlerts`
 * only deletes rows OLDER than the retention window, so future-dated rows
 * are safe and uniquely ours.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TEST_BASE as BASE_URL } from "../helpers/base";
import { db } from "../../server/db";
import { emailFailureAlerts } from "@shared/schema";
import { and, gte, lte } from "drizzle-orm";

interface Ctx {
  cookies: string;
  csrfToken: string;
  orgId: string;
}

interface AlertEnvelope {
  alerts: Array<{
    ts: number;
    threshold: number;
    thresholdBreached: boolean;
    delivered: boolean;
    failureCount: number;
    topTransport: string | null;
    topErrorCode: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
  from: number | null;
  to: number | null;
  retentionDays: number;
  orgScope: string | null;
  isPlatformOperator: boolean;
  orgNames: Record<string, string>;
  thresholdPerHour: number;
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
  const cookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: cookies } });
  expect(meRes.status).toBe(200);
  const me = await meRes.json();
  expect(me.role).toBe("ADMIN");
  return {
    cookies,
    csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken,
    orgId: me.orgId,
  };
}

async function getAlerts(
  ctx: Ctx,
  query: Record<string, string | number | undefined> = {},
): Promise<{ status: number; body: AlertEnvelope }> {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const path = `/api/admin/email/failure-alerts${qs ? `?${qs}` : ""}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: ctx.cookies } });
  const body = (await res.json()) as AlertEnvelope;
  return { status: res.status, body };
}

describe("Task #247 — GET /api/admin/email/failure-alerts route contract", () => {
  let admin: Ctx;
  // Per-run unique time window placed far enough in the future to not
  // overlap with any other suite's alert rows.
  const RUN_OFFSET_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years
  const baseTs = Date.now() + RUN_OFFSET_MS + Math.floor(Math.random() * 1_000_000);
  const fromMs = baseTs - 1_000;
  const toMs = baseTs + 60_000;
  const SEEDED_COUNT = 5;
  const FOREIGN_ORG_ID = `task247-foreign-${baseTs}`;

  beforeAll(async () => {
    admin = await loginAs("admin.test@cwpro.dev", "admin123");

    const rows = [];
    for (let i = 0; i < SEEDED_COUNT; i++) {
      rows.push({
        ts: new Date(baseTs + i * 1_000),
        failureCount: 12 + i,
        threshold: 10,
        thresholdBreached: true,
        topTransport: "graph",
        topErrorCode: "SEND_FAILED_500",
        delivered: true,
        byOrg: {
          [admin.orgId]: {
            failureCount: 12 + i,
            topTransport: "graph",
            topErrorCode: "SEND_FAILED_500",
          },
        },
      });
    }
    // One alert in the same window that does NOT include the admin's org
    // — must be invisible to a tenant ADMIN view.
    rows.push({
      ts: new Date(baseTs + 30_000),
      failureCount: 7,
      threshold: 10,
      thresholdBreached: false,
      topTransport: "smtp",
      topErrorCode: "TIMEOUT",
      delivered: false,
      byOrg: {
        [FOREIGN_ORG_ID]: {
          failureCount: 7,
          topTransport: "smtp",
          topErrorCode: "TIMEOUT",
        },
      },
    });
    await db.insert(emailFailureAlerts).values(rows);
  }, 30000);

  afterAll(async () => {
    await db
      .delete(emailFailureAlerts)
      .where(
        and(
          gte(emailFailureAlerts.ts, new Date(fromMs)),
          lte(emailFailureAlerts.ts, new Date(toMs)),
        ),
      );
  }, 30000);

  it("requires admin auth (unauthenticated → 401)", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/email/failure-alerts`);
    expect([401, 403]).toContain(res.status);
  });

  it("returns the documented envelope shape and round-trips query params", async () => {
    const r = await getAlerts(admin, {
      from: fromMs,
      to: toMs,
      limit: 3,
      offset: 0,
    });
    expect(r.status).toBe(200);
    const b = r.body;

    // Envelope keys the admin UI's pagination control depends on.
    expect(b).toHaveProperty("alerts");
    expect(b).toHaveProperty("total");
    expect(b).toHaveProperty("limit");
    expect(b).toHaveProperty("offset");
    expect(b).toHaveProperty("from");
    expect(b).toHaveProperty("to");
    expect(b).toHaveProperty("retentionDays");
    expect(b).toHaveProperty("orgScope");
    expect(b).toHaveProperty("thresholdPerHour");

    // Query-param round-trip.
    expect(b.from).toBe(fromMs);
    expect(b.to).toBe(toMs);
    expect(b.limit).toBe(3);
    expect(b.offset).toBe(0);

    // Org scoping is applied for tenant admins (not platform operators).
    expect(b.isPlatformOperator).toBe(false);
    expect(b.orgScope).toBe(admin.orgId);

    // Static envelope values. Task #283 — `retentionDays` replaces the
    // old fixed `maxHistory` row cap so the truncation warning can
    // reflect the actual operational bound (age-based retention).
    expect(typeof b.retentionDays).toBe("number");
    expect(b.retentionDays).toBeGreaterThan(0);
    expect(typeof b.thresholdPerHour).toBe("number");
    expect(b.thresholdPerHour).toBeGreaterThan(0);

    // Org-scoped projection: foreign-org alert is filtered out, so we
    // see only the SEEDED_COUNT rows, capped to limit=3.
    expect(b.total).toBe(SEEDED_COUNT);
    expect(b.alerts.length).toBe(3);
    for (const a of b.alerts) {
      expect(a.topTransport).toBe("graph");
      expect(a.topErrorCode).toBe("SEND_FAILED_500");
      expect(a.thresholdBreached).toBe(true);
      expect(a.ts).toBeGreaterThanOrEqual(fromMs);
      expect(a.ts).toBeLessThanOrEqual(toMs);
    }
    // orderBy(desc(ts)) — most recent first.
    for (let i = 1; i < b.alerts.length; i++) {
      expect(b.alerts[i - 1].ts).toBeGreaterThanOrEqual(b.alerts[i].ts);
    }
  });

  it("paginates: total stays stable across pages and offset selects later rows", async () => {
    const p1 = await getAlerts(admin, { from: fromMs, to: toMs, limit: 2, offset: 0 });
    const p2 = await getAlerts(admin, { from: fromMs, to: toMs, limit: 2, offset: 2 });
    const p3 = await getAlerts(admin, { from: fromMs, to: toMs, limit: 2, offset: 4 });

    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(p3.status).toBe(200);

    expect(p1.body.total).toBe(SEEDED_COUNT);
    expect(p2.body.total).toBe(SEEDED_COUNT);
    expect(p3.body.total).toBe(SEEDED_COUNT);

    expect(p1.body.offset).toBe(0);
    expect(p2.body.offset).toBe(2);
    expect(p3.body.offset).toBe(4);

    expect(p1.body.alerts.length).toBe(2);
    expect(p2.body.alerts.length).toBe(2);
    expect(p3.body.alerts.length).toBe(1);

    const seen = new Set([...p1.body.alerts, ...p2.body.alerts, ...p3.body.alerts].map((a) => a.ts));
    expect(seen.size).toBe(SEEDED_COUNT);
  });

  it("applies org scoping: foreign-org alerts in the same window are not returned", async () => {
    // Wide window that includes the foreign-org row too.
    const r = await getAlerts(admin, { from: fromMs, to: toMs, limit: 50 });
    expect(r.status).toBe(200);
    // Only the SEEDED_COUNT rows that contributed an admin-org slice.
    expect(r.body.total).toBe(SEEDED_COUNT);
    // Foreign-org slice never leaks: every row reflects the admin slice.
    for (const a of r.body.alerts) {
      expect(a.topTransport).toBe("graph");
      expect(a.topErrorCode).toBe("SEND_FAILED_500");
    }
    // orgNames is empty for tenant admins (only populated for operators).
    expect(r.body.orgNames).toEqual({});
  });

  it("treats absent from/to as null (not an empty range) and clamps bad limit/offset", async () => {
    // Negative offset → clamped to 0; missing limit → defaults to 5.
    const r = await getAlerts(admin, { from: fromMs, to: toMs, offset: -10 });
    expect(r.status).toBe(200);
    expect(r.body.offset).toBe(0);
    expect(r.body.limit).toBe(5);
    expect(r.body.total).toBe(SEEDED_COUNT);
    expect(r.body.alerts.length).toBe(SEEDED_COUNT);

    // No date params → from/to surface as null in the envelope.
    const r2 = await getAlerts(admin, { limit: 1 });
    expect(r2.status).toBe(200);
    expect(r2.body.from).toBeNull();
    expect(r2.body.to).toBeNull();
    // Page size honored even when total is much larger.
    expect(r2.body.alerts.length).toBeLessThanOrEqual(1);
  });
});
