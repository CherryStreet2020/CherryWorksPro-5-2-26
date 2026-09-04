import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, desc, and, sql, ne, gte, lte } from "drizzle-orm";
import {
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

    // ── Earnings, from the member's own seat ──────────────────────────────
    // One computation — storage.getMemberEarningsSummary — shared with
    // /api/my/earnings and built on the same rate + rounding chain the admin's
    // Record Payment pays from. "Paid" means paid TO THIS MEMBER; nothing here
    // reads the client invoice's status or dates. If the summary fails the rest
    // of the dashboard still renders and the card says so, rather than showing $0.
    let earnings: any = null;
    let earningsUnavailable = false;
    try {
      const s = await storage.getMemberEarningsSummary(orgId, userId);
      earnings = {
        costRateMissing: s.costRateMissing,
        unbilled: s.unbilled,
        awaitingPayout: s.awaitingPayout,
        totalOwed: s.totalOwed,
        pendingPayouts: s.pendingPayouts,
        paid: {
          ...s.paid,
          // Most recent completed payouts (reimbursements included, labelled by kind).
          items: s.payouts.filter(p => p.status === "COMPLETED").slice(0, 5),
        },
        reimbursements: s.reimbursements,
        totalReceivedIncludingReimbursements: s.totalReceivedIncludingReimbursements,
      };
    } catch (err) {
      console.error("[dashboard/my] earnings summary failed:", err);
      earningsUnavailable = true;
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
      earnings,
      earningsUnavailable,
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
