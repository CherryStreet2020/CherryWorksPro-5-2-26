/**
 * Per-member payout statement: the timesheet lines behind the outstanding
 * balance must foot to the cent with the Payouts page summary (the #40 truth —
 * one valuation), the lines behind a recorded payout must be the amounts booked
 * for it, and the Excel/PDF downloads must be real files with the right headers.
 * Seeding follows member-earnings-payout-truth.test.ts.
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
const E = { paid: randomUUID(), u1: randomUUID(), u2: randomUUID() };
const PAYOUT_ID = randomUUID();

import { db, pool } from "../../server/db";
import { orgs } from "@shared/schema";
import { registerPayoutRoutes } from "../../server/routes/payout-routes";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: ADMIN_ID, orgId: ORG_ID, role: "ADMIN" };
    next();
  });
  registerPayoutRoutes(app);
  return app;
}

async function get(app: Express, path: string): Promise<{ status: number; type: string | null; body: any; bytes: number }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        const type = res.headers.get("content-type");
        const buf = Buffer.from(await res.arrayBuffer());
        const body = type?.includes("application/json") ? JSON.parse(buf.toString("utf8")) : null;
        server.close(() => resolve({ status: res.status, type, body, bytes: buf.length }));
      } catch (err) { server.close(() => reject(err)); }
    });
  });
}

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Statement Org", slug: `st-${ORG_ID.slice(0, 8)}` });
  await pool.query(`INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active, payment_method) VALUES ($1,$2,$3,'x','Statement Admin','ADMIN','W2',true,'ZELLE')`, [ADMIN_ID, ORG_ID, `st-admin-${ORG_ID.slice(0, 8)}@example.com`]);
  await pool.query(`INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active, payment_method) VALUES ($1,$2,$3,'x','David Statement','TEAM_MEMBER','CONTRACTOR_1099',true,'ZELLE')`, [MEMBER_ID, ORG_ID, `st-member-${ORG_ID.slice(0, 8)}@example.com`]);
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1,$2,'Statement Client')`, [CLIENT_ID, ORG_ID]);
  await pool.query(`INSERT INTO projects (id, org_id, client_id, name, status) VALUES ($1,$2,$3,'Statement Project','ACTIVE')`, [PROJECT_ID, ORG_ID, CLIENT_ID]);
  await pool.query(`INSERT INTO project_members (id, org_id, project_id, user_id, hourly_rate, cost_rate_hourly) VALUES ($1,$2,$3,$4,'150','135')`, [randomUUID(), ORG_ID, PROJECT_ID, MEMBER_ID]);
  // one paid entry (2h @ 135 = 270, linked), two unpaid (1h @ 135 and 50 min @ 135 = 112.50)
  await pool.query(`INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, billable, rate, cost_rate_snapshot, invoiced, notes) VALUES ($1,$2,$3,$4,'2026-08-04',120,true,'150','135',true,'paid work')`, [E.paid, ORG_ID, PROJECT_ID, MEMBER_ID]);
  await pool.query(`INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, billable, rate, cost_rate_snapshot, invoiced, notes) VALUES ($1,$2,$3,$4,'2026-08-11',60,true,'150','135',false,'unpaid one')`, [E.u1, ORG_ID, PROJECT_ID, MEMBER_ID]);
  await pool.query(`INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, billable, rate, cost_rate_snapshot, invoiced, notes) VALUES ($1,$2,$3,$4,'2026-08-12',50,true,'150','135',false,'unpaid two')`, [E.u2, ORG_ID, PROJECT_ID, MEMBER_ID]);
  await pool.query(`INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status, reference_number, notes) VALUES ($1,$2,$3,'270.00','2026-08-10','ZELLE','COMPLETED','Z-1',NULL)`, [PAYOUT_ID, ORG_ID, MEMBER_ID]);
  await pool.query(`INSERT INTO payout_time_entries (id, org_id, payout_id, time_entry_id, amount) VALUES ($1,$2,$3,$4,'270.00')`, [randomUUID(), ORG_ID, PAYOUT_ID, E.paid]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM payout_time_entries WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM team_member_payouts_v2 WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM time_entries WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM project_members WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM projects WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM clients WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM users WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]);
});

describe("GET /api/payouts/team-member/:id/statement", () => {
  it("lists the exact unpaid lines and foots to the Payouts page balance", async () => {
    const app = buildApp();
    const { status, body } = await get(app, `/api/payouts/team-member/${MEMBER_ID}/statement`);
    expect(status).toBe(200);
    expect(body.member.name).toBe("David Statement");
    expect(body.currency).toBe("USD"); // the org's base currency, carried into the dialog and both exports
    expect(body.outstanding.lines.map((l: any) => l.entryId).sort()).toEqual([E.u1, E.u2].sort());
    expect(body.outstanding.total).toBe(247.5);
    expect(body.outstanding.hours).toBe(1.83);
    const u1 = body.outstanding.lines.find((l: any) => l.entryId === E.u1);
    expect(u1).toMatchObject({ project: "Statement Project", client: "Statement Client", hours: 1, rate: 135, amount: 135, invoiced: false, notes: "unpaid one" });
    // the same number the Outstanding Balances card shows
    const summary = await get(app, `/api/payouts/summary`);
    const mine = summary.body.find((c: any) => c.teamMemberId === MEMBER_ID);
    expect(mine.unpaidTimeValue).toBe(body.outstanding.total);
  });

  it("lists the lines behind each recorded payout with the booked amounts", async () => {
    const { body } = await get(buildApp(), `/api/payouts/team-member/${MEMBER_ID}/statement`);
    expect(body.payouts).toHaveLength(1);
    const p = body.payouts[0];
    expect(p).toMatchObject({ id: PAYOUT_ID, amount: 270, status: "COMPLETED", paymentMethod: "ZELLE", referenceNumber: "Z-1", unlinkedAmount: 0 });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ entryId: E.paid, date: "2026-08-04", hours: 2, rate: 135, amount: 270, notes: "paid work" });
    expect(body.paidTotal).toBe(270);
  });

  it("downloads Excel and PDF files", async () => {
    const app = buildApp();
    const xlsx = await get(app, `/api/payouts/team-member/${MEMBER_ID}/statement.xlsx`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.type).toContain("spreadsheetml");
    expect(xlsx.bytes).toBeGreaterThan(2000);
    const pdf = await get(app, `/api/payouts/team-member/${MEMBER_ID}/statement.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toContain("application/pdf");
    expect(pdf.bytes).toBeGreaterThan(1000);
  });

  it("404s for a member of another organisation", async () => {
    const { status } = await get(buildApp(), `/api/payouts/team-member/${randomUUID()}/statement`);
    expect(status).toBe(404);
  });
});
