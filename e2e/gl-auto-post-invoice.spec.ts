import { test, expect } from "../tests/helpers/po/fixtures";
import { seedCoa } from "./_gl-helpers";
import { Pool } from "pg";

interface JournalEntryRow {
  id: number;
  sourceType: string | null;
  sourceRef: string | null;
  sourceId: number | null;
}

interface JournalEntryWithLines extends JournalEntryRow {
  lines: { accountId: number; debit: string; credit: string }[];
}

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

test.afterEach(async ({ isolatedOrg }) => {
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

async function makeSentInvoice(orgId: string, amount: string): Promise<string> {
  const client = await pool().query(
    `INSERT INTO clients (org_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, `auto-post test client ${Date.now()}`],
  );
  const clientId = client.rows[0].id as string;

  const today = new Date().toISOString().slice(0, 10);
  const number = `INV-AP-${Date.now()}`;
  const inv = await pool().query(
    `INSERT INTO invoices
       (org_id, client_id, number, status, issued_date, due_date,
        currency, exchange_rate, subtotal, discount_type, discount_value,
        discount_amount, tax_rate, tax_amount, total, paid_amount)
     VALUES ($1, $2, $3, 'SENT', $4, $4, 'USD', '1', $5, 'NONE', '0',
             '0', '0', '0', $5, '0')
     RETURNING id`,
    [orgId, clientId, number, today, amount],
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

async function paymentJEs(
  iso: { request: import("@playwright/test").APIRequestContext },
): Promise<JournalEntryRow[]> {
  const r = await iso.request.get(
    `/api/gl/journal-entries?startDate=1990-01-01&endDate=2099-12-31&sourceType=PAYMENT`,
  );
  if (r.status() !== 200) return [];
  const list = (await r.json()) as JournalEntryRow[];
  return Array.isArray(list) ? list : [];
}

test.describe.configure({ mode: "serial" });

test.describe("Auto-post on paid invoice", () => {
  test("flag=true: payment creates a PAYMENT-sourced JE", async ({ isolatedOrg }) => {
    await seedCoa(isolatedOrg);
    await setAutoPostFlag(isolatedOrg.orgId, true);

    const before = (await paymentJEs(isolatedOrg)).length;
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
    const payment = (await r.json()) as { id: string };

    const after = await paymentJEs(isolatedOrg);
    expect(after.length).toBe(before + 1);
    const created = after.find((j) => j.sourceRef === payment.id);
    expect(created).toBeTruthy();

    // Cross-check the actual debit/credit lines: a payment-sourced JE must
    // debit Cash (1000) and credit AR (1200) for the payment amount.
    const detail = (await isolatedOrg.request
      .get(`/api/gl/journal-entries/${created!.id}`)
      .then((r) => r.json())) as JournalEntryWithLines;
    expect(detail.lines.length).toBeGreaterThanOrEqual(2);
    const totalDebit = detail.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = detail.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(200, 2);
    expect(totalCredit).toBeCloseTo(200, 2);

    const accts = await isolatedOrg.request
      .get(`/api/gl/accounts`)
      .then((r) => r.json()) as Array<{ id: number; accountNumber: string }>;
    const cash = accts.find((a) => a.accountNumber === "1000")!;
    const ar = accts.find((a) => a.accountNumber === "1200")!;
    expect(detail.lines.some((l) => l.accountId === cash.id && Number(l.debit) > 0)).toBe(true);
    expect(detail.lines.some((l) => l.accountId === ar.id && Number(l.credit) > 0)).toBe(true);
  });

  test("flag=false: payment skips auto-JE", async ({ isolatedOrg }) => {
    await seedCoa(isolatedOrg);
    await setAutoPostFlag(isolatedOrg.orgId, false);

    const before = (await paymentJEs(isolatedOrg)).length;
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
    const payment = (await r.json()) as { id: string };

    const after = await paymentJEs(isolatedOrg);
    expect(after.length).toBe(before);
    expect(after.some((j) => j.sourceRef === payment.id)).toBe(false);
  });

  test("closed period: payment into closed date is rejected and no auto-JE is created", async ({
    isolatedOrg,
  }) => {
    await seedCoa(isolatedOrg);
    await setAutoPostFlag(isolatedOrg.orgId, true);

    const periodStart = "1993-01-01";
    const periodEnd = "1993-01-31";
    const within = "1993-01-15";

    const created = await isolatedOrg.request.post("/api/close-periods", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { periodStart, periodEnd },
    });
    expect([200, 201]).toContain(created.status());
    const period = (await created.json()) as { id: string };
    const closeRes = await isolatedOrg.request.post(
      `/api/close-periods/${period.id}/close`,
      { headers: { "x-csrf-token": isolatedOrg.csrf } },
    );
    expect(closeRes.status()).toBe(200);

    const before = (await paymentJEs(isolatedOrg)).length;
    const invoiceId = await makeSentInvoice(isolatedOrg.orgId, "175.00");

    const r = await isolatedOrg.request.post("/api/payments", {
      headers: { "x-csrf-token": isolatedOrg.csrf },
      data: { invoiceId, amount: 175, date: within, method: "ACH" },
    });
    expect(r.status()).toBeGreaterThanOrEqual(400);

    const after = await paymentJEs(isolatedOrg);
    expect(after.length).toBe(before);
  });
});
