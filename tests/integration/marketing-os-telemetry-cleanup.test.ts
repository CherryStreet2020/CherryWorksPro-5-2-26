/**
 * Task #214 — Integration test for the marketing-os telemetry retention sweep.
 *
 * Task #203 added `cleanupOldMarketingOsTelemetryEvents` (a periodic delete of
 * rows older than the configured retention window) but only the env-var
 * parsing helper had unit coverage. This test exercises the actual delete:
 *  - Seeds a mix of old (>retention) and recent rows for an isolated org.
 *  - Runs the sweep with a custom retention window and asserts only the
 *    old rows are removed and the recent rows survive.
 *  - Also re-asserts the env-var contract end-to-end (override is honoured;
 *    invalid values fall back to the default) so the cutoff math and parsing
 *    stay wired together.
 */
process.env.MARKETING_OS_ENABLED = "true";

import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import {
  cleanupOldMarketingOsTelemetryEvents,
  resolveMarketingOsTelemetryRetentionDays,
} from "../../server/routes/marketing-os-telemetry-routes";
import {
  MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
  marketingOsTelemetryEvents,
  orgs,
} from "@shared/schema";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = randomUUID();
const ENV_KEY = "MARKETING_OS_TELEMETRY_RETENTION_DAYS";
const originalEnv = process.env[ENV_KEY];

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertEventAt(createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(marketingOsTelemetryEvents).values({
    id,
    orgId: ORG_ID,
    userId: null,
    eventType: "section_shown",
    source: null,
    createdAt,
  });
  return id;
}

async function rowsForOrg(): Promise<Array<{ id: string; createdAt: Date }>> {
  return db
    .select({
      id: marketingOsTelemetryEvents.id,
      createdAt: marketingOsTelemetryEvents.createdAt,
    })
    .from(marketingOsTelemetryEvents)
    .where(eq(marketingOsTelemetryEvents.orgId, ORG_ID));
}

beforeAll(async () => {
  await db.insert(orgs).values({
    id: ORG_ID,
    name: `t214 ${RUN}`,
    slug: `t214-${RUN}`,
  });
});

afterAll(async () => {
  await db
    .delete(marketingOsTelemetryEvents)
    .where(eq(marketingOsTelemetryEvents.orgId, ORG_ID));
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));

  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

afterEach(async () => {
  // Each test seeds its own rows and asserts on the surviving set. Wipe
  // between tests so they don't bleed into each other.
  await db
    .delete(marketingOsTelemetryEvents)
    .where(eq(marketingOsTelemetryEvents.orgId, ORG_ID));

  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

describe("cleanupOldMarketingOsTelemetryEvents — integration", () => {
  it("deletes rows older than the retention window and keeps recent ones", async () => {
    const retentionDays = 30;
    const now = Date.now();

    // 3 "old" rows clearly past the cutoff, 2 "recent" rows clearly inside it.
    const oldIds = await Promise.all([
      insertEventAt(new Date(now - (retentionDays + 1) * DAY_MS)),
      insertEventAt(new Date(now - (retentionDays + 10) * DAY_MS)),
      insertEventAt(new Date(now - 365 * DAY_MS)),
    ]);
    const recentIds = await Promise.all([
      insertEventAt(new Date(now - 1 * DAY_MS)),
      insertEventAt(new Date(now - (retentionDays - 1) * DAY_MS)),
    ]);

    const before = await rowsForOrg();
    expect(before).toHaveLength(5);

    const result = await cleanupOldMarketingOsTelemetryEvents(retentionDays);

    expect(result.retentionDays).toBe(retentionDays);
    // Cutoff is "now - retentionDays" computed inside the function. Allow a
    // small wall-clock skew window for the gap between the test's `now` and
    // the function's internal `Date.now()`.
    const expectedCutoff = now - retentionDays * DAY_MS;
    expect(Math.abs(result.cutoff.getTime() - expectedCutoff)).toBeLessThan(
      5_000,
    );

    // The sweep is global, so it may also have removed *other* orgs' aged
    // rows. Pin behaviour to our org to avoid flake.
    const survivingForOrg = await rowsForOrg();
    const survivingIds = survivingForOrg.map((r) => r.id).sort();
    expect(survivingIds).toEqual([...recentIds].sort());

    // And confirm none of the old rows we seeded survive.
    const stillOld = await db
      .select({ id: marketingOsTelemetryEvents.id })
      .from(marketingOsTelemetryEvents)
      .where(inArray(marketingOsTelemetryEvents.id, oldIds));
    expect(stillOld).toHaveLength(0);
  });

  it("respects MARKETING_OS_TELEMETRY_RETENTION_DAYS override end-to-end", async () => {
    process.env[ENV_KEY] = "7";

    const now = Date.now();
    const keepId = await insertEventAt(new Date(now - 6 * DAY_MS));
    const dropId = await insertEventAt(new Date(now - 8 * DAY_MS));

    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(7);

    const result = await cleanupOldMarketingOsTelemetryEvents();
    expect(result.retentionDays).toBe(7);

    const survivingIds = (await rowsForOrg()).map((r) => r.id);
    expect(survivingIds).toEqual([keepId]);
    expect(survivingIds).not.toContain(dropId);
  });

  it("ignores invalid override values and uses the documented default", async () => {
    process.env[ENV_KEY] = "not-a-number";

    const now = Date.now();
    // Inside the default 180-day window — must survive.
    const insideDefaultId = await insertEventAt(
      new Date(
        now - (MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT - 1) * DAY_MS,
      ),
    );
    // Past the default 180-day window — must be deleted.
    const pastDefaultId = await insertEventAt(
      new Date(
        now - (MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT + 5) * DAY_MS,
      ),
    );

    expect(resolveMarketingOsTelemetryRetentionDays()).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );

    const result = await cleanupOldMarketingOsTelemetryEvents();
    expect(result.retentionDays).toBe(
      MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT,
    );

    const surviving = await db
      .select({ id: marketingOsTelemetryEvents.id })
      .from(marketingOsTelemetryEvents)
      .where(
        and(
          eq(marketingOsTelemetryEvents.orgId, ORG_ID),
          inArray(marketingOsTelemetryEvents.id, [
            insideDefaultId,
            pastDefaultId,
          ]),
        ),
      );
    const survivingIds = surviving.map((r) => r.id);
    expect(survivingIds).toEqual([insideDefaultId]);
  });
});
