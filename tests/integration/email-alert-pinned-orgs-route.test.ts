/**
 * Task #316 — Route-level test for the pinned-orgs admin endpoints
 * (`GET/POST/DELETE /api/admin/email/alert-pinned-orgs`) added in
 * Task #280.
 *
 * The failure-tracker behaviour (pinned orgs surviving the top-5 cut
 * in the cross-tenant alert breakdown) is already covered by
 * `server/email/failure-tracker.test.ts`. This test focuses on the
 * HTTP boundary instead:
 *
 *   1. Tenant ADMINs get 404 on every verb — `requirePlatformOperator`
 *      hides the route's existence rather than returning 403.
 *   2. A platform operator can list (empty), pin, list (sees the new
 *      entry), and unpin an org through the public API surface.
 *   3. POST against an unknown orgId returns 404 instead of silently
 *      creating a row that would never match any alert window.
 *   4. Successful add and remove writes a corresponding `audit_logs`
 *      row (`EMAIL_ALERT_ORG_PINNED` / `EMAIL_ALERT_ORG_UNPINNED`)
 *      so the pinning action is durably attributable.
 *
 * Mirrors the in-process Express + real DB pattern used by
 * `server/email/failure-alerts-route.test.ts` so we can exercise the
 * real `requirePlatformOperator` middleware and the real audit-log
 * insert without booting the full app.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";

const ADMIN_USER_ID = "user-admin-task316";
const OPERATOR_USER_ID = "user-operator-task316";
const ADMIN_EMAIL = "admin-task316@example.com";
const OPERATOR_EMAIL = "operator-task316@example.com";

let currentUserId: string = ADMIN_USER_ID;

const userRecords: Record<string, { id: string; email: string; isActive: boolean; role: string }> = {
  [ADMIN_USER_ID]: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, isActive: true, role: "ADMIN" },
  [OPERATOR_USER_ID]: { id: OPERATOR_USER_ID, email: OPERATOR_EMAIL, isActive: true, role: "ADMIN" },
};

vi.mock("../../server/storage", async () => {
  const actual = await vi.importActual<typeof import("../../server/storage")>("../../server/storage");
  return {
    ...actual,
    storage: {
      ...actual.storage,
      getUserById: vi.fn(async (id: string) => userRecords[id]),
    },
  };
});

import { db, pool } from "../../server/db";
import { orgs, emailAlertPinnedOrgs, auditLogs } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { registerEmailDeliverabilityRoutes } from "../../server/routes/email-deliverability-routes";

const PINNED_ORG_ID = randomUUID();
const PINNED_ORG_NAME = `Task316 Pinned Org ${PINNED_ORG_ID.slice(0, 8)}`;
const SESSION_ORG_ID = randomUUID();
const SESSION_ORG_NAME = `Task316 Session Org ${SESSION_ORG_ID.slice(0, 8)}`;
const UNKNOWN_ORG_ID = `task316-missing-${randomUUID()}`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: currentUserId,
      // Audit-log writes are scoped to the acting user's session org.
      // Use a real, FK-valid org id so the insert succeeds.
      orgId: SESSION_ORG_ID,
    };
    next();
  });
  registerEmailDeliverabilityRoutes(app);
  return app;
}

async function request(
  app: Express,
  init: { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${init.path}`, {
          method: init.method,
          headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
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
    { id: PINNED_ORG_ID, name: PINNED_ORG_NAME, slug: `task316-pinned-${PINNED_ORG_ID.slice(0, 8)}` },
    { id: SESSION_ORG_ID, name: SESSION_ORG_NAME, slug: `task316-session-${SESSION_ORG_ID.slice(0, 8)}` },
  ]);
});

afterAll(async () => {
  // Drop any pinned-orgs rows we created (operator-scoped global table,
  // so be conservative and only delete the one we know we touched).
  await db.delete(emailAlertPinnedOrgs).where(eq(emailAlertPinnedOrgs.orgId, PINNED_ORG_ID));
  // Note: `audit_logs` rows are append-only at the DB layer (a trigger
  // rejects UPDATE/DELETE), so we cannot tear them down. Each test run
  // uses freshly-generated UUIDs for org/entity ids, so leftover rows
  // remain addressable by their unique entity_id and never collide
  // with future runs.
  // Orgs cannot be deleted either: the append-only `audit_logs.org_id`
  // FK pins both `SESSION_ORG_ID` (acting org on every audit row) and
  // `PINNED_ORG_ID` (entity_id is text, but the operator's session org
  // reference is durable). Each run picks fresh UUIDs so leftovers do
  // not collide with future runs or with the seeded fixture orgs.
  if (ORIGINAL_OPERATOR_EMAILS === undefined) {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
  } else {
    process.env.PLATFORM_OPERATOR_EMAILS = ORIGINAL_OPERATOR_EMAILS;
  }
});

beforeEach(async () => {
  // Each test starts from a clean slate for THIS org's pinned row.
  // Other tenants' pinned rows are left alone. Audit-log rows are
  // append-only (see afterAll comment) — the suite's three tests are
  // ordered such that no test reads audit rows another test wrote.
  await db.delete(emailAlertPinnedOrgs).where(eq(emailAlertPinnedOrgs.orgId, PINNED_ORG_ID));
});

describe("Task #316 — /api/admin/email/alert-pinned-orgs route gating + audit", () => {
  it("404s every verb for a tenant ADMIN whose email is not in the operator allow-list", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
    currentUserId = ADMIN_USER_ID;
    const app = buildApp();

    const get = await request(app, { method: "GET", path: "/api/admin/email/alert-pinned-orgs" });
    expect(get.status).toBe(404);

    const post = await request(app, {
      method: "POST",
      path: "/api/admin/email/alert-pinned-orgs",
      body: { orgId: PINNED_ORG_ID },
    });
    expect(post.status).toBe(404);

    const del = await request(app, {
      method: "DELETE",
      path: `/api/admin/email/alert-pinned-orgs/${PINNED_ORG_ID}`,
    });
    expect(del.status).toBe(404);

    // Gating must short-circuit before any side-effects: nothing
    // pinned, nothing logged.
    const pinned = await db
      .select()
      .from(emailAlertPinnedOrgs)
      .where(eq(emailAlertPinnedOrgs.orgId, PINNED_ORG_ID));
    expect(pinned).toHaveLength(0);
    const audits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "email_alert_pinned_org"),
          eq(auditLogs.entityId, PINNED_ORG_ID),
        ),
      );
    expect(audits).toHaveLength(0);
  });

  it("operator can list (empty), pin, list (sees entry), and unpin — with audit-log entries", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
    currentUserId = OPERATOR_USER_ID;
    const app = buildApp();

    // List before pinning: PINNED_ORG_ID must not appear yet.
    const listBefore = await request(app, { method: "GET", path: "/api/admin/email/alert-pinned-orgs" });
    expect(listBefore.status).toBe(200);
    expect(Array.isArray(listBefore.body.entries)).toBe(true);
    expect(listBefore.body.entries.find((e: any) => e.orgId === PINNED_ORG_ID)).toBeUndefined();
    expect(listBefore.body.orgNames[PINNED_ORG_ID]).toBeUndefined();

    // Pin the org.
    const post = await request(app, {
      method: "POST",
      path: "/api/admin/email/alert-pinned-orgs",
      body: { orgId: PINNED_ORG_ID, note: "VIP customer" },
    });
    expect(post.status).toBe(201);
    expect(post.body.success).toBe(true);
    expect(post.body.entry.orgId).toBe(PINNED_ORG_ID);
    expect(post.body.entry.note).toBe("VIP customer");

    // List after pinning surfaces the new entry plus its resolved name.
    const listAfter = await request(app, { method: "GET", path: "/api/admin/email/alert-pinned-orgs" });
    expect(listAfter.status).toBe(200);
    const entry = listAfter.body.entries.find((e: any) => e.orgId === PINNED_ORG_ID);
    expect(entry).toBeDefined();
    expect(entry.note).toBe("VIP customer");
    expect(listAfter.body.orgNames[PINNED_ORG_ID]).toBe(PINNED_ORG_NAME);

    // Audit log captured the pin action.
    const pinAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "email_alert_pinned_org"),
          eq(auditLogs.entityId, PINNED_ORG_ID),
          eq(auditLogs.action, "EMAIL_ALERT_ORG_PINNED"),
        ),
      );
    expect(pinAudits).toHaveLength(1);
    expect(pinAudits[0].userId).toBe(OPERATOR_USER_ID);
    expect(pinAudits[0].orgId).toBe(SESSION_ORG_ID);
    const pinDetails = pinAudits[0].details as { orgName?: string; note?: string | null };
    expect(pinDetails.orgName).toBe(PINNED_ORG_NAME);
    expect(pinDetails.note).toBe("VIP customer");

    // Unpin and verify the row + audit entry.
    const del = await request(app, {
      method: "DELETE",
      path: `/api/admin/email/alert-pinned-orgs/${PINNED_ORG_ID}`,
    });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ success: true, removed: true, orgId: PINNED_ORG_ID });

    const stillPinned = await db
      .select()
      .from(emailAlertPinnedOrgs)
      .where(eq(emailAlertPinnedOrgs.orgId, PINNED_ORG_ID));
    expect(stillPinned).toHaveLength(0);

    const unpinAudits = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "email_alert_pinned_org"),
          eq(auditLogs.entityId, PINNED_ORG_ID),
          eq(auditLogs.action, "EMAIL_ALERT_ORG_UNPINNED"),
        ),
      );
    expect(unpinAudits).toHaveLength(1);
    expect(unpinAudits[0].userId).toBe(OPERATOR_USER_ID);
    expect(unpinAudits[0].orgId).toBe(SESSION_ORG_ID);
  });

  it("POST returns 404 for an unknown orgId and writes nothing", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
    currentUserId = OPERATOR_USER_ID;
    const app = buildApp();

    const post = await request(app, {
      method: "POST",
      path: "/api/admin/email/alert-pinned-orgs",
      body: { orgId: UNKNOWN_ORG_ID },
    });
    expect(post.status).toBe(404);
    expect(post.body.message).toMatch(/not found/i);

    // No pinned row was created for the bogus id.
    const rows = await db
      .select()
      .from(emailAlertPinnedOrgs)
      .where(eq(emailAlertPinnedOrgs.orgId, UNKNOWN_ORG_ID));
    expect(rows).toHaveLength(0);

    // No audit-log row was written either — the route must short-circuit
    // before the insert when the org doesn't exist.
    const audits = await pool.query(
      `SELECT id FROM audit_logs WHERE entity_type = 'email_alert_pinned_org' AND entity_id = $1`,
      [UNKNOWN_ORG_ID],
    );
    expect(audits.rows).toHaveLength(0);
  });
});
