/**
 * Auto-post-on-paid invoice spec (Task #438, audit §7 item 13).
 *
 * Mints a COA + a SENT invoice via direct DB inserts, then records a
 * full payment via POST /api/payments and verifies a PAYMENT-sourced
 * journal entry was auto-created against the 1000/1200 control
 * accounts.
 *
 * ── Behavioural finding documented here ─────────────────────────────
 * `orgs.auto_post_journal_entries` defaults to true and gates the
 * expense-reimbursement and payout auto-post paths. The
 * `POST /api/payments` route, however, ALWAYS calls
 * createAutoJournalEntry regardless of that flag (server/routes/
 * payment-routes.ts:91). So this spec asserts the actual current
 * behaviour: the JE is created in BOTH flag states.
 *
 * The flag-off branch carries a `expect(jeAfter).toBeGreaterThan(...)`
 * assertion + a comment so a future code-change that wires the flag
 * into the payment path will explicitly need to update this spec —
 * keeping the audit-finding visible in CI rather than buried in the
 * gap-tracker.
 * ────────────────────────────────────────────────────────────────────
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { seedCoa } from "./_gl-helpers";
import { Pool } from "pg";

let _pool: Pool | null = null;
function pool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

test.afterAll(async () => {
  if (_pool) {
    await _pool.end().catch(() => undefined);
    _pool = null;
  }
});

/**
 * The shared teardown in tests/helpers/po/isolation.ts deletes per-
 * org tables in information_schema order, which lands on `clients`
 * before `client_activities`. The createPayment path side-effects a
 * client_activities row (FK → clients with no cascade), so we
 * pro-actively clean those up here for any org we touched.
 */
test.afterEach(async ({ isolatedOrg }) => {
  // The shared teardown deletes per-org tables in alphabetical
  // (information_schema) order — `clients` lands BEFORE `invoices`
  // and `client_activities`, both of which carry FKs into clients
  // without ON DELETE CASCADE. Pre-clean the dependent rows here.
  const p = pool();
  for (const sql of [
    `DELETE FROM payments WHERE org_id = $1`,
    `DELETE FROM invoice_lines WHERE org_id = $1`,
    `DELETE FROM invoices WHERE org_id = $1`,
    `DELETE FROM client_activities WHERE org_id = $1`,
  ]) {
    await p.query(sql, [isolatedOrg.orgId]).catch(() => undefined);
  }
});

async function setAutoPostFlag(orgId: string, value: boolean): Promise<void> {
  await pool().query(
    `UPDATE orgs SET auto_post_journal_entries = $1 WHERE id = $2`,
    [value, orgId],
  );
}

async function makeSentInvoice(
  orgId: string,
  amount: string,
): Promise<string> {
  // Minimal client.
  const client = await pool().query(
    `INSERT INTO clients (org_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, `auto-post test client ${Date.now()}`],
  );
  const clientId = client.rows[0].id as string;

  const today = new Date().toISOString().slice(0, 10);
  const due = today;
  const number = `INV-AP-${Date.now()}`;
  const inv = await pool().query(
    `INSERT INTO invoices
       (org_id, client_id, number, status, issued_date, due_date,
        currency, exchange_rate, subtotal, discount_type, discount_value,
        discount_amount, tax_rate, tax_amount, total, paid_amount)
     VALUES ($1, $2, $3, 'SENT', $4, $5, 'USD', '1', $6, 'NONE', '0',
             '0', '0', '0', $6, '0')
     RETURNING id`,
    [orgId, clientId, number, today, due, amount],
  );
  const invoiceId = inv.rows[0].id as string;

  await pool().query(
    `INSERT INTO invoice_lines
       (org_id, invoice_id, description, quantity, unit_rate, amount)
     VALUES ($1, $2, 'auto-post test line', 1, $3, $3)`,
    [orgId, invoiceId, amount],
  );

  return invoiceId;
}

async function countPaymentJEs(
  iso: { request: any; orgId: string },
): Promise<number> {
  const start = "1990-01-01";
  const end = `${new Date().getFullYear() + 1}-12-31`;
  const r = await iso.request.get(
    `/api/gl/journal-entries?startDate=${start}&endDate=${end}&sourceType=PAYMENT`,
  );
  if (r.status() !== 200) return 0;
  const list = await r.json();
  return Array.isArray(list) ? list.length : 0;
}

test.describe.configure({ mode: "serial" });

test.describe("Auto-post on paid invoice (Task #438)", () => {
  test("flag=true: payment creates a PAYMENT-sourced JE", async ({
    isolatedOrg,
  }) => {
    await seedCoa(isolatedOrg);
    await setAutoPostFlag(isolatedOrg.orgId, true);
    const before = await countPaymentJEs(isolatedOrg);

    const invoiceId = await makeSentInvoice(isolatedOrg.orgId, "200.00");

    const r = await isolatedOrg.request.post("/api/payments", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        invoiceId,
        amount: 200,
        date: new Date().toISOString().slice(0, 10),
        method: "ACH",
      },
    });
    expect(r.status(), await r.text()).toBe(200);

    const after = await countPaymentJEs(isolatedOrg);
    expect(after).toBeGreaterThan(before);
  });

  test("flag=false: payment route currently still creates the JE (audit gap documented)", async ({
    isolatedOrg,
  }) => {
    await seedCoa(isolatedOrg);
    await setAutoPostFlag(isolatedOrg.orgId, false);
    const before = await countPaymentJEs(isolatedOrg);

    const invoiceId = await makeSentInvoice(isolatedOrg.orgId, "150.00");

    const r = await isolatedOrg.request.post("/api/payments", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: {
        invoiceId,
        amount: 150,
        date: new Date().toISOString().slice(0, 10),
        method: "ACH",
      },
    });
    expect(r.status(), await r.text()).toBe(200);

    const after = await countPaymentJEs(isolatedOrg);
    // Documenting the actual behaviour: the payment route ignores the
    // org-level autoPostJournalEntries flag and ALWAYS posts. If a
    // future PR wires the flag in, flip this expectation to .toBe(before).
    expect(after).toBeGreaterThan(before);
  });
});
