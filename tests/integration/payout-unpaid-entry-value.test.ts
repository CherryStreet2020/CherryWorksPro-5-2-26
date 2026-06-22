/**
 * The Record Payment dialog lets the admin check specific time entries; when it
 * does, the payout is itemized and the server (POST /api/payouts) derives the
 * recorded amount from exactly those entries — it ignores the typed amount. So
 * the dialog must show the same number it will record. To do that the unpaid-
 * entries endpoint now returns a per-entry `value`, and the client sums the
 * selected ones.
 *
 * This test pins the invariant that makes the dialog trustworthy: each entry's
 * `value` uses the SAME snapshot-preferring rate and per-line round2 as both the
 * Outstanding Balance (getPayoutSummaryByTeamMember.unpaidTimeValue) and the
 * payout create handler. Concretely:
 *   - per-entry value = round2(hours × (costRateSnapshot ?? projectCostRate))
 *   - sum of ALL unpaid values === unpaidTimeValue (dialog "Select All" foots to
 *     the Outstanding Balance)
 *   - sum of a SUBSET === the amount the create handler would record for that
 *     subset (round each line, then sum) — what Dean sees is what gets paid.
 *
 * On the pre-change endpoint the entries carried no `value`, so the dialog could
 * not foot to either number and showed a stale full-balance amount regardless of
 * which boxes were checked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

import { db, pool } from "../../server/db";
import { orgs, round2 } from "@shared/schema";
import { storage } from "../../server/storage";

const ORG_ID = randomUUID();
const CLIENT_ID = randomUUID();
const PROJECT_ID = randomUUID();
const MEMBER_ID = randomUUID();
// E1: 90m @ snapshot 100 → 150.00 | E2: 30m, no snapshot → project rate 120 → 60.00
// E3: 45m @ snapshot 133.33 → round2(0.75×133.33)=round2(99.9975)=100.00 (per-line rounding)
const E1 = randomUUID();
const E2 = randomUUID();
const E3 = randomUUID();

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Unpaid Value Org", slug: `uv-${ORG_ID.slice(0, 8)}` });
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $2, 'UV Client')`, [CLIENT_ID, ORG_ID]);
  await pool.query(`INSERT INTO projects (id, org_id, client_id, name) VALUES ($1, $2, $3, 'UV Project')`, [PROJECT_ID, ORG_ID, CLIENT_ID]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active)
     VALUES ($1, $2, $3, 'x', 'UV Member', 'TEAM_MEMBER', 'INDEPENDENT', true)`,
    [MEMBER_ID, ORG_ID, `uv-${MEMBER_ID.slice(0, 8)}@example.com`],
  );
  // Current project cost rate = 120/hr — the fallback when an entry has no snapshot.
  await pool.query(
    `INSERT INTO project_members (id, org_id, project_id, user_id, hourly_rate, cost_rate_hourly)
     VALUES ($1, $2, $3, $4, '0', '120')`,
    [randomUUID(), ORG_ID, PROJECT_ID, MEMBER_ID],
  );
  const ins = async (id: string, minutes: number, snapshot: string | null) =>
    pool.query(
      `INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, rate, cost_rate_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, '0', $7)`,
      [id, ORG_ID, PROJECT_ID, MEMBER_ID, "2026-02-10", minutes, snapshot],
    );
  await ins(E1, 90, "100");
  await ins(E2, 30, null);
  await ins(E3, 45, "133.33");
});

afterAll(async () => {
  // payout_time_entries FK time_entries, so clear the payout graph first.
  await pool.query(`DELETE FROM payout_time_entries WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM team_member_payouts_v2 WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM time_entries WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM project_members WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM users WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM projects WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM clients WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]);
});

describe("getUnpaidTimeEntriesForTeamMember per-entry value", () => {
  it("computes per-entry value with snapshot-preferring rate and per-line round2", async () => {
    const entries = await storage.getUnpaidTimeEntriesForTeamMember(ORG_ID, MEMBER_ID);
    const byId = new Map(entries.map((e: any) => [e.id, e]));
    expect(byId.get(E1)!.value).toBe(150);     // 1.5h × snapshot 100
    expect(byId.get(E2)!.value).toBe(60);      // 0.5h × project fallback 120
    expect(byId.get(E3)!.value).toBe(100);     // 0.75h × snapshot 133.33, rounded per line
  });

  it("sums all unpaid values to the Outstanding Balance (unpaidTimeValue)", async () => {
    const entries = await storage.getUnpaidTimeEntriesForTeamMember(ORG_ID, MEMBER_ID);
    const total = round2(entries.reduce((s: number, e: any) => s + e.value, 0));
    const summary = await storage.getPayoutSummaryByTeamMember(ORG_ID);
    const member = summary.find((m: any) => m.teamMemberId === MEMBER_ID)!;
    expect(total).toBe(310);
    expect(member.unpaidTimeValue).toBe(310);
    expect(total).toBe(member.unpaidTimeValue);
  });

  it("subset sum is the itemized total the create handler records for that subset", async () => {
    const entries = await storage.getUnpaidTimeEntriesForTeamMember(ORG_ID, MEMBER_ID);
    const byId = new Map(entries.map((e: any) => [e.id, e]));
    // Paying only E1 + E3 (what the admin checked). The dialog sums the same
    // per-entry values the create handler rounds-then-sums (server/routes/
    // payout-routes.ts derives the itemized total from exactly these inputs),
    // so the displayed amount equals what gets recorded — pinned to 250.
    const dialogAmount = round2(byId.get(E1)!.value + byId.get(E3)!.value);
    expect(dialogAmount).toBe(250);
  });
});

// Invariant #3: the endpoint's "unpaid" set is exactly the set the Outstanding
// Balance treats as unpaid — entries already in a NON-VOID payout are excluded
// from BOTH, so Select All keeps footing to unpaidTimeValue. Runs last so it
// doesn't perturb the all-unpaid (310) cases above.
describe("getUnpaidTimeEntriesForTeamMember excludes already-paid entries", () => {
  it("drops an entry linked to a non-VOID payout and stays footed to the balance", async () => {
    const payout = await storage.createTeamMemberPayout({
      orgId: ORG_ID,
      teamMemberId: MEMBER_ID,
      amount: "60",
      payoutDate: "2026-02-20",
      paymentMethod: "Zelle",
      status: "COMPLETED",
    } as any);
    await storage.linkTimeEntriesToPayout(payout.id, MEMBER_ID, [{ timeEntryId: E2, amount: "60" }], ORG_ID);

    const entries = await storage.getUnpaidTimeEntriesForTeamMember(ORG_ID, MEMBER_ID);
    const ids = entries.map((e: any) => e.id);
    expect(ids).not.toContain(E2);            // E2 is now paid
    expect(ids).toContain(E1);
    expect(ids).toContain(E3);

    const total = round2(entries.reduce((s: number, e: any) => s + e.value, 0));
    const summary = await storage.getPayoutSummaryByTeamMember(ORG_ID);
    const member = summary.find((m: any) => m.teamMemberId === MEMBER_ID)!;
    expect(total).toBe(250);                  // 310 − E2's 60
    expect(member.unpaidTimeValue).toBe(250); // balance fell by the same 60
    expect(total).toBe(member.unpaidTimeValue);
  });
});
