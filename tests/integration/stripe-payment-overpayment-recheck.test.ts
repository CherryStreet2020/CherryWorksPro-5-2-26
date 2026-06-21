/**
 * Audit #20: Stripe checkout overpayment race.
 *
 * The webhook's overpayment guard read invoice.paidAmount from an UNLOCKED fetch
 * and was never re-evaluated inside the write transaction. Two genuinely distinct
 * concurrent checkout sessions for the same invoice (distinct payment_intents ->
 * distinct event ids, so the stripe_events unique index does NOT block them) could
 * both read paidAmount=0, both pass the guard, and both insert — overpaying the
 * invoice (paidAmount > total, status=PAID) and over-crediting AR in the GL.
 *
 * The fix re-checks the overpayment condition UNDER the invoice FOR UPDATE lock in
 * createStripePayment: the lock serializes the two writers, the loser re-reads the
 * committed balance and is rejected (status OVERPAYMENT) instead of inserting.
 *
 * These tests run real concurrent createStripePayment calls against Postgres and
 * pin the new under-lock recheck contract: one OK + one OVERPAYMENT, with paidAmount
 * capped at the invoice total. The pre-fix code returned an uncapped double-insert
 * that drove paidAmount to 200 (verified by neutering the recheck → both insert).
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
import { orgs, invoices, payments } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../../server/storage";

const ORG_ID = randomUUID();
const CLIENT_ID = randomUUID();
const INV_RACE = randomUUID();
const INV_SEQ = randomUUID();
const INV_DUP = randomUUID();

async function seedInvoice(id: string, total: string): Promise<void> {
  await pool.query(
    `INSERT INTO invoices
       (id, org_id, client_id, number, status, issued_date, due_date, currency,
        exchange_rate, subtotal, discount_type, discount_value, discount_amount,
        tax_rate, tax_amount, total, paid_amount)
     VALUES ($1, $2, $3, $4, 'SENT', '2026-01-01', '2026-01-31', 'USD', '1', $5,
             'NONE', '0', '0', '0', '0', $5, '0')`,
    [id, ORG_ID, CLIENT_ID, `INV-${id.slice(0, 8)}`, total],
  );
}

beforeAll(async () => {
  // Hermeticity: the partial unique index is created by drizzle-kit push at boot
  // (the repo's authoritative index mechanism) and by migrate-production.ts, but the
  // unique-index assertion below must not silently depend on how this DB was
  // provisioned. Ensure it exists regardless. (IF NOT EXISTS → no-op when present.)
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS payments_org_provider_ref_unique ON payments(org_id, provider, provider_ref) WHERE provider_ref IS NOT NULL`,
  );
  await db.insert(orgs).values({ id: ORG_ID, name: "Overpay Test Org", slug: `overpay-${ORG_ID.slice(0, 8)}` });
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $2, 'Overpay Client')`, [CLIENT_ID, ORG_ID]);
  await seedInvoice(INV_RACE, "100");
  await seedInvoice(INV_SEQ, "100");
  await seedInvoice(INV_DUP, "1000");
}, 30_000);

afterAll(async () => {
  await pool.query(`DELETE FROM payments WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM invoices WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM clients WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM orgs WHERE id = $1`, [ORG_ID]).catch(() => undefined);
});

function makePayment(invoiceId: string, amount: string) {
  return {
    orgId: ORG_ID,
    invoiceId,
    amount,
    date: "2026-01-05",
    method: "STRIPE",
    provider: "STRIPE",
    providerRef: `pi_${randomUUID()}`,
    notes: "stripe checkout",
  } as any;
}

describe("createStripePayment rejects overpayment under the row lock (audit #20)", () => {
  it("two genuinely concurrent full payments resolve to one OK + one OVERPAYMENT — never overpaid", async () => {
    // Distinct providerRefs (distinct payment_intents) so the unique index does
    // NOT short-circuit this — the FOR UPDATE re-check is what must catch it.
    const [a, b] = await Promise.all([
      storage.createStripePayment(makePayment(INV_RACE, "100")),
      storage.createStripePayment(makePayment(INV_RACE, "100")),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["OK", "OVERPAYMENT"]);

    // Exactly one payment row persisted; invoice paid in full, not overpaid.
    const rows = await db.select().from(payments).where(and(eq(payments.invoiceId, INV_RACE), eq(payments.orgId, ORG_ID)));
    expect(rows).toHaveLength(1);

    const [inv] = await db.select().from(invoices).where(eq(invoices.id, INV_RACE));
    expect(Number(inv.paidAmount)).toBeCloseTo(100, 2);
    expect(Number(inv.paidAmount)).toBeLessThanOrEqual(Number(inv.total));
    expect(inv.status).toBe("PAID");
  }, 20_000);

  it("a sequential second full payment is rejected as OVERPAYMENT and does not change the balance", async () => {
    const first = await storage.createStripePayment(makePayment(INV_SEQ, "100"));
    expect(first.status).toBe("OK");

    const second = await storage.createStripePayment(makePayment(INV_SEQ, "100"));
    expect(second.status).toBe("OVERPAYMENT");
    if (second.status === "OVERPAYMENT") {
      expect(second.currentPaid).toBeCloseTo(100, 2);
      expect(second.invoiceTotal).toBeCloseTo(100, 2);
      expect(second.attempted).toBeCloseTo(100, 2);
    }

    const rows = await db.select().from(payments).where(and(eq(payments.invoiceId, INV_SEQ), eq(payments.orgId, ORG_ID)));
    expect(rows).toHaveLength(1);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, INV_SEQ));
    expect(Number(inv.paidAmount)).toBeCloseTo(100, 2);
    expect(inv.status).toBe("PAID");
  }, 20_000);

  it("an exact full payment (newPaid === total) is still accepted", async () => {
    // INV_DUP total is 1000; pay it exactly to confirm the > comparison (not >=)
    // does not reject a legitimate full settlement.
    const exact = await storage.createStripePayment(makePayment(INV_DUP, "1000"));
    expect(exact.status).toBe("OK");
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, INV_DUP));
    expect(inv.status).toBe("PAID");
    // reset INV_DUP for the unique-index test below
    await pool.query(`DELETE FROM payments WHERE invoice_id = $1`, [INV_DUP]);
    await pool.query(`UPDATE invoices SET paid_amount = '0', status = 'SENT' WHERE id = $1`, [INV_DUP]);
  }, 20_000);

  it("the partial unique index blocks a second payment row for the same provider ref (defense-in-depth)", async () => {
    // Same (orgId, provider, providerRef); large invoice total so the overpayment
    // re-check passes and the UNIQUE index is what rejects the duplicate insert.
    const ref = `pi_dup_${randomUUID()}`;
    const base = { ...makePayment(INV_DUP, "10"), providerRef: ref };

    const first = await storage.createStripePayment({ ...base });
    expect(first.status).toBe("OK");

    await expect(storage.createStripePayment({ ...base })).rejects.toThrow(/duplicate key|unique/i);

    const rows = await db.select().from(payments).where(and(eq(payments.invoiceId, INV_DUP), eq(payments.orgId, ORG_ID)));
    expect(rows).toHaveLength(1);
  }, 20_000);
});
