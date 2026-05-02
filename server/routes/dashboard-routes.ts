import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, desc, and, sql, ne, gte, lte } from "drizzle-orm";
import {
  invoiceLines,
  invoices,
  payments,
  round2,
  estimates,
  clients,
  projects,
  services,
  timesheetWeeks,
  apiKeys,
  webhookEndpoints,
  closePeriods,
  glAccounts,
  glJournalEntries,
  bankConnections,
  teamMemberPayoutsV2,
  users,
  importRuns,
} from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, requireAdmin, requireManagerOrAbove, dashboardBankingLimiter } from "./middleware";

export function registerDashboardRoutes(app: Express) {
app.get("/api/dashboard", requireManagerOrAbove, async (req, res) => {
  const stats = await storage.getDashboardStats(req.session.orgId!);
  return res.json(stats);
});
app.get("/api/ar/outstanding", requireManagerOrAbove, async (req, res) => {
  try {
    const ar = await storage.getOutstandingAR(req.session.orgId!);
    return res.json({ outstandingAR: ar });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/canonical/service-revenue", requireManagerOrAbove, async (req, res) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });
    const amount = await storage.getServiceRevenue(req.session.orgId!, startDate, endDate);
    return res.json({ serviceRevenue: amount });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/canonical/collected", requireManagerOrAbove, async (req, res) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });
    const amount = await storage.getCollected(req.session.orgId!, startDate, endDate);
    return res.json({ collected: amount });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/canonical/active-team", requireManagerOrAbove, async (req, res) => {
  try {
    const counts = await storage.getActiveTeamCount(req.session.orgId!);
    const members = await storage.getActiveTeamMembersList(req.session.orgId!);
    return res.json({ ...counts, members });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/dashboard/activity", requireManagerOrAbove, async (req, res) => {
  const feed = await storage.getRecentActivity(req.session.orgId!, 30);
  return res.json(feed);
});
app.get("/api/dashboard/banking", dashboardBankingLimiter, requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const connections = await storage.getBankConnectionsByOrg(orgId);
    const transactions = await storage.getBankTransactionsByOrg(orgId);
    const activeConnections = connections.filter(c => c.status === "ACTIVE").length;
    const totalTransactions = transactions.length;
    const unreconciled = transactions.filter(t => t.status === "PENDING" || t.status === "MATCHED").length;
    const matched = transactions.filter(t => t.status === "MATCHED").length;
    const reconciled = transactions.filter(t => t.status === "RECONCILED").length;
    const lastSync = connections.reduce((latest: string | null, c) => {
      const ts = c.updatedAt ? String(c.updatedAt) : null;
      if (!ts) return latest;
      if (!latest) return ts;
      return ts > latest ? ts : latest;
    }, null);
    return res.json({
      connectedAccounts: connections.length,
      activeConnections,
      totalTransactions,
      unreconciled,
      matched,
      reconciled,
      lastSync,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/dashboard/my", requireAuth, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const myEntries = await storage.getTimeEntriesByUser(orgId, userId);
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    const thisWeekEntries = myEntries.filter((e: any) => e.date >= weekStartStr && e.date <= weekEndStr);
    let billable = 0, nonBillable = 0;
    for (const e of thisWeekEntries) {
      const h = round2(Number(e.minutes) / 60);
      if (e.billable) billable = round2(billable + h);
      else nonBillable = round2(nonBillable + h);
    }

    const allMyProjects = await storage.getUserProjects(userId, orgId);
    const myProjects = allMyProjects.filter((p) => p.status === "ACTIVE");
    const recentEntries = myEntries.slice(0, 10);

    let timesheetStatus = "DRAFT";
    try {
      const ts = await storage.getTimesheetWeek(orgId, userId, weekStartStr);
      if (ts) timesheetStatus = ts.status;
    } catch { /* no timesheet for this week */ }

    const safeEntries = recentEntries.map((e: any) => ({
      id: e.id,
      projectId: e.projectId,
      projectName: e.projectName,
      date: e.date,
      minutes: e.minutes,
      billable: e.billable,
      notes: e.notes,
      serviceId: e.serviceId,
      serviceName: e.serviceName,
    }));

    const billableEntries = myEntries.filter((e: any) => e.billable);

    const unbilledEntries = billableEntries.filter((e: any) => !e.invoiced);
    let unbilledHours = 0;
    let unbilledEarnings = 0;
    let costRateMissing = false;
    const unbilledByProject: Record<string, { projectName: string; hours: number; amount: number }> = {};
    for (const e of unbilledEntries) {
      const hrs = round2(Number(e.minutes) / 60);
      const rate = Number(e.costRate || 0);
      if (e.costRate == null || e.costRate === "") costRateMissing = true;
      unbilledHours = round2(unbilledHours + hrs);
      unbilledEarnings = round2(unbilledEarnings + round2(hrs * rate));
      const key = e.projectName || "Unknown";
      if (!unbilledByProject[key]) unbilledByProject[key] = { projectName: key, hours: 0, amount: 0 };
      unbilledByProject[key].hours = round2(unbilledByProject[key].hours + hrs);
      unbilledByProject[key].amount = round2(unbilledByProject[key].amount + round2(hrs * rate));
    }

    const billedEntries = billableEntries.filter((e: any) => e.invoiced && e.invoiceLineId);
    const invoiceLineIds = [...new Set(billedEntries.map((e: any) => e.invoiceLineId).filter(Boolean))];

    let billedAwaitingHours = 0;
    let billedAwaitingEarnings = 0;
    let paidHours = 0;
    let paidEarnings = 0;
    const billedItems: Array<{
      projectName: string;
      hours: number;
      amount: number;
      invoiceStatus: string;
      invoiceDueDate: string | null;
      invoicePaidDate: string | null;
    }> = [];
    const paidItems: Array<{
      projectName: string;
      hours: number;
      amount: number;
      paidDate: string | null;
    }> = [];

    const lineToEntries: Record<string, any[]> = {};
    for (const e of billedEntries) {
      if (!e.invoiceLineId) continue;
      if (!lineToEntries[e.invoiceLineId]) lineToEntries[e.invoiceLineId] = [];
      lineToEntries[e.invoiceLineId].push(e);
    }

    for (const lineId of invoiceLineIds) {
      const entries = lineToEntries[lineId] || [];
      if (entries.length === 0) continue;

      let invoiceData: any = null;
      try {
        const line = await db.select().from(invoiceLines).where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.orgId, orgId))).limit(1);
        if (line.length > 0) {
          const inv = await db.select().from(invoices).where(and(eq(invoices.id, line[0].invoiceId), eq(invoices.orgId, orgId))).limit(1);
          if (inv.length > 0) invoiceData = inv[0];
        }
      } catch { /* skip if lookup fails */ }

      let groupHours = 0;
      let groupAmount = 0;
      const projectName = entries[0].projectName || "Unknown";
      for (const e of entries) {
        const hrs = round2(Number(e.minutes) / 60);
        const rate = Number(e.costRate || 0);
        if (e.costRate == null || e.costRate === "") costRateMissing = true;
        groupHours = round2(groupHours + hrs);
        groupAmount = round2(groupAmount + round2(hrs * rate));
      }

      if (invoiceData && (invoiceData.status === "PAID")) {
        paidHours = round2(paidHours + groupHours);
        paidEarnings = round2(paidEarnings + groupAmount);
        let paidDate: string | null = null;
        try {
          const pmts = await db.select().from(payments).where(and(eq(payments.invoiceId, invoiceData.id), eq(payments.orgId, orgId))).orderBy(desc(payments.date)).limit(1);
          if (pmts.length > 0) paidDate = pmts[0].date;
        } catch (err) { console.error("[auto-payout] Failed to look up payment date:", err); }
        paidItems.push({ projectName, hours: groupHours, amount: groupAmount, paidDate });
      } else if (invoiceData && (invoiceData.status === "SENT" || invoiceData.status === "PARTIAL")) {
        billedAwaitingHours = round2(billedAwaitingHours + groupHours);
        billedAwaitingEarnings = round2(billedAwaitingEarnings + groupAmount);
        billedItems.push({
          projectName,
          hours: groupHours,
          amount: groupAmount,
          invoiceStatus: invoiceData.status,
          invoiceDueDate: invoiceData.dueDate,
          invoicePaidDate: null,
        });
      }
    }

    let nextPaymentDate: string | null = null;
    for (const item of billedItems) {
      if (item.invoiceDueDate) {
        if (!nextPaymentDate || item.invoiceDueDate < nextPaymentDate) {
          nextPaymentDate = item.invoiceDueDate;
        }
      }
    }

    return res.json({
      hoursThisWeek: { billable, nonBillable, total: round2(billable + nonBillable) },
      timesheetStatus,
      recentEntries: safeEntries,
      myProjects: myProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        clientName: p.clientName,
        status: p.status,
        hoursThisWeek: thisWeekEntries.filter((e: any) => e.projectName === p.name).reduce((s: number, e: any) => round2(s + round2(Number(e.minutes) / 60)), 0),
      })),
      earnings: {
        costRateMissing,
        unbilled: {
          hours: unbilledHours,
          amount: unbilledEarnings,
          byProject: Object.values(unbilledByProject),
        },
        billedAwaiting: {
          hours: billedAwaitingHours,
          amount: billedAwaitingEarnings,
          items: billedItems,
          nextPaymentDate,
        },
        paid: {
          hours: paidHours,
          amount: paidEarnings,
          items: paidItems,
        },
        totalOutstanding: round2(unbilledEarnings + billedAwaitingEarnings),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/hub-stats", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const isAdmin = req.session.role === "ADMIN";

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .split("T")[0];
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString()
      .split("T")[0];

    const [
      invoicesOpen,
      estimatesPending,
      paymentsThisMonth,
      clientsTotal,
      projectsActive,
      servicesTotal,
      approvalsPending,
      glAccountsTotal,
      journalThisMonth,
      activeUsers,
      lastImport,
    ] = await Promise.all([
      db
        .select({
          count: sql<number>`count(*)`,
          amount: sql<number>`coalesce(sum((cast(${invoices.total} as numeric) - cast(${invoices.paidAmount} as numeric)) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.orgId, orgId),
            ne(invoices.status, "DRAFT"),
            ne(invoices.status, "VOID"),
            ne(invoices.status, "PAID"),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(estimates)
        .where(and(eq(estimates.orgId, orgId), eq(estimates.status, "SENT"))),
      db
        .select({
          count: sql<number>`count(*)`,
          amount: sql<number>`coalesce(sum(cast(${payments.amount} as numeric)), 0)`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.orgId, orgId),
            gte(payments.date, monthStart),
            lte(payments.date, monthEnd),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(clients)
        .where(eq(clients.orgId, orgId)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.status, "ACTIVE"))),
      db
        .select({ count: sql<number>`count(*)` })
        .from(services)
        .where(eq(services.orgId, orgId)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(timesheetWeeks)
        .where(and(eq(timesheetWeeks.orgId, orgId), eq(timesheetWeeks.status, "SUBMITTED"))),
      db
        .select({ count: sql<number>`count(*)` })
        .from(glAccounts)
        .where(eq(glAccounts.orgId, orgId)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(glJournalEntries)
        .where(
          and(
            eq(glJournalEntries.orgId, orgId),
            gte(glJournalEntries.entryDate, monthStart),
            lte(glJournalEntries.entryDate, monthEnd),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.orgId, orgId), eq(users.isActive, true))),
      db
        .select({ startedAt: importRuns.startedAt })
        .from(importRuns)
        .where(eq(importRuns.orgId, orgId))
        .orderBy(desc(importRuns.startedAt))
        .limit(1),
    ]);

    let payoutsThisMonth: { count: number; amount: number } | null = null;
    let lastClosedPeriod: string | null = null;
    let apiKeysTotal: number | null = null;
    let webhooksActive: number | null = null;
    let bankingConnections: number | null = null;

    if (isAdmin) {
      const [
        payoutsMonth,
        lastClose,
        apiKeyCount,
        webhookCount,
        bankCount,
      ] = await Promise.all([
        db
          .select({
            count: sql<number>`count(*)`,
            amount: sql<number>`coalesce(sum(cast(${teamMemberPayoutsV2.amount} as numeric)), 0)`,
          })
          .from(teamMemberPayoutsV2)
          .where(
            and(
              eq(teamMemberPayoutsV2.orgId, orgId),
              eq(teamMemberPayoutsV2.status, "COMPLETED"),
              gte(teamMemberPayoutsV2.payoutDate, monthStart),
              lte(teamMemberPayoutsV2.payoutDate, monthEnd),
            ),
          ),
        db
          .select({ periodEnd: closePeriods.periodEnd })
          .from(closePeriods)
          .where(and(eq(closePeriods.orgId, orgId), eq(closePeriods.status, "CLOSED")))
          .orderBy(desc(closePeriods.periodEnd))
          .limit(1),
        db
          .select({ count: sql<number>`count(*)` })
          .from(apiKeys)
          .where(eq(apiKeys.orgId, orgId)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(webhookEndpoints)
          .where(and(eq(webhookEndpoints.orgId, orgId), eq(webhookEndpoints.isActive, true))),
        db
          .select({ count: sql<number>`count(*)` })
          .from(bankConnections)
          .where(eq(bankConnections.orgId, orgId)),
      ]);

      payoutsThisMonth = {
        count: Number(payoutsMonth[0]?.count) || 0,
        amount: round2(Number(payoutsMonth[0]?.amount) || 0),
      };
      lastClosedPeriod = lastClose[0]?.periodEnd ?? null;
      apiKeysTotal = Number(apiKeyCount[0]?.count) || 0;
      webhooksActive = Number(webhookCount[0]?.count) || 0;
      bankingConnections = Number(bankCount[0]?.count) || 0;
    }

    return res.json({
      billing: {
        invoicesOpen: Number(invoicesOpen[0]?.count) || 0,
        invoicesOpenAmount: round2(Number(invoicesOpen[0]?.amount) || 0),
        estimatesPending: Number(estimatesPending[0]?.count) || 0,
        paymentsThisMonth: Number(paymentsThisMonth[0]?.count) || 0,
        paymentsThisMonthAmount: round2(Number(paymentsThisMonth[0]?.amount) || 0),
      },
      management: {
        clients: Number(clientsTotal[0]?.count) || 0,
        activeProjects: Number(projectsActive[0]?.count) || 0,
        services: Number(servicesTotal[0]?.count) || 0,
        approvalsPending: Number(approvalsPending[0]?.count) || 0,
        payoutsThisMonth,
      },
      system: {
        apiKeys: apiKeysTotal,
        webhooksActive,
        lastClosedPeriod,
        teamMembers: Number(activeUsers[0]?.count) || 0,
        lastImport: lastImport[0]?.startedAt
          ? new Date(lastImport[0].startedAt).toISOString()
          : null,
      },
      accounting: {
        glAccounts: Number(glAccountsTotal[0]?.count) || 0,
        journalEntriesThisMonth: Number(journalThisMonth[0]?.count) || 0,
        bankingConnections,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
