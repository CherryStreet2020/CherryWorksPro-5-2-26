import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { expenses, round2 } from "@shared/schema";
import { sanitizeErrorMessage, requireAdmin, requireManagerOrAbove, stripCostFieldsForRole } from "./middleware";
import { sanitizeCsvOutput } from "../import-parsers";
import PDFDocument from "pdfkit";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validateDateRange(startDate?: string, endDate?: string): string | null {
  if (startDate && !DATE_RE.test(startDate)) return "startDate must be in YYYY-MM-DD format";
  if (endDate && !DATE_RE.test(endDate)) return "endDate must be in YYYY-MM-DD format";
  if (startDate && endDate && startDate > endDate) return "endDate must be >= startDate";
  return null;
}

export function registerReportRoutes(app: Express) {
app.get("/api/reports", requireManagerOrAbove, async (req, res) => {
  const currentUser = await storage.getUserById(req.session.userId!);
  const result = await storage.getReportData(req.session.orgId!);
  const canonicalAR = await storage.getOutstandingAR(req.session.orgId!);
  return res.json(stripCostFieldsForRole({ ...result, canonicalAR }, currentUser?.role));
});
app.get("/api/reports/utilization", requireManagerOrAbove, async (req, res) => {
  const currentUser = await storage.getUserById(req.session.userId!);
  const result = await storage.getUtilizationData(req.session.orgId!);
  return res.json(stripCostFieldsForRole(result, currentUser?.role));
});
app.get("/api/reports/profitability", requireManagerOrAbove, async (req, res) => {
  try {
    const startDate = (req.query.startDate as string) || "2000-01-01";
    const endDate = (req.query.endDate as string) || "2099-12-31";
    const dateErr = validateDateRange(startDate, endDate);
    if (dateErr) return res.status(400).json({ message: dateErr });
    const orgId = req.session.orgId!;

    const result = await storage.getProfitabilityReport(orgId, startDate, endDate);

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "REPORT_RUN_PROFITABILITY",
      entityType: "report",
      entityId: null,
      details: { startDate, endDate, projectCount: result.rows.length },
    });

    const currentUser = await storage.getUserById(req.session.userId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/wip-aging", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const includeUnapproved = req.query.includeUnapproved === "true";
    const todayStr = new Date().toISOString().split("T")[0];

    const result = await storage.getWipAgingReport(orgId, includeUnapproved, todayStr);

    if (includeUnapproved) {
      await storage.createAuditLog({
        orgId,
        userId: req.session.userId!,
        action: "REPORT_RUN_WIP_AGING",
        entityType: "report",
        entityId: null,
        details: { includeUnapproved: true, totalEntries: result.totalEntries },
      });
    } else {
      await storage.createAuditLog({
        orgId,
        userId: req.session.userId!,
        action: "REPORT_RUN_WIP_AGING",
        entityType: "report",
        entityId: null,
        details: { includeUnapproved: false, totalEntries: result.totalEntries },
      });
    }

    const currentUser = await storage.getUserById(req.session.userId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/revenue/csv", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const reportData = await storage.getReportData(orgId);
    const rows = reportData.revenueByMonth || [];
    const csvHeader = "month,invoiced,collected,collectionRate";
    const csvRows = rows.map((r: any) => {
      const invoiced = round2(Number(r.invoiced));
      const collected = round2(Number(r.collected));
      const rate = invoiced > 0 ? round2((collected / invoiced) * 100).toFixed(1) : "0.0";
      return `"${sanitizeCsvOutput(r.month || "")}",${invoiced.toFixed(2)},${collected.toFixed(2)},${rate}%`;
    });
    const csv = [csvHeader, ...csvRows].join("\n");
    const today = new Date().toISOString().split("T")[0];
    await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "CSV_EXPORT", entityType: "revenue", entityId: null, details: { rowCount: csvRows.length } });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="revenue-${today}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/ar-aging/csv", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const reportData = await storage.getReportData(orgId);
    const aging = reportData.arAging || [];
    const csvHeader = "invoiceNumber,clientName,total,paidAmount,outstanding,dueDate,daysOverdue,bucket";
    const csvRows = aging.map((r: any) => {
      const outstanding = round2(Number(r.total) - Number(r.paidAmount));
      const dueDate = r.dueDate || "";
      const now = new Date();
      const due = dueDate ? new Date(dueDate + "T00:00:00Z") : now;
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
      let bucket = "Current";
      if (daysOverdue > 90) bucket = "91+";
      else if (daysOverdue > 60) bucket = "61-90";
      else if (daysOverdue > 30) bucket = "31-60";
      else if (daysOverdue > 0) bucket = "1-30";
      return `"${sanitizeCsvOutput(r.number || "")}","${sanitizeCsvOutput((r.clientName || "").replace(/"/g, '""'))}",${Number(r.total).toFixed(2)},${Number(r.paidAmount).toFixed(2)},${outstanding.toFixed(2)},"${dueDate}",${daysOverdue},"${bucket}"`;
    });
    const csv = [csvHeader, ...csvRows].join("\n");
    const today = new Date().toISOString().split("T")[0];
    await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "CSV_EXPORT", entityType: "ar-aging", entityId: null, details: { rowCount: csvRows.length } });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="ar-aging-${today}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/ar-aging/pdf", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const reportData = await storage.getReportData(orgId);
    const aging = reportData.arAging || [];
    const org = await storage.getOrg(orgId);
    const buckets: Record<string, { count: number; amount: number }> = {
      "Current": { count: 0, amount: 0 },
      "1-30": { count: 0, amount: 0 },
      "31-60": { count: 0, amount: 0 },
      "61-90": { count: 0, amount: 0 },
      "91+": { count: 0, amount: 0 },
    };
    for (const r of aging as any[]) {
      const outstanding = round2(Number(r.total) - Number(r.paidAmount));
      if (outstanding <= 0) continue;
      const dueDate = r.dueDate || "";
      const now = new Date();
      const due = dueDate ? new Date(dueDate + "T00:00:00Z") : now;
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
      let bucket = "Current";
      if (daysOverdue > 90) bucket = "91+";
      else if (daysOverdue > 60) bucket = "61-90";
      else if (daysOverdue > 30) bucket = "31-60";
      else if (daysOverdue > 0) bucket = "1-30";
      buckets[bucket].count++;
      buckets[bucket].amount += outstanding;
    }

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="ar-aging-${new Date().toISOString().split("T")[0]}.pdf"`);
      res.send(pdf);
    });

    doc.fontSize(18).font("Helvetica-Bold").text(org?.name || "Organization", { align: "center" });
    doc.fontSize(12).font("Helvetica").text("Accounts Receivable Aging Report", { align: "center" });
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
    doc.moveDown(1.5);

    const colX = [50, 200, 330, 430];
    const colW = [150, 130, 100, 100];
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Aging Bucket", colX[0], doc.y, { width: colW[0] });
    const headerY = doc.y - 12;
    doc.text("Invoices", colX[1], headerY, { width: colW[1] });
    doc.text("Amount", colX[2], headerY, { width: colW[2], align: "right" });
    doc.text("% of Total", colX[3], headerY, { width: colW[3], align: "right" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.3);

    const totalAmount = Object.values(buckets).reduce((s, b) => s + b.amount, 0);
    doc.font("Helvetica").fontSize(10);
    for (const [name, data] of Object.entries(buckets)) {
      const pct = totalAmount > 0 ? ((data.amount / totalAmount) * 100).toFixed(1) : "0.0";
      const y = doc.y;
      doc.text(name, colX[0], y, { width: colW[0] });
      doc.text(String(data.count), colX[1], y, { width: colW[1] });
      doc.text(`$${data.amount.toFixed(2)}`, colX[2], y, { width: colW[2], align: "right" });
      doc.text(`${pct}%`, colX[3], y, { width: colW[3], align: "right" });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold");
    const totY = doc.y;
    doc.text("Total", colX[0], totY, { width: colW[0] });
    doc.text(String(aging.filter((r: any) => round2(Number(r.total) - Number(r.paidAmount)) > 0).length), colX[1], totY, { width: colW[1] });
    doc.text(`$${totalAmount.toFixed(2)}`, colX[2], totY, { width: colW[2], align: "right" });
    doc.text("100.0%", colX[3], totY, { width: colW[3], align: "right" });

    if (aging.length > 0) {
      doc.moveDown(2);
      doc.fontSize(12).font("Helvetica-Bold").text("Invoice Detail");
      doc.moveDown(0.5);
      doc.fontSize(9).font("Helvetica-Bold");
      const dColX = [50, 150, 310, 380, 460];
      const dY = doc.y;
      doc.text("Invoice #", dColX[0], dY);
      doc.text("Client", dColX[1], dY);
      doc.text("Due Date", dColX[2], dY);
      doc.text("Outstanding", dColX[3], dY, { width: 80, align: "right" });
      doc.text("Bucket", dColX[4], dY);
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(0.2);

      doc.font("Helvetica").fontSize(9);
      for (const r of aging as any[]) {
        const outstanding = round2(Number(r.total) - Number(r.paidAmount));
        if (outstanding <= 0) continue;
        if (doc.y > 700) { doc.addPage(); }
        const dueDate = r.dueDate || "";
        const now = new Date();
        const due = dueDate ? new Date(dueDate + "T00:00:00Z") : now;
        const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
        let bucket = "Current";
        if (daysOverdue > 90) bucket = "91+";
        else if (daysOverdue > 60) bucket = "61-90";
        else if (daysOverdue > 30) bucket = "31-60";
        else if (daysOverdue > 0) bucket = "1-30";
        const iy = doc.y;
        doc.text(r.number || "", dColX[0], iy, { width: 100 });
        doc.text((r.clientName || "").substring(0, 25), dColX[1], iy, { width: 160 });
        doc.text(dueDate, dColX[2], iy, { width: 70 });
        doc.text(`$${outstanding.toFixed(2)}`, dColX[3], iy, { width: 80, align: "right" });
        doc.text(bucket, dColX[4], iy);
        doc.moveDown(0.2);
      }
    }

    doc.end();
    await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "PDF_EXPORT", entityType: "ar-aging", entityId: null, details: { invoiceCount: aging.length } });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/utilization/csv", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const data = await storage.getUtilizationData(orgId);
    const csvHeader = "name,billableHours,totalHours,utilization";
    const csvRows = (data || []).map((r: any) => {
      const billable = round2(Number(r.billableMinutes || 0) / 60);
      const total = round2(Number(r.totalMinutes || 0) / 60);
      const util = total > 0 ? round2((billable / total) * 100).toFixed(1) : "0.0";
      return `"${sanitizeCsvOutput((r.userName || "").replace(/"/g, '""'))}",${billable.toFixed(2)},${total.toFixed(2)},${util}%`;
    });
    const csv = [csvHeader, ...csvRows].join("\n");
    const today = new Date().toISOString().split("T")[0];
    await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "CSV_EXPORT", entityType: "utilization", entityId: null, details: { rowCount: csvRows.length } });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="utilization-${today}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/profitability/csv", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const startDate = (req.query.startDate as string) || "2000-01-01";
    const endDate = (req.query.endDate as string) || "2099-12-31";
    const dateErr = validateDateRange(startDate, endDate);
    if (dateErr) return res.status(400).json({ message: dateErr });
    const result = await storage.getProfitabilityReport(orgId, startDate, endDate);
    const data = result.rows;
    const csvHeader = "project,client,revenue,cost,profit,margin";
    const csvRows = (data || []).map((r: any) => {
      const rev = round2(Number(r.revenue || 0));
      const cost = round2(Number(r.cost || 0));
      const profit = round2(rev - cost);
      const margin = rev > 0 ? round2((profit / rev) * 100).toFixed(1) : (cost > 0 ? "-100.0" : "0.0");
      return `"${sanitizeCsvOutput((r.projectName || "").replace(/"/g, '""'))}","${sanitizeCsvOutput((r.clientName || "").replace(/"/g, '""'))}",${rev.toFixed(2)},${cost.toFixed(2)},${profit.toFixed(2)},${margin}%`;
    });
    const csv = [csvHeader, ...csvRows].join("\n");
    const today = new Date().toISOString().split("T")[0];
    await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "CSV_EXPORT", entityType: "profitability", entityId: null, details: { startDate, endDate, rowCount: csvRows.length } });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="profitability-${today}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/wip-aging/csv", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const includeUnapproved = req.query.includeUnapproved === "true";
    const todayStr = new Date().toISOString().split("T")[0];
    const data = await storage.getWipAgingReport(orgId, includeUnapproved, todayStr);
    const csvHeader = "project,client,teamMember,hours,amount,ageBucket";
    const entries: any[] = [];
    if (data.byTeamMember) {
      for (const [name, buckets] of Object.entries(data.byTeamMember)) {
        for (const [bucket, minutes] of Object.entries(buckets as Record<string, number>)) {
          entries.push({ teamMemberName: name, ageBucket: bucket, hours: round2(Number(minutes) / 60) });
        }
      }
    }
    const csvRows = entries.map((r: any) => {
      return `"${sanitizeCsvOutput((r.projectName || "").replace(/"/g, '""'))}","${sanitizeCsvOutput((r.clientName || "").replace(/"/g, '""'))}","${sanitizeCsvOutput((r.teamMemberName || "").replace(/"/g, '""'))}",${Number(r.hours || 0).toFixed(2)},${Number(r.amount || 0).toFixed(2)},"${r.ageBucket || ""}"`;
    });
    const csv = [csvHeader, ...csvRows].join("\n");
    const today = new Date().toISOString().split("T")[0];
    await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "CSV_EXPORT", entityType: "wip-aging", entityId: null, details: { rowCount: csvRows.length } });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="wip-aging-${today}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/reports/1099-export", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const startDate = (req.query.startDate as string) || "2000-01-01";
    const endDate = (req.query.endDate as string) || "2099-12-31";
    const dateErr = validateDateRange(startDate, endDate);
    if (dateErr) return res.status(400).json({ message: dateErr });

    const data = await storage.get1099TotalsExport(orgId, startDate, endDate);

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "EXPORT_1099_TOTALS",
      entityType: "report",
      entityId: null,
      details: { startDate, endDate, rowCount: data.length },
    });

    const csvHeader = "legalName,email,totalPaidAmount";
    const csvRows = data.map((r) =>
      `"${sanitizeCsvOutput((r.legalName || "").replace(/"/g, '""'))}","${sanitizeCsvOutput(r.email)}",${r.totalPaidAmount.toFixed(2)}`
    );
    const csv = [csvHeader, ...csvRows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="1099_totals_${startDate}_${endDate}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// NEW REPORT & DASHBOARD ENDPOINTS
// ══════════════════════════════════════════════════════════════════

app.get("/api/reports/client-revenue", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getClientRevenueReport(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/cash-flow", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getCashFlowReport(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/collections-efficiency", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getCollectionsEfficiencyReport(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/budget-burn", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getBudgetBurnReport(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/overdue-detail", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getOverdueInvoiceDetail(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/timesheet-compliance", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const weeksBack = parseInt(req.query.weeksBack as string) || 8;
    const result = await storage.getTimesheetComplianceReport(req.session.orgId!, weeksBack);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/labor-summary", requireAdmin, async (req, res) => {
  try {
    const result = await storage.getLaborSummaryByWorkerType(req.session.orgId!);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/payout-detail", requireAdmin, async (req, res) => {
  try {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const result = await storage.getPayoutDetailReport(req.session.orgId!, startDate, endDate);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/reports/executive-kpis", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getExecutiveKPIs(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

// ── Expense reporting queries ──

app.get("/api/reports/expenses-by-category", requireManagerOrAbove, async (req, res) => {
  try {
    const startDate = (req.query.startDate as string) || "2000-01-01";
    const endDate = (req.query.endDate as string) || "2099-12-31";
    const dateErr = validateDateRange(startDate, endDate);
    if (dateErr) return res.status(400).json({ message: dateErr });
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getExpenseSummaryByCategory(req.session.orgId!, startDate, endDate);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/reports/expenses-by-project", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getExpenseSummaryByProject(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/reports/expenses-by-user", requireManagerOrAbove, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    const result = await storage.getExpenseSummaryByUser(req.session.orgId!);
    return res.json(stripCostFieldsForRole(result, currentUser?.role));
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
}
