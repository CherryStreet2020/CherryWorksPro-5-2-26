/**
 * The team-member earnings view must be TRUE FROM THE MEMBER'S SEAT and must not
 * leak the client's payment status.
 *
 * Before this change /api/dashboard/my bucketed hours by the CLIENT invoice's
 * status: hours on a client-PAID invoice were shown as "Paid" (with the client's
 * payment date) even when the member had not been paid a cent for them, and the
 * "awaiting" list exposed invoice due dates. Separately, /api/my/earnings'
 * "totalEarned" (value of tracked hours that were paid) was displayed as
 * "Total received" above a payout list that summed to a different number
 * whenever a payout had no linked hours (work paid before time tracking began).
 *
 * Scenario: one member, four billable entries
 *   A  invoiced, on a client-PAID invoice, linked to a COMPLETED payout  → paid
 *   B  invoiced, on a client-PAID invoice, NOT paid out                    → awaiting payout (the CSC-INV-0007 case)
 *   C  invoiced, client has NOT paid, not paid out                         → awaiting payout
 *   D  not invoiced                                                        → unbilled
 * plus one COMPLETED payout with NO linked hours (work before tracking).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const ORG_ID = randomUUID();
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
        if (id === MEMBER_ID) return { id: MEMBER_ID, orgId: ORG_ID, email: "pt-member@example.com", isActive: true, role: "TEAM_MEMBER", name: "PT Member", workerType: "INDEPENDENT" };
        return realGet(id);
      }),
    }),
  };
});

import { db, pool } from "../../server/db";
import { orgs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { registerDashboardRoutes } from "../../server/routes/dashboard-routes";
import { registerPayoutRoutes } from "../../server/routes/payout-routes";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: MEMBER_ID, orgId: ORG_ID, role: "TEAM_MEMBER" };
    next();
  });
  registerDashboardRoutes(app);
  registerPayoutRoutes(app);
  return app;
}

async function get(app: Express, path: string): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        const text = await res.text();
        server.close(() => resolve({ status: res.status, body: text ? JSON.parse(text) : null }));
      } catch (err) { server.close(() => reject(err)); }
    });
  });
}

const PAID_INVOICE = randomUUID();
const SENT_INVOICE = randomUUID();
const E = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID() };
const PAYOUT_TRACKED = randomUUID();
const PAYOUT_OUTSIDE = randomUUID();

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Payout Truth Org", slug: `pt-${ORG_ID.slice(0, 8)}` });
  await pool.query(`INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active, payment_method) VALUES ($1,$2,$3,'x','PT Member','TEAM_MEMBER','INDEPENDENT',true,'ZELLE')`, [MEMBER_ID, ORG_ID, `pt-${MEMBER_ID.slice(0, 8)}@example.com`]);
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1,$2,'PT Client')`, [CLIENT_ID, ORG_ID]);
  await pool.query(`INSERT INTO projects (id, org_id, client_id, name, status) VALUES ($1,$2,$3,'PT Project','ACTIVE')`, [PROJECT_ID, ORG_ID, CLIENT_ID]);
  await pool.query(`INSERT INTO project_members (id, org_id, project_id, user_id, hourly_rate, cost_rate_hourly) VALUES ($1,$2,$3,$4,'150','135')`, [randomUUID(), ORG_ID, PROJECT_ID, MEMBER_ID]);
  // Client-side invoices: one PAID, one SENT. The member view must not care.
  await pool.query(`INSERT INTO invoices (id, org_id, client_id, number, status, issued_date, due_date, subtotal, total, paid_amount) VALUES ($1,$2,$3,'PT-INV-PAID','PAID','2026-08-01','2026-08-15','600','600','600'), ($4,$2,$3,'PT-INV-SENT','SENT','2026-08-20','2026-09-03','300','300','0')`, [PAID_INVOICE, ORG_ID, CLIENT_ID, SENT_INVOICE]);
  // Entries: A 2h, B 2h (both on the PAID invoice), C 2h (SENT invoice), D 1h unbilled. Rate 135.
  for (const [id, invoiced] of [[E.A, true], [E.B, true], [E.C, true], [E.D, false]] as const) {
    await pool.query(`INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, billable, rate, cost_rate_snapshot, invoiced) VALUES ($1,$2,$3,$4,'2026-08-05',$5,true,'150','135',$6)`, [id, ORG_ID, PROJECT_ID, MEMBER_ID, id === E.D ? 60 : 120, invoiced]);
  }
  // Payout 1: COMPLETED, linked to A only (2h × 135 = 270), paid 2026-08-10.
  await pool.query(`INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status, reference_number) VALUES ($1,$2,$3,'270.00','2026-08-10','ZELLE','COMPLETED','Z-1')`, [PAYOUT_TRACKED, ORG_ID, MEMBER_ID]);
  await pool.query(`INSERT INTO payout_time_entries (id, org_id, payout_id, time_entry_id, amount) VALUES ($1,$2,$3,$4,'270.00')`, [randomUUID(), ORG_ID, PAYOUT_TRACKED, E.A]);
  // Payout 2: COMPLETED, no linked hours (work before time tracking), 500, paid 2026-03-06.
  await pool.query(`INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status, reference_number, notes) VALUES ($1,$2,$3,'500.00','2026-03-06','ZELLE','COMPLETED','Z-0','old system')`, [PAYOUT_OUTSIDE, ORG_ID, MEMBER_ID]);
});

afterAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT set_config('app.allow_audit_log_modification','on',true)`);
    for (const t of ["audit_logs", "payout_time_entries", "team_member_payouts_v2", "time_entries", "project_members", "invoices", "projects", "clients", "users"]) {
      await c.query(`DELETE FROM ${t} WHERE org_id = $1`, [ORG_ID]);
    }
    await c.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
});

describe("GET /api/dashboard/my — earnings from the member's seat", () => {
  it("buckets by payouts to the member, not by client invoice status", async () => {
    const res = await get(buildApp(), "/api/dashboard/my");
    expect(res.status).toBe(200);
    const e = res.body.earnings;
    // Paid = only what was actually paid out (A), dated by the payout.
    expect(e.paid.hours).toBe(2);
    expect(e.paid.amount).toBe(270);
    // B is on a client-PAID invoice but has NOT been paid to the member → awaiting, not paid.
    expect(e.awaitingPayout.hours).toBe(4); // B + C
    expect(e.awaitingPayout.amount).toBe(540);
    expect(e.unbilled.hours).toBe(1);
    expect(e.unbilled.amount).toBe(135);
    expect(e.totalOwed).toBe(675);
    // Money received = sum of completed payouts, incl. the one with no tracked hours.
    expect(e.paid.totalReceived).toBe(770);
    expect(e.paid.outsideTracking).toEqual({ count: 1, amount: 500 });
    const items = e.paid.items;
    expect(items.map((i: any) => i.payoutId).sort()).toEqual([PAYOUT_OUTSIDE, PAYOUT_TRACKED].sort());
    const tracked = items.find((i: any) => i.payoutId === PAYOUT_TRACKED);
    expect(tracked.trackedHere).toBe(true);
    expect(tracked.hours).toBe(2);
    expect(String(tracked.payoutDate)).toMatch(/^2026-08-10/);
    expect(items.find((i: any) => i.payoutId === PAYOUT_OUTSIDE).trackedHere).toBe(false);
  });

  it("never exposes the client's payment status or invoice dates", async () => {
    const res = await get(buildApp(), "/api/dashboard/my");
    const json = JSON.stringify(res.body.earnings);
    for (const leak of ["invoiceStatus", "invoiceDueDate", "invoicePaidDate", "nextPaymentDate", "billedAwaiting", "paidDate", "PT-INV-PAID", "PT-INV-SENT"]) {
      expect(json, leak).not.toContain(leak);
    }
  });
});

describe("GET /api/my/earnings — the badge equals the list", () => {
  it("totalReceived is the sum of the completed payouts it lists; tracked/outside split foots", async () => {
    const res = await get(buildApp(), "/api/my/earnings");
    expect(res.status).toBe(200);
    const b = res.body;
    const listSum = b.payoutHistory.reduce((s: number, p: any) => s + Number(p.amount), 0);
    expect(b.totalReceived).toBe(770);
    expect(listSum).toBe(770);
    expect(b.paidForTrackedHours).toBe(270);
    expect(b.paidOutsideTracking).toBe(500);
    expect(b.paidForTrackedHours + b.paidOutsideTracking).toBe(b.totalReceived);
    // Owed = everything not paid out (B + C + D)
    expect(b.pendingPayout).toBe(675);
    const outside = b.payoutHistory.find((p: any) => p.id === PAYOUT_OUTSIDE);
    expect(outside.trackedHere).toBe(false);
    expect(outside.linkedHours).toBe(0);
    const tracked = b.payoutHistory.find((p: any) => p.id === PAYOUT_TRACKED);
    expect(tracked.trackedHere).toBe(true);
    expect(tracked.linkedHours).toBe(2);
    // compatibility field keeps its old meaning
    expect(b.totalEarned).toBe(270);
  });
});
