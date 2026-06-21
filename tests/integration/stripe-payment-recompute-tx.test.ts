/**
 * Audit #8/#14: createStripePayment opened a transaction, took SELECT ... FOR
 * UPDATE on the invoice row, inserted the payment, then called
 * recomputeInvoicePaidStatus on the BASE pool (a different connection). That
 * recompute's UPDATE of the same invoice row blocked on the FOR UPDATE lock held
 * by the still-open transaction, which was awaiting the recompute's promise — a
 * self-deadlock with no statement timeout to break it, so the call hung forever
 * and pinned pool connections.
 *
 * The fix threads the transaction into recompute (executor = tx), so the UPDATE
 * runs on the same connection that holds the lock. This test calls
 * createStripePayment against a real DB and asserts it COMPLETES (a short
 * timeout — the pre-fix code would hang past it) and recomputes the invoice paid
 * status correctly.
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
import { orgs, invoices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../server/storage";

const ORG_ID = randomUUID();
const CLIENT_ID = randomUUID();
const INV_FULL = randomUUID();
const INV_PARTIAL = randomUUID();

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
  await db.insert(orgs).values({ id: ORG_ID, name: "Stripe Tx Test Org", slug: `stripe-tx-${ORG_ID.slice(0, 8)}` });
  await pool.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $2, 'Stripe Tx Client')`, [CLIENT_ID, ORG_ID]);
  await seedInvoice(INV_FULL, "100");
  await seedInvoice(INV_PARTIAL, "100");
}, 30_000);

afterAll(async () => {
  await pool.query(`DELETE FROM payments WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM invoices WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
  await pool.query(`DELETE FROM clients WHERE org_id = $1`, [ORG_ID]).catch(() => undefined);
});

describe("createStripePayment recomputes in-tx without self-deadlock (audit #8/#14)", () => {
  it("a full Stripe payment completes (no deadlock) and marks the invoice PAID", async () => {
    const result = await storage.createStripePayment({
      orgId: ORG_ID,
      invoiceId: INV_FULL,
      amount: "100",
      date: "2026-01-05",
      method: "STRIPE",
      provider: "STRIPE",
      providerRef: `pi_${randomUUID()}`,
      notes: "full payment",
    } as any);

    expect(result.status).toBe("OK");
    expect(result.status === "OK" && result.payment.id).toBeTruthy();
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, INV_FULL));
    expect(inv.status).toBe("PAID");
    expect(Number(inv.paidAmount)).toBeCloseTo(100, 2);
  }, 15_000); // pre-fix code self-deadlocks and blows this timeout

  it("a partial Stripe payment completes and marks the invoice PARTIAL", async () => {
    const result = await storage.createStripePayment({
      orgId: ORG_ID,
      invoiceId: INV_PARTIAL,
      amount: "40",
      date: "2026-01-05",
      method: "STRIPE",
      provider: "STRIPE",
      providerRef: `pi_${randomUUID()}`,
      notes: "partial payment",
    } as any);

    expect(result.status).toBe("OK");
    expect(result.status === "OK" && result.payment.id).toBeTruthy();
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, INV_PARTIAL));
    expect(inv.status).toBe("PARTIAL");
    expect(Number(inv.paidAmount)).toBeCloseTo(40, 2);
  }, 15_000);
});
