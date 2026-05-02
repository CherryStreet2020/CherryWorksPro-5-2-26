/**
 * Task #249 — Cross-org failure-alert breakdown route gating.
 *
 * Exercises `GET /api/admin/email/failure-alerts` end-to-end with two
 * orgs' failures persisted in the durable `email_failure_alerts`
 * table, then asserts:
 *
 *  1. A tenant ADMIN of org-A sees only their own org's slice
 *     (per-alert counts projected to org-A's contribution) with no
 *     `byOrg` payload and no `orgNames` map. They must never observe
 *     org-B's existence — that would leak cross-tenant operational
 *     metadata.
 *  2. A platform operator (allow-listed via PLATFORM_OPERATOR_EMAILS)
 *     sees the cross-tenant view: full `byOrg` breakdown for both
 *     orgs plus a resolved `orgNames` map keyed by org id.
 *
 * Lives next to `failure-tracker.test.ts` since the gating is the
 * route-facing contract for the failure-tracker's per-org breakdown.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";

const ADMIN_USER_ID = "user-admin-task249";
const OPERATOR_USER_ID = "user-operator-task249";
const OPERATOR_EMAIL = "operator-task249@example.com";
const ADMIN_EMAIL = "admin-task249@example.com";

let currentUserId: string = ADMIN_USER_ID;

const userRecords: Record<string, { id: string; email: string; isActive: boolean; role: string }> = {
  [ADMIN_USER_ID]: {
    id: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    isActive: true,
    role: "ADMIN",
  },
  [OPERATOR_USER_ID]: {
    id: OPERATOR_USER_ID,
    email: OPERATOR_EMAIL,
    isActive: true,
    role: "ADMIN",
  },
};

vi.mock("../storage", async () => {
  const actual = await vi.importActual<typeof import("../storage")>("../storage");
  return {
    ...actual,
    storage: {
      ...actual.storage,
      getUserById: vi.fn(async (id: string) => userRecords[id]),
    },
  };
});

import { db } from "../db";
import { emailFailureAlerts, orgs, type EmailFailureAlertOrgSlice } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerEmailDeliverabilityRoutes } from "../routes/email-deliverability-routes";
import { resetFailureTrackerForTests, FAILURE_ALERT_THRESHOLD_PER_HOUR } from "./failure-tracker";

const ORG_A_ID = randomUUID();
const ORG_B_ID = randomUUID();
const ORG_A_NAME = `Task249 Org A ${ORG_A_ID.slice(0, 8)}`;
const ORG_B_NAME = `Task249 Org B ${ORG_B_ID.slice(0, 8)}`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: currentUserId,
      orgId: ORG_A_ID,
    };
    next();
  });
  registerEmailDeliverabilityRoutes(app);
  return app;
}

async function request(app: Express, path: string): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        const body = await res.json();
        server.close(() => resolve({ status: res.status, body }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

const ORIGINAL_OPERATOR_EMAILS = process.env.PLATFORM_OPERATOR_EMAILS;

beforeAll(async () => {
  await db.insert(orgs).values([
    { id: ORG_A_ID, name: ORG_A_NAME, slug: `task249-a-${ORG_A_ID.slice(0, 8)}` },
    { id: ORG_B_ID, name: ORG_B_NAME, slug: `task249-b-${ORG_B_ID.slice(0, 8)}` },
  ]);
});

afterAll(async () => {
  await db.delete(emailFailureAlerts);
  await db.delete(orgs).where(inArray(orgs.id, [ORG_A_ID, ORG_B_ID]));
  if (ORIGINAL_OPERATOR_EMAILS === undefined) {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
  } else {
    process.env.PLATFORM_OPERATOR_EMAILS = ORIGINAL_OPERATOR_EMAILS;
  }
});

beforeEach(async () => {
  await resetFailureTrackerForTests();
  // Seed a single threshold-breach alert with both orgs contributing.
  // org-A: 8 graph SEND_FAILED_500. org-B: 4 gmail TIMEOUT.
  const byOrg: Record<string, EmailFailureAlertOrgSlice> = {
    [ORG_A_ID]: {
      failureCount: 8,
      topTransport: "graph",
      topErrorCode: "SEND_FAILED_500",
    },
    [ORG_B_ID]: {
      failureCount: 4,
      topTransport: "gmail",
      topErrorCode: "TIMEOUT",
    },
  };
  await db.insert(emailFailureAlerts).values({
    ts: new Date(),
    failureCount: 12,
    threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
    thresholdBreached: true,
    topTransport: "graph",
    topErrorCode: "SEND_FAILED_500",
    delivered: true,
    byOrg,
  });
});

describe("GET /api/admin/email/failure-alerts cross-org gating", () => {
  it("returns only the requesting tenant ADMIN's org slice — no byOrg, no orgNames", async () => {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
    currentUserId = ADMIN_USER_ID;
    const app = buildApp();

    const { status, body } = await request(app, "/api/admin/email/failure-alerts");
    expect(status).toBe(200);

    expect(body.isPlatformOperator).toBe(false);
    expect(body.orgScope).toBe(ORG_A_ID);
    expect(body.orgNames).toEqual({});
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.alerts).toHaveLength(1);

    const [alert] = body.alerts;
    // Per-tenant projection: counts come from the org-A slice.
    expect(alert.failureCount).toBe(8);
    expect(alert.topTransport).toBe("graph");
    expect(alert.topErrorCode).toBe("SEND_FAILED_500");
    // org-A's contribution (8) is below the global threshold (10),
    // so the per-tenant view must reflect that.
    expect(alert.thresholdBreached).toBe(false);
    // Critical: tenant admins must never receive cross-org metadata.
    expect(alert.byOrg).toBeUndefined();
    // And no other org id should leak via the response shape at all.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ORG_B_ID);
    expect(serialized).not.toContain(ORG_B_NAME);
  });

  it("returns full byOrg breakdown plus resolved orgNames for a platform operator", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
    currentUserId = OPERATOR_USER_ID;
    const app = buildApp();

    const { status, body } = await request(app, "/api/admin/email/failure-alerts");
    expect(status).toBe(200);

    expect(body.isPlatformOperator).toBe(true);
    // Cross-tenant view: no per-tenant projection, so orgScope is null.
    expect(body.orgScope).toBeNull();
    expect(body.alerts).toHaveLength(1);

    const [alert] = body.alerts;
    // Aggregate fields, not a single-org projection.
    expect(alert.failureCount).toBe(12);
    expect(alert.thresholdBreached).toBe(true);
    expect(alert.topTransport).toBe("graph");

    // Per-org breakdown is exposed in full.
    expect(alert.byOrg).toBeDefined();
    expect(Object.keys(alert.byOrg).sort()).toEqual([ORG_A_ID, ORG_B_ID].sort());
    expect(alert.byOrg[ORG_A_ID]).toEqual({
      failureCount: 8,
      topTransport: "graph",
      topErrorCode: "SEND_FAILED_500",
    });
    expect(alert.byOrg[ORG_B_ID]).toEqual({
      failureCount: 4,
      topTransport: "gmail",
      topErrorCode: "TIMEOUT",
    });

    // Org names are resolved from the orgs table for the operator UI.
    expect(body.orgNames).toEqual({
      [ORG_A_ID]: ORG_A_NAME,
      [ORG_B_ID]: ORG_B_NAME,
    });
  });
});
