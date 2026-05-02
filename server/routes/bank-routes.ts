import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { orgs } from "@shared/schema";
import { sanitizeErrorMessage, requireAdmin , requirePlanTier } from "./middleware";

async function autoMatchTransactions(
  storageRef: any,
  orgId: string,
  newTransactions: { id: number; amount: string; date: string; description: string | null }[],
): Promise<number> {
  let totalMatches = 0;
  const payments = await storageRef.getPaymentsByOrg(orgId);
  const recentPayments = payments.slice(-500);
  const invoices = await storageRef.getInvoicesByOrg(orgId);
  const recentInvoices = invoices.slice(-500);
  const payouts = await storageRef.getTeamMemberPayouts(orgId);
  const recentPayouts = payouts.slice(-200);
  const MIN_AUTO_MATCH_CONFIDENCE = 80;
  for (const tx of newTransactions) {
    const txAmount = Math.abs(Number(tx.amount));
    const txDate = new Date(tx.date + "T00:00:00Z");
    const isCredit = Number(tx.amount) > 0;
    const isDebit = Number(tx.amount) < 0;
    const matches: { entityType: string; entityId: string; matchType: string; confidence: string }[] = [];
    if (isCredit) {
      for (const pay of recentPayments) {
        const payAmount = Math.abs(Number(pay.amount));
        if (Math.abs(txAmount - payAmount) < 0.01) {
          const payDate = new Date(pay.date + "T00:00:00Z");
          const daysDiff = Math.abs((txDate.getTime() - payDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff <= 2) {
            const confidence = daysDiff < 1 ? "95.00" : "85.00";
            matches.push({
              entityType: "INVOICE_PAYMENT",
              entityId: String(pay.id),
              matchType: daysDiff < 1 ? "AUTO_PERFECT" : "AUTO_FUZZY",
              confidence,
            });
          }
        }
      }
    }
    if (isDebit) {
      for (const po of recentPayouts) {
        const poAmount = Math.abs(Number(po.amount));
        if (Math.abs(txAmount - poAmount) < 0.01) {
          const poDate = new Date(po.payoutDate + "T00:00:00Z");
          const daysDiff = Math.abs((txDate.getTime() - poDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff <= 3) {
            const confidence = daysDiff < 1 ? "92.00" : daysDiff <= 1 ? "85.00" : "80.00";
            matches.push({
              entityType: "PAYOUT",
              entityId: String(po.id),
              matchType: daysDiff < 1 ? "AUTO_PERFECT" : "AUTO_FUZZY",
              confidence,
            });
          }
        }
      }
    }
    const qualifiedMatches = matches.filter(m => Number(m.confidence) >= MIN_AUTO_MATCH_CONFIDENCE);
    for (const m of qualifiedMatches) {
      await storageRef.createBankTransactionMatch({
        orgId,
        bankTransactionId: tx.id,
        entityType: m.entityType,
        entityId: m.entityId,
        matchType: m.matchType,
        confidence: m.confidence,
        matchedBy: null,
      });
      totalMatches++;
    }
  }
  return totalMatches;
}

export function registerBankRoutes(app: Express) {
app.get("/api/bank-connections", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const connections = await storage.getBankConnectionsByOrg(orgId);
    return res.json(connections);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/bank-connections/connect", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(400).json({ message: "Stripe is not configured. Please add STRIPE_SECRET_KEY to connect bank accounts." });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    const org = await storage.getOrg(orgId);
    let customerId = org?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org?.name || "Unknown",
        metadata: { orgId },
      });
      customerId = customer.id;
      await db.update(orgs).set({ stripeCustomerId: customerId }).where(eq(orgs.id, orgId));
    }

    const session = await stripe.financialConnections.sessions.create({
      account_holder: { type: "customer" as const, customer: customerId },
      permissions: ["transactions", "balances"],
      filters: { countries: ["US"] },
    });

    return res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/bank-connections/complete", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ message: "sessionId is required" });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(400).json({ message: "Stripe is not configured" });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    const org = await storage.getOrg(orgId);
    const session = await stripe.financialConnections.sessions.retrieve(sessionId);

    const sessionCustomer = (session.account_holder as any)?.customer;
    if (org?.stripeCustomerId && sessionCustomer && sessionCustomer !== org.stripeCustomerId) {
      return res.status(403).json({ message: "Session does not belong to this organization" });
    }

    const accounts = session.accounts?.data || [];

    const created = [];
    for (const acct of accounts) {
      const conn = await storage.createBankConnection({
        orgId,
        stripeAccountId: acct.id,
        institutionName: acct.institution_name || "Unknown",
        accountName: acct.display_name || (acct.account_holder as any)?.name || null,
        accountType: acct.subcategory || acct.category || null,
        last4: acct.last4 || null,
        status: "ACTIVE",
        accessToken: null,
      });
      created.push(conn);
    }

    return res.json({ connections: created, count: created.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.delete("/api/bank-connections/:id", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const id = Number(req.params.id);
    const conn = await storage.getBankConnectionById(id);
    if (!conn || conn.orgId !== orgId) {
      return res.status(404).json({ message: "Connection not found" });
    }
    await storage.deleteBankConnection(id, orgId);
    return res.json({ success: true });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/bank-connections/:id/sync", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const id = Number(req.params.id);
    const conn = await storage.getBankConnectionById(id);
    if (!conn || conn.orgId !== orgId) {
      return res.status(404).json({ message: "Connection not found" });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(400).json({ message: "Stripe is not configured" });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    try {
      await (stripe.financialConnections.accounts as any).subscribe(conn.stripeAccountId, {
        features: ["transactions"],
      });
    } catch (subErr: any) {
      if (!subErr?.message?.includes("already")) {
        console.log(`[bank-sync] subscribe note: ${subErr?.message || "unknown"}`);
      }
    }

    try {
      await (stripe.financialConnections.accounts as any).refresh(conn.stripeAccountId, {
        features: ["transactions"],
      });
    } catch (refreshErr: any) {
      console.log(`[bank-sync] refresh note: ${refreshErr?.message || "unknown"}`);
    }

    let transactions;
    try {
      transactions = await stripe.financialConnections.transactions.list({
        account: conn.stripeAccountId,
        limit: 100,
      });
    } catch (listErr: any) {
      const msg = listErr?.message || "";
      if (msg.includes("no transactions") || msg.includes("not available") || msg.includes("not yet")) {
        await storage.updateBankConnection(id, { status: "ACTIVE" });
        return res.json({
          synced: 0,
          matched: 0,
          total: 0,
          newTransactions: [],
          pending: true,
          message: "Transaction access requested. Please try syncing again in a few minutes.",
        });
      }
      throw listErr;
    }

    const existingTxs = await storage.getBankTransactionsByConnection(id);
    const existingStripeIds = new Set(existingTxs.map(t => t.stripeTransactionId));

    const newTxs = [];
    for (const tx of transactions.data) {
      if (existingStripeIds.has(tx.id)) continue;
      newTxs.push({
        orgId,
        bankConnectionId: id,
        stripeTransactionId: tx.id,
        date: tx.transacted_at ? new Date(tx.transacted_at * 1000).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        amount: (tx.amount / 100).toFixed(2),
        description: tx.description || "",
        category: tx.status || null,
        status: "PENDING" as const,
        matchedEntityType: null,
        matchedEntityId: null,
      });
    }

    const created = await storage.createBankTransactions(newTxs);

    let matchCount = 0;
    if (created.length > 0) {
      matchCount = await autoMatchTransactions(storage, orgId, created);
    }

    await storage.updateBankConnection(id, { status: "ACTIVE" });

    return res.json({
      synced: created.length,
      matched: matchCount,
      total: transactions.data.length,
      newTransactions: created,
    });
  } catch (err: any) {
    await storage.updateBankConnection(Number(req.params.id), { status: "ERROR" }).catch((err) => { console.error("[bank] Failed to update connection status:", err.message); });
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/bank-connections/:id/transactions", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const id = Number(req.params.id);
    const conn = await storage.getBankConnectionById(id);
    if (!conn || conn.orgId !== orgId) {
      return res.status(404).json({ message: "Connection not found" });
    }
    const transactions = await storage.getBankTransactionsByConnection(id);
    return res.json(transactions);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/bank-transactions", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 100), 500);
    const offset = (page - 1) * pageSize;
    const transactions = await storage.getBankTransactionsByOrg(orgId, pageSize, offset);
    return res.json(transactions);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/banking/auto-match", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const allTxs = await storage.getBankTransactionsByOrg(orgId, 10000, 0);
    const pendingTxs = allTxs.filter(tx => tx.status === "PENDING");
    if (pendingTxs.length === 0) {
      return res.json({ matched: 0, suggested: 0, total: 0 });
    }

    const paymentsAll = await storage.getPaymentsByOrg(orgId);
    const payoutsAll = await storage.getTeamMemberPayouts(orgId);
    const expensesResult = await storage.getExpenses(orgId, {}) as any;
    const expensesAll = expensesResult.expenses || [];

    let matched = 0;
    let suggested = 0;

    for (const tx of pendingTxs) {
      const txAmount = Math.abs(Number(tx.amount));
      const txDate = new Date(tx.date + "T00:00:00Z");
      const isCredit = Number(tx.amount) > 0;
      const isDebit = Number(tx.amount) < 0;

      const candidates: { entityType: string; entityId: string; confidence: string; matchType: string }[] = [];

      if (isCredit) {
        for (const pay of paymentsAll) {
          const payAmount = Math.abs(Number(pay.amount));
          if (Math.abs(txAmount - payAmount) < 0.01) {
            const payDate = new Date(pay.date + "T00:00:00Z");
            const daysDiff = Math.abs((txDate.getTime() - payDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 3) {
              candidates.push({
                entityType: "INVOICE_PAYMENT",
                entityId: String(pay.id),
                matchType: daysDiff < 1 ? "AUTO_PERFECT" : "AUTO_FUZZY",
                confidence: daysDiff < 1 ? "95.00" : "85.00",
              });
            }
          }
        }
      }

      if (isDebit) {
        for (const po of payoutsAll) {
          const poAmount = Math.abs(Number(po.amount));
          if (Math.abs(txAmount - poAmount) < 0.01) {
            const poDate = new Date(po.payoutDate + "T00:00:00Z");
            const daysDiff = Math.abs((txDate.getTime() - poDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 3) {
              candidates.push({
                entityType: "PAYOUT",
                entityId: String(po.id),
                matchType: daysDiff < 1 ? "AUTO_PERFECT" : "AUTO_FUZZY",
                confidence: daysDiff < 1 ? "92.00" : "82.00",
              });
            }
          }
        }
        for (const exp of expensesAll) {
          const expAmount = Math.abs(Number(exp.amount));
          if (Math.abs(txAmount - expAmount) < 0.01) {
            const expDate = new Date(exp.date + "T00:00:00Z");
            const daysDiff = Math.abs((txDate.getTime() - expDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 3) {
              candidates.push({
                entityType: "EXPENSE",
                entityId: String(exp.id),
                matchType: daysDiff < 1 ? "AUTO_PERFECT" : "AUTO_FUZZY",
                confidence: daysDiff < 1 ? "90.00" : "80.00",
              });
            }
          }
        }
      }

      if (candidates.length === 1) {
        await storage.updateBankTransaction(tx.id, {
          status: "MATCHED",
          matchedEntityType: candidates[0].entityType,
          matchedEntityId: candidates[0].entityId,
        });
        await storage.createBankTransactionMatch({
          orgId,
          bankTransactionId: tx.id,
          entityType: candidates[0].entityType as any,
          entityId: candidates[0].entityId,
          matchType: candidates[0].matchType as any,
          confidence: candidates[0].confidence,
          matchedBy: null,
        });
        matched++;
      } else if (candidates.length > 1) {
        for (const c of candidates) {
          await storage.createBankTransactionMatch({
            orgId,
            bankTransactionId: tx.id,
            entityType: c.entityType as any,
            entityId: c.entityId,
            matchType: "SUGGESTED" as any,
            confidence: c.confidence,
            matchedBy: null,
          });
        }
        suggested++;
      }
    }

    return res.json({ matched, suggested, total: pendingTxs.length });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/bank-transaction-matches-by-org", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const matches = await storage.getBankTransactionMatchesByOrg(orgId);
    return res.json(matches);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/bank-transactions/:id/matches", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const id = Number(req.params.id);
    const tx = await storage.getBankTransaction(id, orgId);
    if (!tx) return res.status(404).json({ message: "Transaction not found" });
    const matches = await storage.getBankTransactionMatchesByTransaction(id);

    const enrichedMatches = [];
    for (const m of matches) {
      let entityLabel = "";
      let entityDetails = "";
      if (m.entityType === "INVOICE_PAYMENT") {
        const allPayments = await storage.getPaymentsByOrg(orgId);
        const pay = allPayments.find((p: any) => p.id === m.entityId);
        if (pay) {
          entityLabel = `Payment for Invoice #${(pay as any).invoiceNumber}`;
          entityDetails = `${(pay as any).clientName} — $${Number(pay.amount).toFixed(2)} on ${pay.date}`;
        }
      } else if (m.entityType === "PAYOUT") {
        const allPayouts = await storage.getTeamMemberPayouts(orgId);
        const po = allPayouts.find((p: any) => p.id === m.entityId);
        if (po) {
          entityLabel = `Payout to ${(po as any).teamMemberName}`;
          entityDetails = `$${Number(po.amount).toFixed(2)} on ${po.payoutDate}`;
        }
      } else if (m.entityType === "EXPENSE") {
        entityLabel = `Expense #${m.entityId}`;
      }
      enrichedMatches.push({
        ...m,
        entityLabel: entityLabel || `${m.entityType} #${m.entityId}`,
        entityDetails,
      });
    }

    return res.json(enrichedMatches);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/bank-transactions/:id/accept-match", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const id = Number(req.params.id);
    const { matchId } = req.body;
    if (!matchId) return res.status(400).json({ message: "matchId is required" });

    const tx = await storage.getBankTransaction(id, orgId);
    if (!tx) return res.status(404).json({ message: "Transaction not found" });

    const match = await storage.getBankTransactionMatchById(Number(matchId));
    if (!match || match.bankTransactionId !== id || match.orgId !== orgId) {
      return res.status(404).json({ message: "Match not found" });
    }

    const txAmount = Math.abs(Number(tx.amount));
    let matchAmount = 0;
    if (match.entityType === "INVOICE_PAYMENT") {
      const p = await storage.getPayment(String(match.entityId), orgId);
      matchAmount = p ? Math.abs(Number(p.amount)) : 0;
    } else if (match.entityType === "PAYOUT") {
      const p = await storage.getTeamMemberPayoutById(String(match.entityId), orgId);
      matchAmount = p ? Math.abs(Number(p.amount)) : 0;
    } else if (match.entityType === "EXPENSE") {
      const e = await storage.getExpenseById(String(match.entityId), orgId);
      matchAmount = e ? Math.abs(Number(e.amount)) : 0;
    }
    if (txAmount > 0 && matchAmount > 0 && Math.abs(txAmount - matchAmount) >= 0.01) {
      console.warn(`[bank] Amount mismatch on match ${matchId}: transaction=${txAmount}, entity=${matchAmount}`);
    }

    await storage.updateBankTransaction(id, {
      status: "MATCHED",
      matchedEntityType: match.entityType,
      matchedEntityId: String(match.entityId),
    });

    await storage.deleteBankTransactionMatchesByTransaction(id);

    return res.json({ success: true });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.delete("/api/bank-transaction-matches/:id", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const id = Number(req.params.id);
    const match = await storage.getBankTransactionMatchById(id);
    if (!match || match.orgId !== orgId) {
      return res.status(404).json({ message: "Match not found" });
    }
    await storage.deleteBankTransactionMatch(id, orgId);
    return res.json({ success: true });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/bank-reconciliation/batch", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { transactionIds } = req.body;
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ message: "transactionIds array is required" });
    }

    const uniqueIds = [...new Set(transactionIds.map(Number).filter(n => !isNaN(n)))];
    const allTxs = await storage.getBankTransactionsByOrg(orgId, 5000, 0);
    const txMap = new Map(allTxs.map(t => [t.id, t]));

    let reconciledCount = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;

    for (const txId of uniqueIds) {
      const tx = txMap.get(txId);
      if (!tx) continue;
      if (tx.status === "RECONCILED") continue;

      await storage.updateBankTransaction(txId, { status: "RECONCILED" });
      reconciledCount++;
      if (tx.matchedEntityType) {
        matchedCount++;
      } else {
        unmatchedCount++;
      }
    }

    if (reconciledCount > 0) {
      await storage.createBankReconciliationLog({
        orgId,
        bankConnectionId: null,
        totalTransactions: reconciledCount,
        matchedCount,
        unmatchedCount,
        reconciledBy: userId,
      });
    }

    return res.json({
      reconciled: reconciledCount,
      matchedCount,
      unmatchedCount,
    });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/bank-reconciliation/logs", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const logs = await storage.getBankReconciliationLogsByOrg(orgId);
    return res.json(logs);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.patch("/api/bank-transactions/:id/status", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Bank Connections"))) return;
    const orgId = req.session.orgId!;
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!status || !["PENDING", "MATCHED", "RECONCILED", "IGNORED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be PENDING, MATCHED, RECONCILED, or IGNORED." });
    }
    const tx = await storage.getBankTransaction(id, orgId);
    if (!tx) return res.status(404).json({ message: "Transaction not found" });
    const updated = await storage.updateBankTransaction(id, { status });
    if (status !== "MATCHED") {
      await storage.updateBankTransaction(id, { matchedEntityType: null, matchedEntityId: null });
    }
    return res.json(updated);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
}
