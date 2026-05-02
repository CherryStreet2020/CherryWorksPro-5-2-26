/**
 * Task #216 — Integration test for the marketing-os telemetry daily trend.
 *
 * The new `/api/telemetry/marketing-os/daily` endpoint backs the per-stage
 * sparklines on the admin dashboard widget but had no automated coverage.
 * This test seeds rows at known UTC days for the admin's org, hits the
 * endpoint, and pins the bucketing contract:
 *   - the response contains exactly `days` buckets (zero-filled),
 *   - bucket `date` strings are sequential ISO YYYY-MM-DD up to today (UTC),
 *   - rows land in the correct day bucket per event type,
 *   - days that we did not seed remain at zero.
 *
 * The endpoint scopes by `req.session.orgId`, so we log in as the seeded
 * admin user and seed events into that same org with backdated `createdAt`
 * timestamps. To keep counts deterministic we wipe the org's telemetry
 * rows in beforeAll/afterAll — no other test suite seeds backdated rows
 * into the shared admin org.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

import { TEST_BASE as BASE_URL } from "../helpers/base";
import { db } from "../../server/db";
import {
  marketingOsTelemetryEvents,
  type MarketingOsTelemetryDailySeries,
  type MarketingOsTelemetryEventType,
} from "@shared/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Ctx {
  cookies: string;
  csrfToken: string;
  orgId: string;
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
  const body = await loginRes.json();
  const allCookies = [
    ...csrfCookies.map((c) => c.split(";")[0]),
    ...loginRes.headers.getSetCookie().map((c) => c.split(";")[0]),
  ].join("; ");
  return {
    cookies: allCookies,
    csrfToken: loginRes.headers.get("x-csrf-token") || csrfToken,
    orgId:
      body.user?.organizationId ||
      body.organizationId ||
      body.user?.orgId ||
      body.orgId,
  };
}

function utcMidnightDaysAgo(daysAgo: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // noon UTC: well clear of day boundaries
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function insertEvent(
  orgId: string,
  eventType: MarketingOsTelemetryEventType,
  createdAt: Date,
): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingOsTelemetryEvents).values({
    id,
    orgId,
    userId: null,
    eventType,
    source: null,
    createdAt,
  });
  return id;
}

describe("/api/telemetry/marketing-os/daily — integration (Task #216)", () => {
  let admin: Ctx;
  const seededIds: string[] = [];

  beforeAll(async () => {
    admin = await loginAs("admin.test@cwpro.dev", "admin123");
    expect(admin.orgId).toBeTruthy();

    // Wipe any pre-existing rows for this org so the per-bucket counts are
    // deterministic — other integration tests in the same run may have left
    // telemetry behind for the shared admin org.
    await db
      .delete(marketingOsTelemetryEvents)
      .where(eq(marketingOsTelemetryEvents.orgId, admin.orgId));

    // Day -25: 2 section_shown
    seededIds.push(
      await insertEvent(admin.orgId, "section_shown", utcMidnightDaysAgo(25)),
      await insertEvent(admin.orgId, "section_shown", utcMidnightDaysAgo(25)),
    );
    // Day -10: 3 modal_opened, 1 checkout_clicked
    seededIds.push(
      await insertEvent(admin.orgId, "modal_opened", utcMidnightDaysAgo(10)),
      await insertEvent(admin.orgId, "modal_opened", utcMidnightDaysAgo(10)),
      await insertEvent(admin.orgId, "modal_opened", utcMidnightDaysAgo(10)),
      await insertEvent(
        admin.orgId,
        "checkout_clicked",
        utcMidnightDaysAgo(10),
      ),
    );
    // Day -1: 1 section_shown, 1 checkout_clicked
    seededIds.push(
      await insertEvent(admin.orgId, "section_shown", utcMidnightDaysAgo(1)),
      await insertEvent(
        admin.orgId,
        "checkout_clicked",
        utcMidnightDaysAgo(1),
      ),
    );
    // Day -45: outside the 30-day window — must NOT show up.
    seededIds.push(
      await insertEvent(admin.orgId, "section_shown", utcMidnightDaysAgo(45)),
    );
  });

  afterAll(async () => {
    await db
      .delete(marketingOsTelemetryEvents)
      .where(eq(marketingOsTelemetryEvents.orgId, admin.orgId));
  });

  it("returns 30 zero-filled, sequentially-dated buckets and lands counts in the right day", async () => {
    const res = await fetch(`${BASE_URL}/api/telemetry/marketing-os/daily`, {
      headers: { Cookie: admin.cookies },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MarketingOsTelemetryDailySeries;

    // Contract: default window is 30 days, exactly 30 buckets, no gaps.
    expect(body.days).toBe(30);
    expect(body.buckets).toHaveLength(30);

    // Buckets must be sequential UTC days, last one == today (UTC), and the
    // earliest one must be (days-1) days before today.
    const todayKey = utcDateKey(utcMidnightDaysAgo(0));
    const earliestKey = utcDateKey(utcMidnightDaysAgo(29));
    expect(body.buckets[body.buckets.length - 1].date).toBe(todayKey);
    expect(body.buckets[0].date).toBe(earliestKey);
    for (let i = 1; i < body.buckets.length; i++) {
      const prev = new Date(body.buckets[i - 1].date + "T00:00:00Z");
      const curr = new Date(body.buckets[i].date + "T00:00:00Z");
      expect(curr.getTime() - prev.getTime()).toBe(DAY_MS);
    }

    const byDate = new Map(body.buckets.map((b) => [b.date, b]));

    // Day -25: 2 section_shown only.
    const day25 = byDate.get(utcDateKey(utcMidnightDaysAgo(25)))!;
    expect(day25).toBeDefined();
    expect(day25.sectionShown).toBe(2);
    expect(day25.modalOpened).toBe(0);
    expect(day25.checkoutClicked).toBe(0);

    // Day -10: 3 modal_opened + 1 checkout_clicked.
    const day10 = byDate.get(utcDateKey(utcMidnightDaysAgo(10)))!;
    expect(day10).toBeDefined();
    expect(day10.sectionShown).toBe(0);
    expect(day10.modalOpened).toBe(3);
    expect(day10.checkoutClicked).toBe(1);

    // Day -1: 1 section_shown + 1 checkout_clicked.
    const day1 = byDate.get(utcDateKey(utcMidnightDaysAgo(1)))!;
    expect(day1).toBeDefined();
    expect(day1.sectionShown).toBe(1);
    expect(day1.modalOpened).toBe(0);
    expect(day1.checkoutClicked).toBe(1);

    // Untouched days within the window must remain zero-filled (spot-check
    // a couple that we definitely did not seed).
    const day20 = byDate.get(utcDateKey(utcMidnightDaysAgo(20)))!;
    expect(day20).toBeDefined();
    expect(day20.sectionShown).toBe(0);
    expect(day20.modalOpened).toBe(0);
    expect(day20.checkoutClicked).toBe(0);

    const day5 = byDate.get(utcDateKey(utcMidnightDaysAgo(5)))!;
    expect(day5).toBeDefined();
    expect(day5.sectionShown).toBe(0);
    expect(day5.modalOpened).toBe(0);
    expect(day5.checkoutClicked).toBe(0);

    // Day -45 must NOT appear in any of the 30 buckets.
    expect(byDate.has(utcDateKey(utcMidnightDaysAgo(45)))).toBe(false);
  });

  it("respects the ?days= query parameter and clamps the window", async () => {
    const res = await fetch(
      `${BASE_URL}/api/telemetry/marketing-os/daily?days=7`,
      { headers: { Cookie: admin.cookies } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MarketingOsTelemetryDailySeries;
    expect(body.days).toBe(7);
    expect(body.buckets).toHaveLength(7);
    // Day -10 falls outside a 7-day window, so its bucket must be absent.
    const byDate = new Map(body.buckets.map((b) => [b.date, b]));
    expect(byDate.has(utcDateKey(utcMidnightDaysAgo(10)))).toBe(false);
    // Day -1 is inside the window with the seeded counts.
    const day1 = byDate.get(utcDateKey(utcMidnightDaysAgo(1)))!;
    expect(day1).toBeDefined();
    expect(day1.sectionShown).toBe(1);
    expect(day1.checkoutClicked).toBe(1);
  });
});
