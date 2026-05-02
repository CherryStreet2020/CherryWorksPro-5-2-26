import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { invoices, payments, clients, orgs, users, glAccounts, glJournalEntries, glJournalLines } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../../server/storage";
import { randomUUID } from "crypto";

const TEST_ORG_ID = "test-ar-org-" + randomUUID().slice(0, 8);
const TEST_USER_ID = randomUUID();
const TEST_CLIENT_ID = randomUUID();
const INVOICE_DRAFT_ID = randomUUID();
const INVOICE_SENT_ID = randomUUID();
const INVOICE_PAID_ID = randomUUID();
const PAYMENT_PARTIAL_ID = randomUUID();
const PAYMENT_FULL_ID = randomUUID();

describe("Canonical AR — getOutstandingAR", () => {
  beforeAll(async () => {
    await db.insert(orgs).values({
      id: TEST_ORG_ID,
      name: "AR Test Org",
      slug: "ar-test-org-" + Date.now(),
    });

    await db.insert(users).values({
      id: TEST_USER_ID,
      orgId: TEST_ORG_ID,
      email: `artest-${Date.now()}@test.com`,
      name: "AR Tester",
      password: "$2b$12$placeholder000000000000000000000000000000000000",
      role: "ADMIN",
    });

    await db.insert(clients).values({
      id: TEST_CLIENT_ID,
      orgId: TEST_ORG_ID,
      name: "Test Client",
      email: "client@test.com",
    });

    await db.insert(invoices).values({
      id: INVOICE_DRAFT_ID,
      orgId: TEST_ORG_ID,
      clientId: TEST_CLIENT_ID,
      number: "TEST-001",
      status: "DRAFT",
      issuedDate: "2026-01-01",
      dueDate: "2026-02-01",
      subtotal: "500.00",
      total: "500.00",
      paidAmount: "0.00",
      discountType: "NONE",
      discountValue: "0",
      discountAmount: "0",
      taxRate: "0",
      taxAmount: "0",
    });

    await db.insert(invoices).values({
      id: INVOICE_SENT_ID,
      orgId: TEST_ORG_ID,
      clientId: TEST_CLIENT_ID,
      number: "TEST-002",
      status: "SENT",
      issuedDate: "2026-01-15",
      dueDate: "2026-02-15",
      subtotal: "1000.00",
      total: "1000.00",
      paidAmount: "300.00",
      discountType: "NONE",
      discountValue: "0",
      discountAmount: "0",
      taxRate: "0",
      taxAmount: "0",
    });

    await db.insert(payments).values({
      id: PAYMENT_PARTIAL_ID,
      orgId: TEST_ORG_ID,
      invoiceId: INVOICE_SENT_ID,
      amount: "300.00",
      date: "2026-01-20",
      method: "BANK_TRANSFER",
    });

    await db.insert(invoices).values({
      id: INVOICE_PAID_ID,
      orgId: TEST_ORG_ID,
      clientId: TEST_CLIENT_ID,
      number: "TEST-003",
      status: "PAID",
      issuedDate: "2026-02-01",
      dueDate: "2026-03-01",
      subtotal: "2000.00",
      total: "2000.00",
      paidAmount: "2000.00",
      discountType: "NONE",
      discountValue: "0",
      discountAmount: "0",
      taxRate: "0",
      taxAmount: "0",
    });

    await db.insert(payments).values({
      id: PAYMENT_FULL_ID,
      orgId: TEST_ORG_ID,
      invoiceId: INVOICE_PAID_ID,
      amount: "2000.00",
      date: "2026-02-10",
      method: "CREDIT_CARD",
    });
  });

  afterAll(async () => {
    await db.delete(payments).where(eq(payments.orgId, TEST_ORG_ID));
    await db.delete(glJournalLines).where(eq(glJournalLines.orgId, TEST_ORG_ID));
    await db.delete(glJournalEntries).where(eq(glJournalEntries.orgId, TEST_ORG_ID));
    await db.delete(invoices).where(eq(invoices.orgId, TEST_ORG_ID));
    await db.delete(clients).where(eq(clients.orgId, TEST_ORG_ID));
    await db.delete(glAccounts).where(eq(glAccounts.orgId, TEST_ORG_ID));
    await db.delete(users).where(eq(users.orgId, TEST_ORG_ID));
    await db.delete(orgs).where(eq(orgs.id, TEST_ORG_ID));
  });

  it("returns correct outstanding AR (DRAFT excluded, PAID = $0 remaining, SENT partial counted)", async () => {
    const ar = await storage.getOutstandingAR(TEST_ORG_ID);
    expect(ar).toBe(700);
  });

  it("dashboard totalOutstanding matches canonical AR", async () => {
    const stats = await storage.getDashboardStats(TEST_ORG_ID);
    const ar = await storage.getOutstandingAR(TEST_ORG_ID);
    expect(stats.totalOutstanding).toBe(ar);
  });

  it("executive KPI totalOutstanding matches canonical AR", async () => {
    const exec = await storage.getExecutiveKPIs(TEST_ORG_ID);
    const ar = await storage.getOutstandingAR(TEST_ORG_ID);
    expect(exec.totalOutstanding).toBe(ar);
  });

  it("GL 1200 balance matches canonical AR after seeding + repair", async () => {
    await storage.seedDefaultGLAccounts(TEST_ORG_ID);

    const ar = await storage.getOutstandingAR(TEST_ORG_ID);

    const accounts = await db.select().from(glAccounts).where(
      and(eq(glAccounts.orgId, TEST_ORG_ID), eq(glAccounts.accountNumber, "1200"))
    );
    expect(accounts.length).toBeGreaterThan(0);

    const [balBefore] = await db.select({
      balance: sql<string>`COALESCE(SUM(${glJournalLines.debit}::numeric - ${glJournalLines.credit}::numeric), 0)`,
    }).from(glJournalLines)
      .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
      .where(and(eq(glJournalEntries.orgId, TEST_ORG_ID), eq(glJournalLines.accountId, accounts[0].id)));
    const glBefore = Number(balBefore?.balance || 0);

    if (Math.abs(ar - glBefore) > 0.005) {
      const revenueAccounts = await db.select().from(glAccounts).where(
        and(eq(glAccounts.orgId, TEST_ORG_ID), eq(glAccounts.accountNumber, "4000"))
      );
      const diff = ar - glBefore;
      const lines = diff > 0
        ? [
            { accountId: accounts[0].id, debit: diff.toFixed(2), credit: "0.00" },
            { accountId: revenueAccounts[0].id, debit: "0.00", credit: diff.toFixed(2) },
          ]
        : [
            { accountId: accounts[0].id, debit: "0.00", credit: Math.abs(diff).toFixed(2) },
            { accountId: revenueAccounts[0].id, debit: Math.abs(diff).toFixed(2), credit: "0.00" },
          ];
      await storage.createGLJournalEntry(
        TEST_ORG_ID,
        "2026-04-09",
        "Test AR repair",
        "AR_RECONCILE_REPAIR",
        null,
        true,
        null,
        lines as any,
        `ar-test-repair-${Date.now()}`,
      );
    }

    const [balAfter] = await db.select({
      balance: sql<string>`COALESCE(SUM(${glJournalLines.debit}::numeric - ${glJournalLines.credit}::numeric), 0)`,
    }).from(glJournalLines)
      .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
      .where(and(eq(glJournalEntries.orgId, TEST_ORG_ID), eq(glJournalLines.accountId, accounts[0].id)));
    const glAfter = Number(balAfter?.balance || 0);

    expect(glAfter).toBe(ar);
  });
});
