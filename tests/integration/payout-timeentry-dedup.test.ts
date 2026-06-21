/**
 * Audit #13: a time entry could be linked to multiple payouts (double-pay). There
 * was no unique constraint and no in-transaction unpaid re-check, and the advisory
 * lock was keyed on the payout DATE so two payouts for the same member on different
 * dates didn't even serialize.
 *
 * The fix centralizes the guard in storage.linkTimeEntriesToPayout (the single insert
 * point — both POST /api/payouts and the invoice-send auto-payout go through it): it
 * takes a (org, member) advisory lock, re-checks whether any requested entry is
 * already in a NON-VOID payout, and throws PayoutEntriesAlreadyPaidError if so — all
 * on one connection, so concurrent links for the same member can't both pass. VOID
 * payouts are excluded, so re-pay after voiding is allowed.
 *
 * On the pre-fix code linkTimeEntriesToPayout inserted unconditionally, so the
 * "already paid" / concurrent assertions below fail.
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
import { orgs, payoutTimeEntries, teamMemberPayoutsV2 } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage, PayoutEntriesAlreadyPaidError } from "../../server/storage";

const ORG_ID = randomUUID();
const CLIENT_ID = randomUUID();
const PROJECT_ID = randomUUID();
const M1 = randomUUID();
const M2 = randomUUID();
// Time entries: T1/T2/T3 belong to M1, T4 to M1, T5 to M2.
const T = { T1: randomUUID(), T2: randomUUID(), T3: randomUUID(), T4: randomUUID(), T5: randomUUID() };

async function seedUser(id: string, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, org_id, email, password, name) VALUES ($1, $2, $3, 'x', $4)`,
    [id, ORG_ID, email, `User ${email}`],
  );
}
async function seedTimeEntry(id: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO time_entries (id, org_id, project_id, user_id, date, minutes, rate)
     VALUES ($1, $2, $3, $4, '2026-01-01', 60, '100')`,
    [id, ORG_ID, PROJECT_ID, userId],
  );
}
async function newPayout(teamMemberId: string, status = "COMPLETED"): Promise<string> {
  const p = await storage.createTeamMemberPayout({
    orgId: ORG_ID, teamMemberId, amount: "100", payoutDate: "2026-01-05",
    paymentMethod: "ZELLE", status: status as any,
  } as any);
  return p.id;
}
const entry = (id: string) => [{ timeEntryId: id, amount: "100" }];

async function linkRowCount(timeEntryId: string): Promise<number> {
  const rows = await db.select().from(payoutTimeEntries).where(and(eq(payoutTimeEntries.timeEntryId, timeEntryId), eq(payoutTimeEntries.orgId, ORG_ID)));
  return rows.length;
}

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Payout Dedup Org", slug: `pd-${ORG_ID.slice(0, 8)}` });
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $2, 'Dedup Client')`, [CLIENT_ID, ORG_ID]);
  await pool.query(`INSERT INTO projects (id, org_id, client_id, name) VALUES ($1, $2, $3, 'Dedup Project')`, [PROJECT_ID, ORG_ID, CLIENT_ID]);
  await seedUser(M1, "m1@dedup.test");
  await seedUser(M2, "m2@dedup.test");
  await seedTimeEntry(T.T1, M1);
  await seedTimeEntry(T.T2, M1);
  await seedTimeEntry(T.T3, M1);
  await seedTimeEntry(T.T4, M1);
  await seedTimeEntry(T.T5, M2);
}, 30_000);

afterAll(async () => {
  await pool.query(`DELETE FROM payout_time_entries WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM team_member_payouts_v2 WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM time_entries WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM projects WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM clients WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM users WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]).catch(() => undefined);
});

describe("linkTimeEntriesToPayout rejects double-paying a time entry (audit #13)", () => {
  it("a second payout (different date) for the same already-paid entry is rejected", async () => {
    const p1 = await newPayout(M1);
    await storage.linkTimeEntriesToPayout(p1, M1, entry(T.T1), ORG_ID);
    expect(await linkRowCount(T.T1)).toBe(1);

    const p2 = await newPayout(M1);
    await expect(storage.linkTimeEntriesToPayout(p2, M1, entry(T.T1), ORG_ID))
      .rejects.toBeInstanceOf(PayoutEntriesAlreadyPaidError);
    expect(await linkRowCount(T.T1)).toBe(1); // still only paid once
  }, 20_000);

  it("after VOIDing the original payout, the entry can be re-paid", async () => {
    const p3 = await newPayout(M1);
    await storage.linkTimeEntriesToPayout(p3, M1, entry(T.T2), ORG_ID);
    await storage.updateTeamMemberPayout(p3, ORG_ID, { status: "VOID" });

    const p4 = await newPayout(M1);
    await storage.linkTimeEntriesToPayout(p4, M1, entry(T.T2), ORG_ID); // allowed — p3 is VOID
    const rows = await db.select().from(payoutTimeEntries).where(and(eq(payoutTimeEntries.timeEntryId, T.T2), eq(payoutTimeEntries.orgId, ORG_ID)));
    const activeLinks = rows.filter(r => r.payoutId === p4);
    expect(activeLinks).toHaveLength(1);
  }, 20_000);

  it("two concurrent links of the same entry resolve to exactly one success + one rejection", async () => {
    const pa = await newPayout(M1);
    const pb = await newPayout(M1);
    const results = await Promise.allSettled([
      storage.linkTimeEntriesToPayout(pa, M1, entry(T.T3), ORG_ID),
      storage.linkTimeEntriesToPayout(pb, M1, entry(T.T3), ORG_ID),
    ]);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(PayoutEntriesAlreadyPaidError);
    expect(await linkRowCount(T.T3)).toBe(1);
  }, 20_000);

  it("un-VOIDing a payout is rejected if its entry was re-paid elsewhere (audit #13)", async () => {
    // Pay T6 in p5, VOID p5 (T6 unpaid), re-pay T6 in p6. Now reactivating p5
    // (VOID → COMPLETED) must be rejected — else T6 is in two non-VOID payouts.
    const T6 = randomUUID();
    await seedTimeEntry(T6, M1);
    const p5 = await newPayout(M1);
    await storage.linkTimeEntriesToPayout(p5, M1, entry(T6), ORG_ID);
    await storage.updateTeamMemberPayout(p5, ORG_ID, { status: "VOID" });
    const p6 = await newPayout(M1);
    await storage.linkTimeEntriesToPayout(p6, M1, entry(T6), ORG_ID); // allowed — p5 is VOID

    await expect(storage.reactivateVoidedPayout(p5, ORG_ID, M1, { status: "COMPLETED" }))
      .rejects.toBeInstanceOf(PayoutEntriesAlreadyPaidError);

    // p5 stays VOID; T6 is paid in exactly one non-VOID payout (p6).
    const [p5row] = await db.select().from(teamMemberPayoutsV2).where(eq(teamMemberPayoutsV2.id, p5));
    expect(p5row.status).toBe("VOID");
  }, 20_000);

  it("un-VOIDing is allowed when the entry is NOT paid elsewhere", async () => {
    const T7 = randomUUID();
    await seedTimeEntry(T7, M1);
    const p7 = await newPayout(M1);
    await storage.linkTimeEntriesToPayout(p7, M1, entry(T7), ORG_ID);
    await storage.updateTeamMemberPayout(p7, ORG_ID, { status: "VOID" });
    // No re-pay of T7 anywhere → reactivation succeeds.
    const updated = await storage.reactivateVoidedPayout(p7, ORG_ID, M1, { status: "COMPLETED" });
    expect(updated?.status).toBe("COMPLETED");
  }, 20_000);

  it("concurrent links for DIFFERENT members do not block each other", async () => {
    const pm1 = await newPayout(M1);
    const pm2 = await newPayout(M2);
    const results = await Promise.allSettled([
      storage.linkTimeEntriesToPayout(pm1, M1, entry(T.T4), ORG_ID),
      storage.linkTimeEntriesToPayout(pm2, M2, entry(T.T5), ORG_ID),
    ]);
    expect(results.every(r => r.status === "fulfilled")).toBe(true);
    expect(await linkRowCount(T.T4)).toBe(1);
    expect(await linkRowCount(T.T5)).toBe(1);
  }, 20_000);
});
