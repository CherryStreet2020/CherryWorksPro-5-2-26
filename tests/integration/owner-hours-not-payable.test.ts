/**
 * The firm's owner is not a contractor. An ADMIN's hours are revenue, never a
 * payable: the invoice-send auto-payout skips them (isPayoutEligibleTeamMember)
 * and the Payouts page only lists people outside the contractor pool when a
 * payout was actually completed or is pending for them — VOID rows alone do not
 * earn a row. (Dean, 2026-09-04: "Yes, stop" auto-payouts to himself.)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

import { db, pool } from "../../server/db";
import { orgs, isPayoutEligibleTeamMember } from "@shared/schema";
import { storage } from "../../server/storage";

const ORG_ID = randomUUID();
const OWNER_ID = randomUUID();      // ADMIN with only VOID payouts → no row
const MANAGER_ID = randomUUID();    // MANAGER with a COMPLETED payout → row (money was paid)
const CONTRACTOR_ID = randomUUID(); // TEAM_MEMBER → row always

describe("isPayoutEligibleTeamMember", () => {
  it("pays independent team members and managers, never W-2 employees or admins", () => {
    expect(isPayoutEligibleTeamMember({ role: "TEAM_MEMBER", workerType: "INDEPENDENT" })).toBe(true);
    expect(isPayoutEligibleTeamMember({ role: "MANAGER", workerType: "INDEPENDENT" })).toBe(true);
    expect(isPayoutEligibleTeamMember({ role: "TEAM_MEMBER", workerType: "W2_EMPLOYEE" })).toBe(false);
    expect(isPayoutEligibleTeamMember({ role: "ADMIN", workerType: "INDEPENDENT" })).toBe(false);
    expect(isPayoutEligibleTeamMember(null)).toBe(false);
    expect(isPayoutEligibleTeamMember(undefined)).toBe(false);
  });
});

describe("getPayoutSummaryByTeamMember — who gets a row", () => {
  beforeAll(async () => {
    await db.insert(orgs).values({ id: ORG_ID, name: "Owner Rows Org", slug: `own-${ORG_ID.slice(0, 8)}` });
    for (const [id, role, name] of [[OWNER_ID, "ADMIN", "Owner"], [MANAGER_ID, "MANAGER", "Manager"], [CONTRACTOR_ID, "TEAM_MEMBER", "Contractor"]] as const) {
      await pool.query(`INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active) VALUES ($1,$2,$3,'x',$4,$5,'INDEPENDENT',true)`, [id, ORG_ID, `own-${id.slice(0, 8)}@example.com`, name, role]);
    }
    // Owner: two VOID auto-payouts only (the state after today's cleanup).
    for (const amt of ["1987.50", "1425.00"]) {
      await pool.query(`INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status, notes) VALUES ($1,$2,$3,$4,'2026-07-07','TBD','VOID','Auto-created from Invoice X — voided')`, [randomUUID(), ORG_ID, OWNER_ID, amt]);
    }
    // Manager: one COMPLETED payout — money left the bank, so the row stays.
    await pool.query(`INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status) VALUES ($1,$2,$3,'500.00','2026-08-01','ZELLE','COMPLETED')`, [randomUUID(), ORG_ID, MANAGER_ID]);
  });

  afterAll(async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.allow_audit_log_modification','on',true)`);
      for (const t of ["audit_logs", "payout_time_entries", "team_member_payouts_v2", "time_entries", "users"]) {
        await c.query(`DELETE FROM ${t} WHERE org_id = $1`, [ORG_ID]);
      }
      await c.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  });

  it("lists contractors and anyone actually paid, but not an owner whose only payouts are VOID", async () => {
    const rows = await storage.getPayoutSummaryByTeamMember(ORG_ID);
    const ids = rows.map(r => r.teamMemberId).sort();
    expect(ids).toEqual([CONTRACTOR_ID, MANAGER_ID].sort());
    expect(rows.find(r => r.teamMemberId === MANAGER_ID)!.totalPaidOut).toBe(500);
  });

  it("an owner reappears only when a real payout exists for them", async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO team_member_payouts_v2 (id, org_id, team_member_id, amount, payout_date, payment_method, status) VALUES ($1,$2,$3,'100.00','2026-08-02','ZELLE','PENDING')`, [id, ORG_ID, OWNER_ID]);
    const rows = await storage.getPayoutSummaryByTeamMember(ORG_ID);
    expect(rows.map(r => r.teamMemberId)).toContain(OWNER_ID);
    expect(rows.find(r => r.teamMemberId === OWNER_ID)!.pendingPayoutAmount).toBe(100);
    await pool.query(`DELETE FROM team_member_payouts_v2 WHERE id = $1`, [id]);
  });
});
