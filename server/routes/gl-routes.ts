import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, asc, and, gte, lte, sql, inArray } from "drizzle-orm";
import { invoices, payments, expenses, teamMemberPayoutsV2, expenseCategories, glAccounts, glJournalEntries, glJournalLines, insertGlAccountSchema, round2 } from "@shared/schema";
import { sanitizeErrorMessage, requireAdmin, requireManagerOrAbove, createAutoJournalEntry, isGlPosted } from "./middleware";

export function registerGlRoutes(app: Express) {

// ══════════════════════════════════════════════════════════════════
// GENERAL LEDGER — CHART OF ACCOUNTS
// ══════════════════════════════════════════════════════════════════

app.get("/api/gl/accounts", requireManagerOrAbove, async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const accounts = await storage.getGLAccountsByOrg(req.session.orgId!, includeArchived);
    const balances = await db
      .select({
        accountId: glJournalLines.accountId,
        totalDebit: sql<string>`COALESCE(SUM(${glJournalLines.debit}), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(${glJournalLines.credit}), 0)`,
      })
      .from(glJournalLines)
      .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
      .where(eq(glJournalEntries.orgId, req.session.orgId!))
      .groupBy(glJournalLines.accountId);

    const balanceMap = new Map(balances.map(b => [b.accountId, b]));
    const result = accounts.map(acct => {
      const b = balanceMap.get(acct.id);
      const debits = Number(b?.totalDebit || 0);
      const credits = Number(b?.totalCredit || 0);
      const balance = acct.normalBalance === "DEBIT" ? debits - credits : credits - debits;
      return { ...acct, balance: balance.toFixed(2) };
    });
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/gl/accounts", requireManagerOrAbove, async (req, res) => {
  try {
    const parsed = insertGlAccountSchema.parse({ ...req.body, orgId: req.session.orgId! });
    const account = await storage.createGLAccount(parsed);
    return res.status(201).json(account);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.patch("/api/gl/accounts/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid account ID" });
    const existing = await storage.getGLAccountsByOrg(req.session.orgId!);
    const acct = existing.find(a => a.id === id);
    if (!acct) return res.status(404).json({ message: "Account not found" });
    const { name, description, accountNumber, accountType, parentAccountId, normalBalance, isActive } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (accountNumber !== undefined) updates.accountNumber = accountNumber;
    const validAccountTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
    if (accountType !== undefined && !validAccountTypes.includes(accountType)) {
      return res.status(400).json({ message: "Invalid account type" });
    }
    if (accountType !== undefined) updates.accountType = accountType;
    if (parentAccountId !== undefined) updates.parentAccountId = parentAccountId;
    if (normalBalance !== undefined) {
      if (!["DEBIT", "CREDIT"].includes(normalBalance)) return res.status(400).json({ message: "Invalid normalBalance. Must be DEBIT or CREDIT" });
      updates.normalBalance = normalBalance;
    }
    if (isActive !== undefined) updates.isActive = isActive;
    const updated = await storage.updateGLAccount(id, req.session.orgId!, updates);
    return res.json(updated);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.delete("/api/gl/accounts/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid account ID" });
    const orgId = req.session.orgId!;
    const existing = await storage.getGLAccountsByOrg(orgId, true);
    const acct = existing.find(a => a.id === id);
    if (!acct) return res.status(404).json({ message: "Account not found" });
    if (acct.isSystem) return res.status(409).json({ message: "System accounts cannot be deleted" });
    const lineCount = await db.select({ count: sql<number>`count(*)` })
      .from(glJournalLines)
      .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
      .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalLines.accountId, id)));
    const inUse = Number(lineCount[0]?.count || 0) > 0;
    if (inUse) {
      const archived = await storage.archiveGLAccount(id, orgId);
      return res.json({ message: "Account archived (has journal entries)", account: archived });
    }
    await db.delete(glAccounts).where(and(eq(glAccounts.id, id), eq(glAccounts.orgId, orgId)));
    return res.status(204).send();
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/gl/accounts/seed", requireManagerOrAbove, async (req, res) => {
  try {
    await storage.seedDefaultGLAccounts(req.session.orgId!);
    const accounts = await storage.getGLAccountsByOrg(req.session.orgId!);
    const balances = await db
      .select({
        accountId: glJournalLines.accountId,
        totalDebit: sql<string>`COALESCE(SUM(${glJournalLines.debit}), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(${glJournalLines.credit}), 0)`,
      })
      .from(glJournalLines)
      .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
      .where(eq(glJournalEntries.orgId, req.session.orgId!))
      .groupBy(glJournalLines.accountId);
    const balanceMap = new Map(balances.map(b => [b.accountId, b]));
    const result = accounts.map(acct => {
      const b = balanceMap.get(acct.id);
      const debits = Number(b?.totalDebit || 0);
      const credits = Number(b?.totalCredit || 0);
      const balance = acct.normalBalance === "DEBIT" ? debits - credits : credits - debits;
      return { ...acct, balance: balance.toFixed(2) };
    });
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});

// ══════════════════════════════════════════════════════════════════
// GENERAL LEDGER — MIGRATION (ONE-TIME REPLAY)
// ══════════════════════════════════════════════════════════════════

app.post("/api/gl/migrate", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;

    await storage.seedDefaultGLAccounts(orgId);

    const existingEntries = await storage.getGLJournalEntriesByOrg(orgId);
    if (existingEntries.length > 0) {
      return res.status(400).json({ message: `Migration skipped: ${existingEntries.length} journal entries already exist. Delete existing entries first or this is already migrated.` });
    }

    let created = 0;
    const errors: string[] = [];

    const allInvoices = await storage.getInvoicesByOrg(orgId);
    const sentOrPaidInvoices = allInvoices.filter(inv => ["SENT", "PAID", "PARTIAL"].includes(inv.status));
    for (const inv of sentOrPaidInvoices) {
      try {
        const xr = Number(inv.exchangeRate) || 1;
        const invTotal = round2((Number(inv.total) || 0) * xr);
        const invSubtotal = round2((Number(inv.subtotal) || invTotal) * xr);
        const invTax = round2((Number(inv.taxAmount) || 0) * xr);
        const entryDate = inv.issuedDate || new Date().toISOString().split("T")[0];
        const currSuffix = inv.currency && inv.currency !== "USD" ? ` (${inv.currency})` : "";
        const glLines: { accountNumber: string; debit: string; credit: string; memo?: string }[] = [
          { accountNumber: "1200", debit: round2(invTotal).toFixed(2), credit: "0.00", memo: "Accounts Receivable" },
          { accountNumber: "4000", debit: "0.00", credit: round2(invSubtotal).toFixed(2), memo: "Service Revenue" },
        ];
        if (invTax > 0) {
          glLines.push({ accountNumber: "2300", debit: "0.00", credit: round2(invTax).toFixed(2), memo: "Sales Tax Payable" });
        }
        if ((Number(inv.discountAmount) || 0) > 0) {
          // Contra-revenue plug so the entry balances (audit #6/7/15/16).
          const invDiscount = round2(invSubtotal + invTax - invTotal);
          if (invDiscount > 0) {
            glLines.push({ accountNumber: "4100", debit: invDiscount.toFixed(2), credit: "0.00", memo: "Sales Discounts" });
          }
        }
        await createAutoJournalEntry(orgId, entryDate, `Invoice ${inv.number} sent${currSuffix}`, "INVOICE", inv.id, glLines, userId);
        created++;
      } catch (e: any) {
        errors.push(`Invoice ${inv.number}: ${e.message}`);
      }
    }

    const allPayments = await storage.getPaymentsByOrg(orgId);
    const paymentsSorted = [...allPayments].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    for (const pmt of paymentsSorted) {
      try {
        const inv = allInvoices.find(i => i.id === pmt.invoiceId);
        const xr = inv ? (Number(inv.exchangeRate) || 1) : 1;
        const basePmt = round2(Number(pmt.amount) * xr);
        const pmtAmt = round2(basePmt).toFixed(2);
        const currSuffix = inv?.currency && inv.currency !== "USD" ? ` (${inv.currency})` : "";
        const label = inv ? `Payment on Invoice ${inv.number}${currSuffix}` : "Payment received";
        await createAutoJournalEntry(orgId, pmt.date, label, "PAYMENT", pmt.id, [
          { accountNumber: "1000", debit: pmtAmt, credit: "0.00", memo: "Cash received" },
          { accountNumber: "1200", debit: "0.00", credit: pmtAmt, memo: "Accounts Receivable reduced" },
        ], userId);
        created++;
      } catch (e: any) {
        errors.push(`Payment ${pmt.id}: ${e.message}`);
      }
    }

    const allPayouts = await storage.getTeamMemberPayouts(orgId);
    const completedPayouts = allPayouts.filter(p => p.status === "COMPLETED");
    const payoutsSorted = [...completedPayouts].sort((a, b) => (a.payoutDate || "").localeCompare(b.payoutDate || ""));
    for (const po of payoutsSorted) {
      try {
        const poAmt = round2(Number(po.amount)).toFixed(2);
        const teamMember = await storage.getUserById(po.teamMemberId);
        const label = teamMember ? `Payout to ${teamMember.name}` : "Payout";
        await createAutoJournalEntry(orgId, po.payoutDate, label, "PAYOUT", po.id, [
          { accountNumber: "5100", debit: poAmt, credit: "0.00", memo: "Team payout costs" },
          { accountNumber: "1000", debit: "0.00", credit: poAmt, memo: "Cash disbursed" },
        ], userId);
        created++;
      } catch (e: any) {
        errors.push(`Payout ${po.id}: ${e.message}`);
      }
    }

    const allExpenses = await storage.getExpenses(orgId);
    const approvedExpenses = allExpenses.filter(e => ["APPROVED", "REIMBURSED"].includes(e.status));
    const expensesSorted = [...approvedExpenses].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    for (const exp of expensesSorted) {
      try {
        const expAmt = round2(Number(exp.amount)).toFixed(2);
        let debitAcctNum = "6009";
        if (exp.categoryId) {
          const [cat] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, exp.categoryId));
          if (cat?.glAccountId) {
            const [glAcct] = await db.select().from(glAccounts).where(eq(glAccounts.id, cat.glAccountId));
            if (glAcct) debitAcctNum = glAcct.accountNumber;
          }
        }
        const creditAcctNum = exp.reimbursable ? "2200" : "1000";
        const creditMemo = exp.reimbursable ? "Accrued Employee Reimbursable" : "Cash paid";
        await createAutoJournalEntry(orgId, exp.date, `Expense approved: ${exp.vendor || exp.description || "Expense"}`, "EXPENSE", exp.id, [
          { accountNumber: debitAcctNum, debit: expAmt, credit: "0.00", memo: exp.vendor || exp.description || "Expense" },
          { accountNumber: creditAcctNum, debit: "0.00", credit: expAmt, memo: creditMemo },
        ], userId);
        created++;

        if (exp.status === "REIMBURSED") {
          await createAutoJournalEntry(orgId, exp.date, `Expense reimbursed: ${exp.vendor || exp.description || "Expense"}`, "EXPENSE", exp.id, [
            { accountNumber: "2200", debit: expAmt, credit: "0.00", memo: "Accrued Employee Reimbursable cleared" },
            { accountNumber: "1000", debit: "0.00", credit: expAmt, memo: "Cash disbursed" },
          ], userId);
          created++;
        }
      } catch (e: any) {
        errors.push(`Expense ${exp.id}: ${e.message}`);
      }
    }

    return res.json({
      message: "GL migration complete",
      journalEntriesCreated: created,
      invoicesProcessed: sentOrPaidInvoices.length,
      paymentsProcessed: paymentsSorted.length,
      payoutsProcessed: payoutsSorted.length,
      expensesProcessed: expensesSorted.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/gl/posted-status", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const { sourceType, sourceRef, paymentId } = req.query as { sourceType?: string; sourceRef?: string; paymentId?: string };
    const resolvedType = sourceType || (paymentId ? "PAYMENT" : undefined);
    const resolvedRef = sourceRef || paymentId;
    if (!resolvedType || !resolvedRef) return res.status(400).json({ message: "sourceType and sourceRef (or paymentId) required" });
    const [match] = await db.select({
      id: glJournalEntries.id,
      createdAt: glJournalEntries.createdAt,
    })
      .from(glJournalEntries)
      .where(and(
        eq(glJournalEntries.orgId, orgId),
        eq(glJournalEntries.sourceType, resolvedType),
        eq(glJournalEntries.sourceRef, resolvedRef),
      ))
      .limit(1);
    if (match) {
      return res.json({ posted: true, journalEntryId: match.id, postedAt: match.createdAt });
    }
    return res.json({ posted: false });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/gl/backfill-invoices", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;

    await storage.seedDefaultGLAccounts(orgId);

    const existingJEs = await storage.getGLJournalEntriesByOrg(orgId, { sourceType: "INVOICE" });
    const postedMemos = new Set(existingJEs.map(je => je.memo || ""));

    const allInvoices = await storage.getInvoicesByOrg(orgId);
    const eligible = allInvoices.filter(inv =>
      ["SENT", "PARTIAL", "PAID"].includes(inv.status) &&
      !postedMemos.has(`Invoice ${inv.number} sent`)
    );

    if (eligible.length === 0) {
      return res.json({ message: "All invoices already have GL entries", backfilledCount: 0 });
    }

    let created = 0;
    const errors: string[] = [];

    for (const inv of eligible) {
      try {
        const invTotal = Number(inv.total) || 0;
        const invSubtotal = Number(inv.subtotal) || invTotal;
        const invTax = Number(inv.taxAmount) || 0;
        const entryDate = inv.issuedDate || new Date().toISOString().split("T")[0];
        const glLines: { accountNumber: string; debit: string; credit: string; memo?: string }[] = [
          { accountNumber: "1200", debit: round2(invTotal).toFixed(2), credit: "0.00", memo: "Accounts Receivable" },
          { accountNumber: "4000", debit: "0.00", credit: round2(invSubtotal).toFixed(2), memo: "Service Revenue" },
        ];
        if (invTax > 0) {
          glLines.push({ accountNumber: "2300", debit: "0.00", credit: round2(invTax).toFixed(2), memo: "Sales Tax Payable" });
        }
        if ((Number(inv.discountAmount) || 0) > 0) {
          // Contra-revenue plug so the entry balances (audit #6/7/15/16). This
          // path uses raw (non-xr) amounts, and the plug is derived from them.
          const invDiscount = round2(invSubtotal + invTax - invTotal);
          if (invDiscount > 0) {
            glLines.push({ accountNumber: "4100", debit: invDiscount.toFixed(2), credit: "0.00", memo: "Sales Discounts" });
          }
        }
        await createAutoJournalEntry(orgId, entryDate, `Invoice ${inv.number} sent`, "INVOICE", inv.id, glLines, userId);
        created++;
      } catch (e: any) {
        errors.push(`Invoice ${inv.number}: ${e.message}`);
      }
    }

    return res.json({
      message: `Backfill complete: ${created} invoice(s) posted to GL`,
      backfilledCount: created,
      totalEligible: eligible.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

// ══════════════════════════════════════════════════════════════════
// GENERAL LEDGER — JOURNAL ENTRIES
// ══════════════════════════════════════════════════════════════════

app.get("/api/gl/journal-entries", requireManagerOrAbove, async (req, res) => {
  try {
    const filters: { startDate?: string; endDate?: string; sourceType?: string; accountId?: number } = {};
    if (req.query.startDate) filters.startDate = req.query.startDate as string;
    if (req.query.endDate) filters.endDate = req.query.endDate as string;
    if (req.query.sourceType) filters.sourceType = req.query.sourceType as string;
    if (req.query.accountId) filters.accountId = parseInt(req.query.accountId as string);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 500, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    let entries = await storage.getGLJournalEntriesByOrg(req.session.orgId!, filters, limit, offset);
    if (req.session.role !== "ADMIN") {
      entries = entries.filter((e: any) => !e.isOwnerPrivate);
    }
    return res.json(entries);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/gl/journal-entries/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid entry ID" });
    const entry = await storage.getGLJournalEntryById(id, req.session.orgId!);
    if (!entry) return res.status(404).json({ message: "Journal entry not found" });
    if ((entry as any).isOwnerPrivate && req.session.role !== "ADMIN") {
      return res.status(404).json({ message: "Journal entry not found" });
    }
    return res.json(entry);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/gl/journal-entries", requireManagerOrAbove, async (req, res) => {
  try {
    const { entryDate, memo, lines } = req.body;
    if (!entryDate) return res.status(400).json({ message: "entryDate is required" });
    if (!lines || !Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ message: "At least 2 journal lines are required" });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      if (!line.accountId) return res.status(400).json({ message: "Each line must have an accountId" });
      totalDebit = round2(totalDebit + (Number(line.debit) || 0));
      totalCredit = round2(totalCredit + (Number(line.credit) || 0));
    }
    if (totalDebit !== totalCredit) {
      return res.status(400).json({ message: `Debits ($${totalDebit.toFixed(2)}) must equal credits ($${totalCredit.toFixed(2)})` });
    }
    if (totalDebit === 0) {
      return res.status(400).json({ message: "Journal entry must have non-zero amounts" });
    }

    const orgAccounts = await storage.getGLAccountsByOrg(req.session.orgId!);
    // 4100 (Sales Discounts) is auto-managed by invoice discount posting, like
    // 4000 — manual JEs must not touch it or its balance diverges from invoice
    // discount totals (audit #6/7/15/16, Codex review).
    const controlNumbers = new Set(["1000", "1200", "2300", "4000", "4100"]);
    const controlIdSet = new Set(orgAccounts.filter(a => controlNumbers.has(a.accountNumber)).map(a => a.id));
    for (const line of lines) {
      if (controlIdSet.has(line.accountId)) {
        const acct = orgAccounts.find(a => a.id === line.accountId);
        return res.status(400).json({ message: `Account ${acct?.accountNumber} (${acct?.name}) is a control account managed by invoicing and payments. Manual journal entries cannot touch control accounts.` });
      }
    }

    if (await storage.isDateInClosedPeriod(req.session.orgId!, entryDate)) {
      return res.status(400).json({ message: `Cannot post journal entry: ${entryDate} falls in a closed accounting period. Reopen the period first.` });
    }

    const entry = await storage.createGLJournalEntry(
      req.session.orgId!,
      entryDate,
      memo || null,
      null,
      null,
      false,
      req.session.userId!,
      lines.map((l: any) => ({
        accountId: l.accountId,
        debit: (Number(l.debit) || 0).toFixed(2),
        credit: (Number(l.credit) || 0).toFixed(2),
        memo: l.memo || null,
      })),
    );
    return res.status(201).json(entry);
  } catch (err: any) { return res.status(400).json({ message: sanitizeErrorMessage(err) }); }
});

// ══════════════════════════════════════════════════════════════════
// GENERAL LEDGER — TRIAL BALANCE (alias for /api/gl/report)
// ══════════════════════════════════════════════════════════════════

app.get("/api/gl/trial-balance", requireManagerOrAbove, async (req, res) => {
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  if (!startDate && !endDate) {
    const now = new Date();
    const ytdStart = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().slice(0, 10);
    const qs = `startDate=${ytdStart}&endDate=${today}`;
    return res.redirect(`/api/gl/report?${qs}`);
  }
  const qs = new URLSearchParams();
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  return res.redirect(`/api/gl/report?${qs.toString()}`);
});

// ══════════════════════════════════════════════════════════════════
// GENERAL LEDGER — REPORT
// ══════════════════════════════════════════════════════════════════

app.get("/api/gl/report", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const accounts = await storage.getGLAccountsByOrg(orgId);

    const conditions: any[] = [eq(glJournalEntries.orgId, orgId)];
    if (startDate) conditions.push(gte(glJournalEntries.entryDate, startDate));
    if (endDate) conditions.push(lte(glJournalEntries.entryDate, endDate));

    const entries = await db
      .select()
      .from(glJournalEntries)
      .where(and(...conditions))
      .orderBy(asc(glJournalEntries.entryDate), asc(glJournalEntries.id));

    const entryIds = entries.map(e => e.id);
    let allLines: any[] = [];
    if (entryIds.length > 0) {
      allLines = await db
        .select()
        .from(glJournalLines)
        .where(inArray(glJournalLines.journalEntryId, entryIds));
    }

    const entryMap = new Map(entries.map(e => [e.id, e]));
    const linesByAccount = new Map<number, any[]>();
    for (const line of allLines) {
      const entry = entryMap.get(line.journalEntryId);
      if (!entry) continue;
      const arr = linesByAccount.get(line.accountId) || [];
      arr.push({
        lineId: line.id,
        journalEntryId: line.journalEntryId,
        entryDate: entry.entryDate,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        entryMemo: entry.memo,
        lineMemo: line.memo,
        debit: line.debit,
        credit: line.credit,
      });
      linesByAccount.set(line.accountId, arr);
    }

    const result = accounts.map(acct => {
      const lines = (linesByAccount.get(acct.id) || []).sort(
        (a: any, b: any) => a.entryDate.localeCompare(b.entryDate) || a.journalEntryId - b.journalEntryId
      );
      let totalDebit = 0;
      let totalCredit = 0;
      const linesWithBalance: any[] = [];
      let runningBalance = 0;
      for (const l of lines) {
        const d = Number(l.debit) || 0;
        const c = Number(l.credit) || 0;
        totalDebit += d;
        totalCredit += c;
        const net = acct.normalBalance === "DEBIT" ? d - c : c - d;
        runningBalance = round2(runningBalance + net);
        linesWithBalance.push({ ...l, runningBalance: runningBalance.toFixed(2) });
      }
      const balance = acct.normalBalance === "DEBIT"
        ? round2(totalDebit - totalCredit)
        : round2(totalCredit - totalDebit);
      return {
        ...acct,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        balance: balance.toFixed(2),
        lines: linesWithBalance,
      };
    });

    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/gl/account/:id/ledger", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const accountId = parseInt(req.params.id as string);
    if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

    const accounts = await storage.getGLAccountsByOrg(orgId);
    const acct = accounts.find(a => a.id === accountId);
    if (!acct) return res.status(404).json({ message: "Account not found" });

    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const conditions: any[] = [eq(glJournalEntries.orgId, orgId)];
    if (startDate) conditions.push(gte(glJournalEntries.entryDate, startDate));
    if (endDate) conditions.push(lte(glJournalEntries.entryDate, endDate));

    const entries = await db
      .select()
      .from(glJournalEntries)
      .where(and(...conditions))
      .orderBy(asc(glJournalEntries.entryDate), asc(glJournalEntries.id));

    const entryIds = entries.map(e => e.id);
    let matchingLines: any[] = [];
    if (entryIds.length > 0) {
      matchingLines = await db
        .select()
        .from(glJournalLines)
        .where(and(
          eq(glJournalLines.accountId, accountId),
          inArray(glJournalLines.journalEntryId, entryIds),
        ));
    }

    const entryMap = new Map(entries.map(e => [e.id, e]));
    const lines = matchingLines
      .map(line => {
        const entry = entryMap.get(line.journalEntryId);
        if (!entry) return null;
        return {
          lineId: line.id,
          journalEntryId: line.journalEntryId,
          entryDate: entry.entryDate,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          entryMemo: entry.memo,
          lineMemo: line.memo,
          debit: line.debit,
          credit: line.credit,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.entryDate.localeCompare(b.entryDate) || a.journalEntryId - b.journalEntryId);

    let runningBalance = 0;
    const linesWithBalance = lines.map((l: any) => {
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      const net = acct.normalBalance === "DEBIT" ? d - c : c - d;
      runningBalance = round2(runningBalance + net);
      return { ...l, runningBalance: runningBalance.toFixed(2) };
    });

    return res.json({
      account: acct,
      lines: linesWithBalance,
      balance: runningBalance.toFixed(2),
    });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});

app.get("/api/gl/reconcile", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;

    const arTotal = await storage.getOutstandingAR(orgId);

    const accounts = await db.select().from(glAccounts).where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.accountNumber, "1200")));
    let gl1200Balance = 0;
    if (accounts.length > 0) {
      const balResult = await db.select({
        balance: sql<string>`COALESCE(SUM(${glJournalLines.debit}::numeric - ${glJournalLines.credit}::numeric), 0)`,
      }).from(glJournalLines)
        .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
        .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalLines.accountId, accounts[0].id)));
      gl1200Balance = Number(balResult[0]?.balance || 0);
    }

    const diff = round2(arTotal - gl1200Balance);

    return res.json({
      ar_subledger_total: arTotal.toFixed(2),
      gl_1200_balance: gl1200Balance.toFixed(2),
      diff: diff.toFixed(2),
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

async function findOrphans(orgId: string) {
  const allJEs = await storage.getGLJournalEntriesByOrg(orgId, {});
  const orphans: { jeId: number; sourceType: string; sourceRef: string; memo: string | null }[] = [];
  const sourceChecks: Record<string, { table: any; idField: any }> = {
    INVOICE: { table: invoices, idField: invoices.id },
    PAYMENT: { table: payments, idField: payments.id },
    EXPENSE: { table: expenses, idField: expenses.id },
    EXPENSE_REIMBURSE: { table: expenses, idField: expenses.id },
    PAYOUT: { table: teamMemberPayoutsV2, idField: teamMemberPayoutsV2.id },
  };

  const reversedRefs = new Set(
    allJEs
      .filter(je => je.sourceRef && (
        je.sourceType?.includes("VOID") || je.sourceType?.includes("DELETE") ||
        je.sourceType?.includes("REFUND") || je.sourceType?.includes("REVERSE")
      ))
      .map(je => je.sourceRef!.replace(/-(?:reverse|void)$/, ""))
  );

  for (const je of allJEs) {
    if (!je.sourceType || !je.sourceRef) continue;
    if (je.sourceType.includes("VOID") || je.sourceType.includes("DELETE") || je.sourceType.includes("REFUND") || je.sourceType.includes("REVERSE")) continue;
    if (reversedRefs.has(je.sourceRef)) continue;

    const check = sourceChecks[je.sourceType];
    if (!check) continue;

    const rows = await db.select({ id: check.idField })
      .from(check.table)
      .where(and(eq(check.idField, je.sourceRef), eq(check.table.orgId, orgId)))
      .limit(1);

    if (rows.length === 0) {
      orphans.push({ jeId: je.id, sourceType: je.sourceType, sourceRef: je.sourceRef!, memo: je.memo });
    }
  }

  return orphans;
}

app.get("/api/gl/orphan-check", requireManagerOrAbove, async (req, res) => {
  try {
    const orphans = await findOrphans(req.session.orgId!);
    return res.json({ orphans, count: orphans.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/gl/reconcile/check", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;

    const arTotal = await storage.getOutstandingAR(orgId);

    const accounts = await db.select().from(glAccounts).where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.accountNumber, "1200")));
    let gl1200Balance = 0;
    if (accounts.length > 0) {
      const balResult = await db.select({
        balance: sql<string>`COALESCE(SUM(${glJournalLines.debit}::numeric - ${glJournalLines.credit}::numeric), 0)`,
      }).from(glJournalLines)
        .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
        .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalLines.accountId, accounts[0].id)));
      gl1200Balance = Number(balResult[0]?.balance || 0);
    }

    const diff = Number((arTotal - gl1200Balance).toFixed(2));

    const orphans = await findOrphans(orgId);

    if (diff !== 0 || orphans.length > 0) {
      const reasons: string[] = [];
      if (diff !== 0) reasons.push(`AR↔GL diff=$${diff.toFixed(2)}`);
      if (orphans.length > 0) reasons.push(`${orphans.length} orphaned GL entries`);
      return res.status(409).json({
        ok: false,
        message: `Invariant violation: ${reasons.join("; ")}`,
        ar_subledger_total: arTotal.toFixed(2),
        gl_1200_balance: gl1200Balance.toFixed(2),
        diff: diff.toFixed(2),
        orphans,
      });
    }

    return res.json({
      ok: true,
      message: "AR↔GL reconciled: diff=$0.00, no orphans",
      ar_subledger_total: arTotal.toFixed(2),
      gl_1200_balance: gl1200Balance.toFixed(2),
      diff: "0.00",
      orphans: [],
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/gl/reconcile/repair", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const arTotal = await storage.getOutstandingAR(orgId);

    const accounts = await db.select().from(glAccounts).where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.accountNumber, "1200")));
    if (accounts.length === 0) {
      return res.status(404).json({ message: "GL account 1200 not found" });
    }

    const balResult = await db.select({
      balance: sql<string>`COALESCE(SUM(${glJournalLines.debit}::numeric - ${glJournalLines.credit}::numeric), 0)`,
    }).from(glJournalLines)
      .innerJoin(glJournalEntries, eq(glJournalLines.journalEntryId, glJournalEntries.id))
      .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalLines.accountId, accounts[0].id)));
    const gl1200Balance = Number(balResult[0]?.balance || 0);

    const diff = round2(arTotal - gl1200Balance);
    if (diff === 0) {
      return res.json({ message: "GL 1200 already reconciled", diff: "0.00", adjustment: "0.00" });
    }

    const retainedEarningsAccounts = await db.select().from(glAccounts).where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.accountNumber, "3900")));
    let offsetAccountId: string;
    if (retainedEarningsAccounts.length > 0) {
      offsetAccountId = String(retainedEarningsAccounts[0].id);
    } else {
      const revenueAccounts = await db.select().from(glAccounts).where(and(eq(glAccounts.orgId, orgId), eq(glAccounts.accountNumber, "4000")));
      if (revenueAccounts.length === 0) {
        return res.status(404).json({ message: "No offset account (3900 or 4000) found" });
      }
      offsetAccountId = String(revenueAccounts[0].id);
    }

    const lines = diff > 0
      ? [
          { accountId: accounts[0].id, debit: diff.toFixed(2), credit: "0.00" },
          { accountId: offsetAccountId, debit: "0.00", credit: diff.toFixed(2) },
        ]
      : [
          { accountId: accounts[0].id, debit: "0.00", credit: Math.abs(diff).toFixed(2) },
          { accountId: offsetAccountId, debit: Math.abs(diff).toFixed(2), credit: "0.00" },
        ];

    await storage.createGLJournalEntry(
      orgId,
      new Date().toISOString().split("T")[0],
      `AR reconciliation adjustment: ${diff > 0 ? "debit" : "credit"} $${Math.abs(diff).toFixed(2)} to align GL 1200 with sub-ledger`,
      "AR_RECONCILE_REPAIR",
      null,
      true,
      null,
      lines as any,
      `ar-repair-${Date.now()}`,
    );

    return res.json({
      message: `GL 1200 repaired: adjustment of $${diff.toFixed(2)} posted`,
      previous_gl_balance: gl1200Balance.toFixed(2),
      ar_subledger: arTotal.toFixed(2),
      adjustment: diff.toFixed(2),
      new_gl_balance: arTotal.toFixed(2),
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
