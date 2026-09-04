/**
 * A team member's earnings must be TRUE FROM THE MEMBER'S SEAT, must foot to the
 * admin's payout math to the cent, and must not leak the client's payment status.
 *
 * Both member endpoints (/api/dashboard/my, /api/my/earnings) read ONE storage
 * computation (getMemberEarningsSummary) built on the same rate + rounding chain as
 * the admin's Record Payment dialog (getUnpaidTimeEntriesForTeamMember) and the
 * admin Payouts page (getPayoutSummaryByTeamMember). This file pins:
 *   • paid == paid TO THE MEMBER (a COMPLETED payout), never "the client paid";
 *   • owed == the admin's unpaid time value — all entries, no billable filter,
 *     rate snapshot → project rate, round2(minutes/60 × rate) per line;
 *   • money received == the SUM OF THE PAYOUT AMOUNTS listed, split by fact
 *     (linked hours / no linked hours / expense reimbursement), never re-valued;
 *   • PENDING and VOID payouts are neither owed nor paid;
 *   • nothing about invoices leaks; one member never sees another's payouts.
 *
 * Member 1 (rate 135 snapshot unless noted):
 *   A 2h invoiced (client PAID)   → linked to COMPLETED payout P1 (270)   → PAID
 *   B 2h invoiced (client PAID)   → not paid out                          → AWAITING (the CSC-INV-0007 case)
 *   C 2h invoiced (client SENT)   → not paid out                          → AWAITING
 *   D 1h not invoiced                                                     → UNBILLED  135.00
 *   N 1h NON-billable, not invoiced → linked to COMPLETED payout P3 (135) → PAID (still tracked hours)
 *   F 50m not invoiced, NO snapshot, project rate 135                     → UNBILLED  112.50 (round2(50/60×135), not 0.83×135)
 *   G 1h invoiced → linked to PENDING payout P4 (135)                     → PENDING_PAYOUT (not owed, not paid)
 *   M 30m not invoiced, NO snapshot, project WITHOUT a rate               → UNBILLED  0.00 + costRateMissing
 *   Z 1h not invoiced, snapshot "0.00" (logged before any rate existed), project rate 135 → UNBILLED 135.00
 *   Z2 1h not invoiced, snapshot "0.00", project WITHOUT a rate            → UNBILLED  0.00 + costRateMissing
 *   P3 was paid at an OLDER rate: its line amount is 120 while today's valuation of N is 135 —
 *   the member sees the 120 that was actually paid, never a re-valuation.
 *   P2 COMPLETED 500, no links ("old system")  P5 COMPLETED 89 expense reimbursement  P6 VOID 999 (ignored)
 *   P7 PENDING 40 expense reimbursement (approved, not yet paid) → pending, named as a reimbursement
 * Member 2: one 1h invoiced entry at 100, no payouts.
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
const MEMBER2_ID = randomUUID();
const CLIENT_ID = randomUUID();
const PROJECT_ID = randomUUID();
const PROJECT_NO_RATE_ID = randomUUID();

vi.mock("../../server/storage", async () => {
  const actual = await vi.importActual<typeof import("../../server/storage")>("../../server/storage");
  const realGet = actual.storage.getUserById.bind(actual.storage);
  return {
    ...actual,
    storage: Object.assign(Object.create(Object.getPrototypeOf(actual.storage)), actual.storage, {
      getUserById: vi.fn(async (id: string) => {
        if (id === MEMBER_ID || id === MEMBER2_ID) return { id, orgId: ORG_ID, email: `pt-${id.slice(0, 8)}@example.com`, isActive: true, role: "TEAM_MEMBER", name: "PT Member", workerType: "INDEPENDENT" };
        return realGet(id);
      }),
    }),
  };
});

import { db, pool } from "../../server/db";
import { storage } from "../../server/storage";
import { orgs, EXPENSE_REIMBURSEMENT_NOTE_PREFIX, round2 } from "@shared/schema";
import { registerDashboardRoutes } from "../../server/routes/dashboard-routes";
import { registerPayoutRoutes } from "../../server/routes/payout-routes";

function buildApp(userId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, orgId: ORG_ID, role: "TEAM_MEMBER" };
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
const E = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID(), N: randomUUID(), F: randomUUID(), G: randomUUID(), M: randomUUID(), Z: randomUUID(), Z2: randomUUID(), M2: randomUUID() };
const P = { P1: randomUUID(), P2: randomUUID(), P3: randomUUID(), P4: randomUUID(), P5: randomUUID(), P6: randomUUID(), P7: randomUUID() };

type EntryRow = { id: string; user: string; project: string; minutes: number; billable: boolean; invoiced: boolean; snapshot: string | null };
const ENTRIES: EntryRow[] = [
  { id: E.A, user: MEMBER_ID, project: PROJECT_ID, minutes: 120, billable: true, invoiced: true, snapshot: "135" },
  { id: E.B, user: MEMBER_ID, project: PROJECT_ID, minutes: 120, billable: true, invoiced: true, snapshot: "135" },
  { id: E.C, user: MEMBER_ID, project: PROJECT_ID, minutes: 120, billable: true, invoiced: true, snapshot: "135" },
  { id: E.D, user: MEMBER_ID, project: PROJECT_ID, minutes: 60, billable: true, invoiced: false, snapshot: "135" },
  { id: E.N, user: MEMBER_ID, project: PROJECT_ID, minutes: 60, billable: false, invoiced: false, snapshot: "135" },
  { id: E.F, user: MEMBER_ID, project: PROJECT_ID, minutes: 50, billable: true, invoiced: false, snapshot: null },
  { id: E.G, user: MEMBER_ID, project: PROJECT_ID, minutes: 60, billable: true, invoiced: true, snapshot: "135" },
  { id: E.M, user: MEMBER_ID, project: PROJECT_NO_RATE_ID, minutes: 30, billable: true, invoiced: false, snapshot: null },
  { id: E.Z, user: MEMBER_ID, project: PROJECT_ID, minutes: 60, billable: true, invoiced: false, snapshot: "0.00" },
  { id: E.Z2, user: MEMBER_ID, project: PROJECT_NO_RATE_ID, minutes: 60, billable: true, invoiced: false, snapshot: "0.00" },
  { id: E.M2, user: MEMBER2_ID, project: PROJECT_ID, minutes: 60, billable: true, invoiced: true, snapshot: "100" },
];
type PayoutRow = { id: string; amount: string; date: string; method: string; status: string; ref: string; notes: string | null; links: string[] };
const PAYOUTS: PayoutRow[] = [
  { id: P.P1, amount: "270.00", date: "2026-08-10", method: "ZELLE", status: "COMPLETED", ref: "Z-1", notes: null, links: [E.A] },
  { id: P.P2, amount: "500.00", date: "2026-03-06", method: "ZELLE", status: "COMPLETED", ref: "Z-0", notes: "old system", links: [] },
  { id: P.P3, amount: "120.00", date: "2026-08-20", method: "ZELLE", status: "COMPLETED", ref: "Z-3", notes: null, links: [E.N] },
  { id: P.P4, amount: "135.00", date: "2026-09-01", method: "STRIPE_CONNECT", status: "PENDING", ref: "S-4", notes: null, links: [E.G] },
  { id: P.P5, amount: "89.00", date: "2026-08-25", method: "ZELLE", status: "COMPLETED", ref: "Z-5", notes: `${EXPENSE_REIMBURSEMENT_NOTE_PREFIX}flight`, links: [] },
  { id: P.P6, amount: "999.00", date: "2026-08-01", method: "ZELLE", status: "VOID", ref: "Z-6", notes: "voided", links: [] },
  { id: P.P7, amount: "40.00", date: "2026-09-02", method: "ZELLE", status: "PENDING", ref: "Z-7", notes: `${EXPENSE_REIMBURSEMENT_NOTE_PREFIX}parking`, links: [] },
];

// Expected member-1 figures, derived from the fixture above (see header).
const EXPECTED = {
  unbilledAmount: round2(135 + 112.5 + 0 + 135 + 0),   // D + F + M + Z + Z2
  unbilledMinutes: 60 + 50 + 30 + 60 + 60,
  awaitingAmount: 540,
  awaitingHours: 4,
  totalOwed: round2(135 + 112.5 + 0 + 135 + 0 + 540),
  pendingAmount: 175,         // P4 135 (earnings, in flight) + P7 40 (approved reimbursement)
  paidHours: 3,               // A 2h + N 1h
  earningsReceived: 890,      // P1 270 + P2 500 + P3 120
  linkedToHours: 390,         // P1 + P3
  withoutLinkedHours: 500,    // P2
  reimbursements: 89,         // P5
  totalReceivedAll: 979,
};

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Payout Truth Org", slug: `pt-${ORG_ID.slice(0, 8)}` });
  for (const uid of [MEMBER_ID, MEMBER2_ID]) {
    await pool.query(`INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active, payment_method) VALUES ($1,$2,$3,'x','PT Member','TEAM_MEMBER','INDEPENDENT',true,'ZELLE')`, [uid, ORG_ID, `pt-${uid.slice(0, 8)}@example.com`]);
  }
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1,$2,'PT Client')`, [CLIENT_ID, ORG_ID]);
  await pool.query(`INSERT INTO projects (id, org_id, client_id, name, status) VALUES ($1,$2,$3,'PT Project','ACTIVE'), ($4,$2,$3,'PT No-Rate Project','ACTIVE')`, [PROJECT_ID, ORG_ID, CLIENT_ID, PROJECT_NO_RATE_ID]);
  // Member 1 has a project rate on PT Project only; member 2 has none (snapshot carries the rate).
  await pool.query(`INSERT INTO project_members (id, org_id, project_id, user_id, hourly_rate, cost_rate_hourly) VALUES ($1,$2,$3,$4,'150','135')`, [randomUUID(), ORG_ID, PROJECT_ID, MEMBER_ID]);
  // Client-side invoices: one PAID, one SENT. The member view must not care.
  await pool.query(`INSERT INTO invoices (id, org_id, client_id, number, status, issued_date, due_date, subtotal, total, paid_amount) VALUES ($1,$2,$3,'PT-INV-PAID','PAID','2026-08-01','2026-08-15','600','600','600'), ($4,$2,$3,'PT-INV-SENT','SENT','2026-08-20','2026-09-03','300','300','0')`, [PAID_INVOICE, ORG_ID, CLIENT_ID, SENT_INVOICE]);
  for (const e of ENTRIES) {
    await pool.query(`INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, billable, rate, cost_rate_snapshot, invoiced) VALUES ($1,$2,$3,$4,'2026-08-05',$5,$6,'150',$7,$8)`, [e.id, ORG_ID, e.project, e.user, e.minutes, e.billable, e.snapshot, e.invoiced]);
  }
  for (const p of PAYOUTS) {
    await pool.query(`INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status, reference_number, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [p.id, ORG_ID, MEMBER_ID, p.amount, p.date, p.method, p.status, p.ref, p.notes]);
    for (const entryId of p.links) {
      await pool.query(`INSERT INTO payout_time_entries (id, org_id, payout_id, time_entry_id, amount) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), ORG_ID, p.id, entryId, p.amount]);
    }
  }
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
    const res = await get(buildApp(MEMBER_ID), "/api/dashboard/my");
    expect(res.status).toBe(200);
    expect(res.body.earningsUnavailable).toBe(false);
    const e = res.body.earnings;
    // B sits on a client-PAID invoice but has NOT been paid to the member → awaiting, not paid.
    expect(e.awaitingPayout.hours).toBe(EXPECTED.awaitingHours);
    expect(e.awaitingPayout.amount).toBe(EXPECTED.awaitingAmount);
    expect(e.awaitingPayout.byProject).toEqual([{ projectId: PROJECT_ID, projectName: "PT Project", hours: 4, minutes: 240, amount: 540 }]);
    // Unbilled values each line from UNROUNDED hours (F = 112.50, not 112.05) and
    // a project with no rate is worth 0 and flagged — exactly like the admin page.
    expect(e.unbilled.minutes).toBe(EXPECTED.unbilledMinutes);
    expect(e.unbilled.amount).toBe(EXPECTED.unbilledAmount);
    expect(e.unbilled.byProject.map((p: any) => [p.projectName, p.amount, p.minutes])).toEqual([["PT Project", 382.5, 170], ["PT No-Rate Project", 0, 90]]);
    expect(e.costRateMissing).toBe(true);
    expect(e.totalOwed).toBe(EXPECTED.totalOwed);
    // A pending payout is neither owed nor paid; it is shown as in flight.
    expect(e.pendingPayouts).toEqual({ count: 2, amount: EXPECTED.pendingAmount, hours: 1, reimbursements: { count: 1, amount: 40 } });
    // Paid = only what was actually paid out, incl. hours that were non-billable.
    expect(e.paid.hours).toBe(EXPECTED.paidHours);
    expect(e.paid.totalReceived).toBe(EXPECTED.earningsReceived);
    expect(e.paid.linkedToHours).toEqual({ count: 2, amount: EXPECTED.linkedToHours });
    expect(e.paid.withoutLinkedHours).toEqual({ count: 1, amount: EXPECTED.withoutLinkedHours });
    expect(e.reimbursements).toEqual({ count: 1, amount: EXPECTED.reimbursements });
    expect(e.totalReceivedIncludingReimbursements).toBe(EXPECTED.totalReceivedAll);
    // Recent payouts: COMPLETED only (no PENDING, no VOID), newest first, labelled by fact.
    expect(e.paid.items.map((i: any) => i.id)).toEqual([P.P5, P.P3, P.P1, P.P2]);
    const byId = Object.fromEntries(e.paid.items.map((i: any) => [i.id, i]));
    expect(byId[P.P1]).toMatchObject({ kind: "EARNINGS", linkedHours: 2, amount: 270, paymentMethod: "ZELLE" });
    expect(String(byId[P.P1].payoutDate)).toMatch(/^2026-08-10/);
    expect(byId[P.P3]).toMatchObject({ kind: "EARNINGS", linkedHours: 1, amount: 120 });
    expect(byId[P.P2]).toMatchObject({ kind: "EARNINGS", linkedHours: 0, linkedMinutes: 0, amount: 500 });
    expect(byId[P.P5]).toMatchObject({ kind: "EXPENSE_REIMBURSEMENT", linkedHours: 0, amount: 89 });
  });

  it("never exposes the client's payment status, invoice dates, or the payout notes", async () => {
    const res = await get(buildApp(MEMBER_ID), "/api/dashboard/my");
    const json = JSON.stringify(res.body.earnings);
    for (const leak of ["invoiceStatus", "invoiceDueDate", "invoicePaidDate", "nextPaymentDate", "billedAwaiting", "paidDate", "PT-INV-PAID", "PT-INV-SENT", "old system", "voided", "stripeTransfer"]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("shows one member only their own money", async () => {
    const res = await get(buildApp(MEMBER2_ID), "/api/dashboard/my");
    expect(res.status).toBe(200);
    const e = res.body.earnings;
    expect(e.totalOwed).toBe(100);
    expect(e.awaitingPayout).toMatchObject({ hours: 1, amount: 100 });
    expect(e.unbilled.amount).toBe(0);
    expect(e.costRateMissing).toBe(false);
    expect(e.paid.totalReceived).toBe(0);
    expect(e.paid.items).toEqual([]);
    expect(e.pendingPayouts.count).toBe(0);
  });
});

describe("GET /api/my/earnings — the badge equals the list, and both endpoints agree", () => {
  it("totalReceived is the sum of the completed payouts it lists; the split foots by construction", async () => {
    const res = await get(buildApp(MEMBER_ID), "/api/my/earnings");
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.payoutHistory.map((p: any) => p.id)).toEqual([P.P5, P.P3, P.P1, P.P2]);
    const listSum = round2(b.payoutHistory.reduce((s: number, p: any) => s + Number(p.amount), 0));
    expect(b.totalReceived).toBe(EXPECTED.totalReceivedAll);
    expect(listSum).toBe(b.totalReceived);
    expect(b.earningsReceived).toBe(EXPECTED.earningsReceived);
    expect(round2(b.paidLinkedToHours.amount + b.paidWithoutLinkedHours.amount + b.reimbursementsReceived.amount)).toBe(b.totalReceived);
    expect(b.paidHours).toBe(EXPECTED.paidHours);
    // Owed = the same single number the dashboard badge shows.
    expect(b.pendingPayout).toBe(EXPECTED.totalOwed);
    expect(b.totalOwed).toBe(EXPECTED.totalOwed);
    expect(b.pendingPayouts).toEqual({ count: 2, amount: 175, hours: 1, reimbursements: { count: 1, amount: 40 } });
    expect(b.costRateMissing).toBe(true);
    // Per-entry ledger foots to the buckets.
    const byId = Object.fromEntries(b.timeEntries.map((t: any) => [t.id, t]));
    expect(byId[E.A]).toMatchObject({ status: "PAID", isPaid: true, payoutId: P.P1, amount: 270 });
    // N was paid at an older rate: the ledger shows the 120 that was actually paid, not today's 135.
    expect(byId[E.N]).toMatchObject({ status: "PAID", isPaid: true, payoutId: P.P3, amount: 120, billable: false });
    // A "0.00" snapshot means "no rate when logged": the project rate applies now; no rate anywhere → 0 and flagged.
    expect(byId[E.Z]).toMatchObject({ status: "UNBILLED", amount: 135, costRate: 135 });
    expect(byId[E.Z2]).toMatchObject({ status: "UNBILLED", amount: 0, costRate: 0 });
    expect(byId[E.G]).toMatchObject({ status: "PENDING_PAYOUT", isPaid: false, payoutId: P.P4 });
    expect(byId[E.B]).toMatchObject({ status: "BILLED", isPaid: false, payoutId: null });
    expect(byId[E.F]).toMatchObject({ status: "UNBILLED", amount: 112.5, costRate: 135 });
    expect(byId[E.M]).toMatchObject({ status: "UNBILLED", amount: 0, costRate: 0 });
    const owedFromLedger = round2(b.timeEntries.filter((t: any) => t.status === "BILLED" || t.status === "UNBILLED").reduce((s: number, t: any) => s + t.amount, 0));
    expect(owedFromLedger).toBe(EXPECTED.totalOwed);
  });

  it("agrees with the admin's Record Payment total and Payouts page to the cent", async () => {
    // What the admin would be offered to pay right now:
    const unpaid = await storage.getUnpaidTimeEntriesForTeamMember(ORG_ID, MEMBER_ID);
    expect(round2(unpaid.reduce((s, e) => s + e.value, 0))).toBe(EXPECTED.totalOwed);
    expect(unpaid.map(e => e.id).sort()).toEqual([E.B, E.C, E.D, E.F, E.M, E.Z, E.Z2].sort());
    expect(unpaid.find(e => e.id === E.Z)!.value).toBe(135);
    // What the admin Payouts page shows for this member:
    const adminRow = (await storage.getPayoutSummaryByTeamMember(ORG_ID)).find(r => r.teamMemberId === MEMBER_ID)!;
    expect(adminRow.unpaidTimeValue).toBe(EXPECTED.totalOwed);
    expect(adminRow.pendingPayoutAmount).toBe(EXPECTED.pendingAmount);
    expect(adminRow.totalPaidOut).toBe(EXPECTED.totalReceivedAll);
    expect(adminRow.costRateMissing).toBe(true);
    // What the member sees:
    const member = await get(buildApp(MEMBER_ID), "/api/dashboard/my");
    expect(member.body.earnings.totalOwed).toBe(adminRow.unpaidTimeValue);
    expect(member.body.earnings.pendingPayouts.amount).toBe(adminRow.pendingPayoutAmount);
    // The two member figures add up to the single "amount owed" the admin sees.
    expect(round2(member.body.earnings.totalOwed + member.body.earnings.pendingPayouts.amount)).toBe(adminRow.amountOwed);
    expect(member.body.earnings.totalReceivedIncludingReimbursements).toBe(adminRow.totalPaidOut);
    // paid + pending hours on the member side == the admin's paidMinutes (non-VOID links)
    expect(round2(member.body.earnings.paid.hours + member.body.earnings.pendingPayouts.hours)).toBe(adminRow.paidHours);
  });
});
