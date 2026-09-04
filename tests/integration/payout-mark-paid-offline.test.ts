/**
 * "Mark Paid" for offline payouts (Zelle / ACH / check).
 *
 * The invoice-send auto-payout is created PENDING. For a team that is not on
 * Stripe Connect, the only UI exits used to be "Send via Stripe" (400: not
 * onboarded) or Void — so every auto-payout was a dead end and the admin voided
 * it and re-entered a manual payment. PATCH /api/payouts/:id now accepts
 * `payoutDate` (the day the money actually moved) and enforces the rules that
 * make hand-completion safe:
 *   - a payout with a LIVE Stripe transfer cannot have its money fields edited
 *     (status, method, reference, date) — whatever the body carries;
 *   - a transfer Stripe reported FAILED releases the payout back to the offline path;
 *   - only a PENDING payout can be marked paid (no re-marking, no resurrecting VOID);
 *   - expense-reimbursement payouts are refused (they settle from the Expenses page);
 *   - the date must be a real calendar day, not in the future, not in a closed period;
 *   - the linked time entries stay attached, so they never show as unpaid again.
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
const CLIENT_ID = randomUUID();
const PROJECT_ID = randomUUID();

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
import { orgs, teamMemberPayoutsV2, auditLogs, EXPENSE_REIMBURSEMENT_NOTE_PREFIX } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { storage } from "../../server/storage";
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

type PayoutSeed = Partial<{ status: string; paymentMethod: string; stripeTransferId: string | null; stripeTransferStatus: string | null; notes: string }>;
async function insertPayout(o: PayoutSeed = {}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status, stripe_transfer_id, stripe_transfer_status, notes)
     VALUES ($1, $2, $3, '1987.50', '2026-07-07', $4, $5, $6, $7, $8)`,
    [id, ORG_ID, MEMBER_ID, o.paymentMethod ?? "TBD", o.status ?? "PENDING", o.stripeTransferId ?? null, o.stripeTransferStatus ?? null,
     o.notes ?? "Auto-created from Invoice CSC-INV-TEST (client)"],
  );
  return id;
}

const TODAY = new Date().toISOString().slice(0, 10);
const OK_BODY = { status: "COMPLETED", paymentMethod: "ZELLE", referenceNumber: "ZELLE-CONF-123", payoutDate: TODAY };

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Mark Paid Org", slug: `mp-${ORG_ID.slice(0, 8)}` });
  await pool.query(
    `INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active, payment_method)
     VALUES ($1, $2, $3, 'x', 'MP Member', 'TEAM_MEMBER', 'INDEPENDENT', true, 'ZELLE')`,
    [MEMBER_ID, ORG_ID, `mp-member-${MEMBER_ID.slice(0, 8)}@example.com`],
  );
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $2, 'MP Client')`, [CLIENT_ID, ORG_ID]);
  await pool.query(`INSERT INTO projects (id, org_id, client_id, name) VALUES ($1, $2, $3, 'MP Project')`, [PROJECT_ID, ORG_ID, CLIENT_ID]);
});

afterAll(async () => {
  // audit_logs is immutable by trigger (migration 0017) wherever the SQL
  // migrations have been replayed; the sanctioned escape hatch is a
  // transaction-local GUC, exactly as tests/helpers/po/isolation.ts does it.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.allow_audit_log_modification', 'on', true)`);
    await client.query(`DELETE FROM audit_logs WHERE org_id = $1`, [ORG_ID]);
    await client.query(`DELETE FROM payout_time_entries WHERE org_id = $1`, [ORG_ID]);
    await client.query(`DELETE FROM team_member_payouts_v2 WHERE org_id = $1`, [ORG_ID]);
    await client.query(`DELETE FROM time_entries WHERE org_id = $1`, [ORG_ID]);
    await client.query(`DELETE FROM projects WHERE org_id = $1`, [ORG_ID]);
    await client.query(`DELETE FROM clients WHERE org_id = $1`, [ORG_ID]);
    await client.query(`DELETE FROM users WHERE org_id = $1`, [ORG_ID]);
    await client.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

describe("PATCH /api/payouts/:id — mark an offline payout paid", () => {
  it("PENDING → COMPLETED with method, reference and the real payment date; audit-logged with the money fields", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const res = await request(app, "PATCH", `/api/payouts/${id}`, OK_BODY);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.paymentMethod).toBe("ZELLE");
    expect(res.body.referenceNumber).toBe("ZELLE-CONF-123");
    expect(String(res.body.payoutDate)).toMatch(new RegExp(`^${TODAY}`));

    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.orgId, ORG_ID), eq(auditLogs.entityId, id)));
    const marked = logs.find(l => l.action === "PAYOUT_MARKED_PAID");
    expect(marked).toBeTruthy();
    const d = marked!.details as any;
    expect(d.paymentMethod).toBe("ZELLE");
    expect(d.referenceNumber).toBe("ZELLE-CONF-123");
    expect(String(d.payoutDate)).toMatch(new RegExp(`^${TODAY}`));
    expect(d.before.status).toBe("PENDING");
    expect(String(d.before.payoutDate)).toMatch(/^2026-07-07/);
  });

  it("keeps the linked time entries attached — they do not reappear as unpaid", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const teId = randomUUID();
    await pool.query(
      `INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, billable, rate, cost_rate_snapshot)
       VALUES ($1, $2, $3, $4, '2026-07-01', 90, true, '150', '135')`,
      [teId, ORG_ID, PROJECT_ID, MEMBER_ID],
    );
    await storage.linkTimeEntriesToPayout(id, MEMBER_ID, [{ timeEntryId: teId, amount: "202.50" }], ORG_ID);
    const unpaidBefore = await storage.getUnpaidTimeEntriesForTeamMember(ORG_ID, MEMBER_ID);
    expect(unpaidBefore.some(e => e.id === teId)).toBe(false);

    const res = await request(app, "PATCH", `/api/payouts/${id}`, OK_BODY);
    expect(res.status).toBe(200);

    const unpaidAfter = await storage.getUnpaidTimeEntriesForTeamMember(ORG_ID, MEMBER_ID);
    expect(unpaidAfter.some(e => e.id === teId)).toBe(false);
    const links = await pool.query(`SELECT count(*)::int AS n FROM payout_time_entries WHERE payout_id = $1`, [id]);
    expect(links.rows[0].n).toBe(1);
  });

  it("refuses to edit ANY money field of a payout with a live Stripe transfer — even with no status in the body", async () => {
    const app = buildApp();
    const id = await insertPayout({ status: "COMPLETED", paymentMethod: "STRIPE_CONNECT", stripeTransferId: "tr_test_123", stripeTransferStatus: "paid" });
    for (const body of [
      { status: "COMPLETED", paymentMethod: "ZELLE", payoutDate: TODAY },
      { paymentMethod: "ZELLE", referenceNumber: "ZELLE-9" },
      { payoutDate: TODAY },
      { status: "PENDING" },
    ]) {
      const res = await request(app, "PATCH", `/api/payouts/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.message).toMatch(/Stripe Connect/);
    }
    const [row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, id));
    expect(row.paymentMethod).toBe("STRIPE_CONNECT");
    expect(row.status).toBe("COMPLETED");
    // notes alone is not a money field and stays editable
    const notesOnly = await request(app, "PATCH", `/api/payouts/${id}`, { notes: "reconciled" });
    expect(notesOnly.status).toBe(200);
  });

  it("releases a payout whose Stripe transfer FAILED back to the offline path", async () => {
    const app = buildApp();
    const id = await insertPayout({ status: "VOID", paymentMethod: "STRIPE_CONNECT", stripeTransferId: "tr_failed_1", stripeTransferStatus: "failed" });
    const res = await request(app, "PATCH", `/api/payouts/${id}`, OK_BODY);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.paymentMethod).toBe("ZELLE");
  });

  it("will not re-mark an already COMPLETED payout, nor resurrect a voided one", async () => {
    const app = buildApp();
    const done = await insertPayout({ status: "COMPLETED", paymentMethod: "ZELLE" });
    const r1 = await request(app, "PATCH", `/api/payouts/${done}`, OK_BODY);
    expect(r1.status).toBe(409);
    expect(r1.body.message).toMatch(/already marked paid/i);

    const voided = await insertPayout({ status: "VOID" });
    const r2 = await request(app, "PATCH", `/api/payouts/${voided}`, OK_BODY);
    expect(r2.status).toBe(409);
    const [row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, voided));
    expect(row.status).toBe("VOID");
  });

  it("refuses an expense-reimbursement payout and points at the Expenses page", async () => {
    const app = buildApp();
    const id = await insertPayout({ notes: `${EXPENSE_REIMBURSEMENT_NOTE_PREFIX}Hotel ($340.00)` });
    const res = await request(app, "PATCH", `/api/payouts/${id}`, OK_BODY);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expense reimbursement/i);
    const [row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, id));
    expect(row.status).toBe("PENDING");
  });

  it("rejects malformed, impossible and future dates with the friendly message", async () => {
    const app = buildApp();
    const id = await insertPayout();
    for (const [payoutDate, re] of [
      ["09/04/2026", /payout date/i],
      ["2026-02-30", /payout date/i],
      ["2026-13-01", /payout date/i],
      ["2099-01-01", /future/i],
    ] as const) {
      const res = await request(app, "PATCH", `/api/payouts/${id}`, { ...OK_BODY, payoutDate });
      expect(res.status, payoutDate).toBe(400);
      expect(res.body.message, payoutDate).toMatch(re);
    }
    const [row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, id));
    expect(row.status).toBe("PENDING");
  });

  it("rejects an empty update and a method outside the offline set", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const empty = await request(app, "PATCH", `/api/payouts/${id}`, {});
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/No updatable fields/);
    const venmo = await request(app, "PATCH", `/api/payouts/${id}`, { status: "COMPLETED", paymentMethod: "VENMO" });
    expect(venmo.status).toBe(400);
    expect(venmo.body.message).toMatch(/payment method/i);
    const missing = await request(app, "PATCH", `/api/payouts/${randomUUID()}`, OK_BODY);
    expect(missing.status).toBe(404);
  });

  it("void is unaffected and needs no date", async () => {
    const app = buildApp();
    const id = await insertPayout();
    const res = await request(app, "PATCH", `/api/payouts/${id}`, { status: "VOID" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("VOID");
  });
});
