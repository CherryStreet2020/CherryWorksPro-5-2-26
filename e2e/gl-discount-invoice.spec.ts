/**
 * Audit #6/7/15/16: a discounted invoice never posted to the GL. The auto-journal
 * built DR 1200 (AR)=total / CR 4000 (Revenue)=subtotal / CR 2300 (Tax)=tax with
 * no discount line, so debits fell short of credits by the discount and the
 * balance check silently dropped the entry. The fix adds a contra-revenue
 * "Sales Discounts" (4100) DEBIT line. This proves a discounted invoice now posts
 * a BALANCED entry that includes the 4100 line — and that repost-gl reports the
 * real result (#16) rather than a false success.
 *
 * Models e2e/gl-auto-post-invoice.spec.ts (isolatedOrg fixture + direct-SQL
 * invoices + /api/gl/journal-entries).
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import { seedCoa } from "./_gl-helpers";
import { Pool } from "pg";

interface JEWithLines {
  id: number;
  sourceRef: string | null;
  lines: { accountId: number; debit: string; credit: string }[];
}

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}
test.afterAll(async () => {
  if (_pool) { await _pool.end().catch(() => undefined); _pool = null; }
});
test.afterEach(async ({ isolatedOrg }) => {
  const p = pool();
  for (const sql of [
    `DELETE FROM invoice_lines WHERE org_id = $1`,
    `DELETE FROM invoices WHERE org_id = $1`,
    `DELETE FROM client_activities WHERE org_id = $1`,
  ]) {
    await p.query(sql, [isolatedOrg.orgId]).catch(() => undefined);
  }
});

/** Insert a discounted SENT invoice (no GL entry yet) with explicit totals. */
async function makeDiscountedInvoice(
  orgId: string,
  v: { subtotal: string; discountType: string; discountValue: string; discountAmount: string; taxAmount: string; total: string },
): Promise<string> {
  const client = await pool().query(
    `INSERT INTO clients (org_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, `discount test client ${Date.now()}`],
  );
  const clientId = client.rows[0].id as string;
  const today = new Date().toISOString().slice(0, 10);
  const inv = await pool().query(
    `INSERT INTO invoices
       (org_id, client_id, number, status, issued_date, due_date, currency,
        exchange_rate, subtotal, discount_type, discount_value, discount_amount,
        tax_rate, tax_amount, total, paid_amount)
     VALUES ($1, $2, $3, 'SENT', $4, $4, 'USD', '1', $5, $6, $7, $8, '0', $9, $10, '0')
     RETURNING id`,
    [orgId, clientId, `INV-DISC-${Date.now()}`, today, v.subtotal, v.discountType, v.discountValue, v.discountAmount, v.taxAmount, v.total],
  );
  const invoiceId = inv.rows[0].id as string;
  await pool().query(
    `INSERT INTO invoice_lines (org_id, invoice_id, description, quantity, unit_rate, amount)
     VALUES ($1, $2, 'discount test line', 1, $3, $3)`,
    [orgId, invoiceId, v.subtotal],
  );
  return invoiceId;
}

async function postedInvoiceJE(iso: { request: import("@playwright/test").APIRequestContext }, invoiceId: string): Promise<JEWithLines | null> {
  const list = await iso.request
    .get(`/api/gl/journal-entries?startDate=1990-01-01&endDate=2099-12-31&sourceType=INVOICE`)
    .then((r) => (r.ok() ? r.json() : []));
  const hit = (Array.isArray(list) ? list : []).find((j: any) => j.sourceRef === invoiceId);
  if (!hit) return null;
  return iso.request.get(`/api/gl/journal-entries/${hit.id}`).then((r) => r.json());
}

test.describe.configure({ mode: "serial" });

test.describe("Discounted invoices post a balanced GL entry (audit #6/7/15/16)", () => {
  test("FIXED discount, no tax: posts DR AR + DR Sales Discounts == CR Revenue", async ({ isolatedOrg }) => {
    const accts = await seedCoa(isolatedOrg);
    const a = (n: string) => accts.find((x) => x.accountNumber === n)!;
    expect(a("4100"), "4100 Sales Discounts must be seeded").toBeTruthy();

    // subtotal 1000, FIXED discount 100, no tax -> total 900.
    const invoiceId = await makeDiscountedInvoice(isolatedOrg.orgId, {
      subtotal: "1000", discountType: "FIXED", discountValue: "100", discountAmount: "100", taxAmount: "0", total: "900",
    });

    const r = await isolatedOrg.request.post(`/api/invoices/${invoiceId}/repost-gl`, {
      headers: { "x-csrf-token": isolatedOrg.csrf },
    });
    expect(r.status(), await r.text()).toBe(200);
    expect((await r.json()).ok).toBe(true); // #16: real success, entry actually posted

    const je = await postedInvoiceJE(isolatedOrg, invoiceId);
    expect(je, "a journal entry was posted for the discounted invoice").toBeTruthy();
    const lines = je!.lines;
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2); // BALANCED — the whole point
    expect(totalCredit).toBeCloseTo(1000, 2); // gross revenue not understated

    // DR AR 900, CR Revenue 1000, DR Sales Discounts 100.
    expect(lines.some((l) => l.accountId === a("1200").id && Number(l.debit) === 900)).toBe(true);
    expect(lines.some((l) => l.accountId === a("4000").id && Number(l.credit) === 1000)).toBe(true);
    expect(lines.some((l) => l.accountId === a("4100").id && Number(l.debit) === 100)).toBe(true);
  });

  test("PERCENT discount + tax: entry still balances with the discount line", async ({ isolatedOrg }) => {
    const accts = await seedCoa(isolatedOrg);
    const a = (n: string) => accts.find((x) => x.accountNumber === n)!;

    // subtotal 1000, 10% discount (100), tax 72 (8% on 900) -> total 972.
    const invoiceId = await makeDiscountedInvoice(isolatedOrg.orgId, {
      subtotal: "1000", discountType: "PERCENT", discountValue: "10", discountAmount: "100", taxAmount: "72", total: "972",
    });

    const r = await isolatedOrg.request.post(`/api/invoices/${invoiceId}/repost-gl`, {
      headers: { "x-csrf-token": isolatedOrg.csrf },
    });
    expect(r.status(), await r.text()).toBe(200);

    const je = await postedInvoiceJE(isolatedOrg, invoiceId);
    expect(je).toBeTruthy();
    const lines = je!.lines;
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
    expect(totalCredit).toBeCloseTo(1072, 2); // CR Revenue 1000 + CR Tax 72
    expect(lines.some((l) => l.accountId === a("4100").id && Number(l.debit) === 100)).toBe(true);
    expect(lines.some((l) => l.accountId === a("2300").id && Number(l.credit) === 72)).toBe(true);
  });

  test("non-discounted invoice still posts with no Sales Discounts line", async ({ isolatedOrg }) => {
    const accts = await seedCoa(isolatedOrg);
    const a = (n: string) => accts.find((x) => x.accountNumber === n)!;
    const invoiceId = await makeDiscountedInvoice(isolatedOrg.orgId, {
      subtotal: "500", discountType: "NONE", discountValue: "0", discountAmount: "0", taxAmount: "0", total: "500",
    });
    const r = await isolatedOrg.request.post(`/api/invoices/${invoiceId}/repost-gl`, {
      headers: { "x-csrf-token": isolatedOrg.csrf },
    });
    expect(r.status()).toBe(200);
    const je = await postedInvoiceJE(isolatedOrg, invoiceId);
    expect(je).toBeTruthy();
    expect(je!.lines.some((l) => l.accountId === a("4100").id)).toBe(false); // no spurious discount line
  });
});
