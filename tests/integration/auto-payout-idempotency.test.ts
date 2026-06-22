/**
 * #17 — the invoice-send auto-payout must not spawn duplicate payouts when an
 * invoice is re-sent. The old idempotency check (invoice-routes.ts) only looked
 * for status:"PENDING" payouts and substring-matched the notes:
 *
 *     existing.some(p => p.notes?.includes(`Invoice ${invoice.number}`))
 *
 * Two bugs: (1) once a payout was COMPLETED/VOID it was invisible to the check,
 * so a re-send created a duplicate (the root of the payout tangle); (2)
 * `includes("Invoice 1")` also matches "Invoice 10"/"Invoice 100", so the check
 * cross-matched unrelated invoices.
 *
 * The fix adds an explicit teamMemberPayoutsV2.sourceInvoiceId link and a
 * storage.hasActiveInvoicePayout(org, invoiceId, invoiceNumber, member) guard
 * that returns true iff a NON-VOID payout already covers that (invoice, member),
 * keyed on sourceInvoiceId (with a disambiguated legacy-notes fallback for
 * payouts created before the column existed). This test pins that behavior.
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
import { orgs } from "@shared/schema";
import { storage } from "../../server/storage";

const ORG_ID = randomUUID();
const M1 = randomUUID();
const M2 = randomUUID();
const INV_A = randomUUID();      // invoice number "1"
const INV_B = randomUUID();      // invoice number "2" (its payout will be VOID)
const INV_TEN = randomUUID();    // invoice number "10" (legacy, no sourceInvoiceId)

async function seedUser(id: string, label: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, org_id, email, password, name, role, worker_type, is_active)
     VALUES ($1, $2, $3, 'x', $4, 'TEAM_MEMBER', 'INDEPENDENT', true)`,
    [id, ORG_ID, `${label}-${id.slice(0, 8)}@example.com`, label],
  );
}

beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG_ID, name: "Auto-Payout Idem Org", slug: `api-${ORG_ID.slice(0, 8)}` });
  await seedUser(M1, "Member One");
  await seedUser(M2, "Member Two");

  // P1: active (PENDING) auto-payout for invoice "1", member M1 — explicit link.
  await storage.createTeamMemberPayout({
    orgId: ORG_ID, teamMemberId: M1, amount: "100", payoutDate: "2026-03-01",
    paymentMethod: "Zelle", status: "PENDING",
    sourceInvoiceId: INV_A, notes: "Auto-created from Invoice 1 (Acme)",
  } as any);
  // P2: VOID auto-payout for invoice "2", member M1 — must NOT block re-create.
  await storage.createTeamMemberPayout({
    orgId: ORG_ID, teamMemberId: M1, amount: "50", payoutDate: "2026-03-02",
    paymentMethod: "Zelle", status: "VOID",
    sourceInvoiceId: INV_B, notes: "Auto-created from Invoice 2 (Beta)",
  } as any);
  // P3: legacy COMPLETED auto-payout for invoice "10", member M1 — created before
  // sourceInvoiceId existed, so it relies on the notes fallback.
  await storage.createTeamMemberPayout({
    orgId: ORG_ID, teamMemberId: M1, amount: "200", payoutDate: "2026-03-03",
    paymentMethod: "Zelle", status: "COMPLETED",
    notes: "Auto-created from Invoice 10 (Gamma)",
  } as any);
});

afterAll(async () => {
  await pool.query(`DELETE FROM team_member_payouts_v2 WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM users WHERE org_id = $1`, [ORG_ID]);
  await pool.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]);
});

describe("hasActiveInvoicePayout (auto-payout idempotency #17)", () => {
  it("persists sourceInvoiceId on the payout", async () => {
    const payouts = await storage.getTeamMemberPayouts(ORG_ID, { teamMemberId: M1 });
    const p1 = payouts.find(p => p.sourceInvoiceId === INV_A);
    expect(p1).toBeTruthy();
    expect(p1!.amount).toBe("100.00");
  });

  it("detects an existing non-VOID payout by sourceInvoiceId (blocks the duplicate)", async () => {
    expect(await storage.hasActiveInvoicePayout(ORG_ID, INV_A, "1", M1)).toBe(true);
  });

  it("is scoped to the member — another member's invoice is not blocked", async () => {
    expect(await storage.hasActiveInvoicePayout(ORG_ID, INV_A, "1", M2)).toBe(false);
  });

  it("excludes VOID payouts so a re-send can recreate a voided one", async () => {
    expect(await storage.hasActiveInvoicePayout(ORG_ID, INV_B, "2", M1)).toBe(false);
  });

  it("matches a legacy (pre-column) payout via the exact notes prefix", async () => {
    expect(await storage.hasActiveInvoicePayout(ORG_ID, INV_TEN, "10", M1)).toBe(true);
  });

  it("does NOT cross-match invoice '1' against the legacy 'Invoice 10' payout (substring bug fixed)", async () => {
    // Old check `notes.includes("Invoice 1")` matched "Invoice 10" → false skip.
    // INV_A's own payout is keyed on sourceInvoiceId (=INV_A), so asking about a
    // DIFFERENT invoice id with number "1" must not be blocked by it either.
    const someOtherInvoiceWithNumber1 = randomUUID();
    expect(await storage.hasActiveInvoicePayout(ORG_ID, someOtherInvoiceWithNumber1, "1", M1)).toBe(false);
  });
});
