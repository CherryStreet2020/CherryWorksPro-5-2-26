/**
 * "Mark paid" for offline payouts (Zelle / ACH / check).
 *
 * The invoice-send auto-payout is created PENDING. For a team that is not on
 * Stripe Connect, the only UI exits used to be "Send via Stripe" (400: not
 * onboarded) or Void — so every auto-payout was a dead end and the admin voided
 * it and re-entered a manual payment. PATCH /api/payouts/:id already accepted
 * status/paymentMethod/referenceNumber; this change adds `payoutDate` (the day
 * the money actually moved) and refuses to hand-complete a payout that Stripe
 * owns (has a stripeTransferId), which would otherwise double-record a payment.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const ORG_ID = randomUUID();
const ADMIN_ID = randomUUID();
const MEMBER_ID = randomUUID();

vi.mock("../../server/storage", async () => {
  const actual = await vi.importActual<typeof import("../../server/storage")>("../../server/storage");
  const realGet = actual.storage.getUserById.bind(actual.storage);
  return {
    ...actual,
    storage: Object.assign(Object.create(Object.getPrototypeOf(actual.storage)), actual.storage, {
      getUserById: vi.fn(async (id: string) => {
        if (id === ADMIN_ID) return { id: ADMIN_ID, orgId: ORG_ID, email: "mp-admin@example.com", isActive: true, role: "ADMIN", name: "MP Admin" };
        return realGet(id);
      }),
    }),
  };
});

import { db, pool } from "../../server/db";
import { orgs, teamMemberPayoutsV2, auditLogs } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { registerPayoutRoutes } from "../../server/routes/payout-routes";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: ADMIN_ID, orgId: ORG_ID };
    next();
  });
  registerPayoutRoutes(app);
  return app;
}

async function request(app: Express, method: "PATCH" | "GET", path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        server.close(() => resolve({ status: res.status, body: text ? JSON.parse(text) : null }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

async function insertPayout(overrides: Partial<{ status: string; paymentMethod: string; stripeTransferId: string | null }> = {}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status, stripe_transfer_id, notes)
     VALUES ($1, $2, $3, '1987.50', '2026-07-07', $4, $5, $6, 'Auto-created from Invoice CSC-INV-TEST (client)')`,
    [id, ORG_ID, MEMBER_ID, overrides.paymentMethod ?? "TBD", overrides.status ?? "PENDING", overrides.stripeTransferId ?? null],
  );
  return id;
}

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Mark Paid Org", slug: `mp-${ORG_ID.slice(0, 8)}` });
  await pool.query(
    `INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active, payment_method)
     VALUES ($1, $2, $3, 'x', 'MP Member', 'TEAM_MEMBER', 'INDEPENDENT', true, 'ZELLE')`,
    [MEMBER_ID, ORG_ID, `mp-member-${MEMBER_ID.slice(0, 8)}@example.com`],
  );
});

afterAll(async () => {
  await db.delete(auditLogs).where(eq(auditLogs.orgId, ORG_ID));
  await db.delete(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.orgId, ORG_ID));
  await pool.query(`DELETE FROM users WHERE org_id = $1`, [ORG_ID]);
  await db.delete(orgs).where(eq(orgs.id, ORG_ID));
});

describe("PATCH /api/payouts/:id — mark an offline payout paid", () => {
  it("PENDING → COMPLETED with method, reference and the real payment date; audit-logged", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const res = await request(app, "PATCH", `/api/payouts/${id}`, {
      status: "COMPLETED", paymentMethod: "ZELLE", referenceNumber: "ZELLE-CONF-123", payoutDate: "2026-09-04",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.paymentMethod).toBe("ZELLE");
    expect(res.body.referenceNumber).toBe("ZELLE-CONF-123");
    expect(String(res.body.payoutDate)).toMatch(/^2026-09-04/);

    const [row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, id));
    expect(row.status).toBe("COMPLETED");
    expect(String(row.payoutDate)).toMatch(/^2026-09-04/);

    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.orgId, ORG_ID), eq(auditLogs.entityId, id)));
    expect(logs.some(l => l.action === "PAYOUT_MARKED_PAID")).toBe(true);
  });

  it("rejects a malformed payout date", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const res = await request(app, "PATCH", `/api/payouts/${id}`, { status: "COMPLETED", paymentMethod: "ZELLE", payoutDate: "09/04/2026" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payout date/i);
    const [row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, id));
    expect(row.status).toBe("PENDING");
  });

  it("refuses to hand-complete a payout that Stripe Connect owns (has a transfer id)", async () => {
    const app = buildApp();
    const id = await insertPayout({ paymentMethod: "STRIPE_CONNECT", stripeTransferId: "tr_test_123" });
    const res = await request(app, "PATCH", `/api/payouts/${id}`, { status: "COMPLETED", paymentMethod: "ZELLE", payoutDate: "2026-09-04" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Stripe Connect/);
    const [row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, id));
    expect(row.status).toBe("PENDING");
    expect(row.paymentMethod).toBe("STRIPE_CONNECT");
  });

  it("still rejects a payment method outside the offline set", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const res = await request(app, "PATCH", `/api/payouts/${id}`, { status: "COMPLETED", paymentMethod: "VENMO" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payment method/i);
  });

  it("void is unaffected and needs no date", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const res = await request(app, "PATCH", `/api/payouts/${id}`, { status: "VOID" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VOID");
  });
});
