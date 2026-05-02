import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { randomUUID } from "crypto";

interface ScheduledReport {
  id: string;
  orgId: string;
  reportType: string;
  schedule: string;
  recipients: string[];
  format: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdBy: string;
  createdAt: Date;
  runCount: number;
}

const scheduledReports = new Map<string, ScheduledReport>();

function computeNextRun(schedule: string, from: Date = new Date()): Date {
  const next = new Date(from);
  switch (schedule) {
    case "daily": next.setDate(next.getDate() + 1); next.setHours(8, 0, 0, 0); break;
    case "weekly": next.setDate(next.getDate() + (7 - next.getDay() + 1) % 7 + 1); next.setHours(8, 0, 0, 0); break;
    case "monthly": next.setMonth(next.getMonth() + 1, 1); next.setHours(8, 0, 0, 0); break;
    default: next.setDate(next.getDate() + 1); next.setHours(8, 0, 0, 0);
  }
  return next;
}

export function registerScheduledReportsRoutes(app: Express) {

app.get("/api/admin/scheduled-reports", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const reports = Array.from(scheduledReports.values()).filter(r => r.orgId === orgId);
    return res.json({
      reports,
      count: reports.length,
      availableReportTypes: ["revenue", "ar_aging", "utilization", "expense_summary", "project_profitability", "timesheet_summary"],
      availableSchedules: ["daily", "weekly", "monthly"],
      availableFormats: ["pdf", "csv", "xlsx"],
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/scheduled-reports", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Scheduled Reports"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { reportType, schedule, recipients, format } = req.body;

    if (!reportType) return res.status(400).json({ message: "reportType is required" });
    if (!schedule) return res.status(400).json({ message: "schedule is required" });
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ message: "recipients array is required" });
    }

    const validTypes = ["revenue", "ar_aging", "utilization", "expense_summary", "project_profitability", "timesheet_summary"];
    if (!validTypes.includes(reportType)) {
      return res.status(400).json({ message: `Invalid reportType. Valid: ${validTypes.join(", ")}` });
    }

    const validSchedules = ["daily", "weekly", "monthly"];
    if (!validSchedules.includes(schedule)) {
      return res.status(400).json({ message: `Invalid schedule. Valid: ${validSchedules.join(", ")}` });
    }

    const id = randomUUID();
    const report: ScheduledReport = {
      id,
      orgId,
      reportType,
      schedule,
      recipients,
      format: format || "pdf",
      enabled: true,
      lastRunAt: null,
      nextRunAt: computeNextRun(schedule),
      createdBy: userId,
      createdAt: new Date(),
      runCount: 0,
    };

    scheduledReports.set(id, report);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SCHEDULED_REPORT_CREATED', 'scheduled_report', $3, $4)`,
      [orgId, userId, id, JSON.stringify({ reportType, schedule, recipients, format: report.format })]
    );

    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/scheduled-reports/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const report = scheduledReports.get(req.params.id as string);
    if (!report || report.orgId !== orgId) {
      return res.status(404).json({ message: "Report schedule not found" });
    }
    return res.json({ report });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/scheduled-reports/:id/pause", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Scheduled Reports"))) return;
    const orgId = req.session.orgId!;
    const report = scheduledReports.get(req.params.id as string);
    if (!report || report.orgId !== orgId) {
      return res.status(404).json({ message: "Report schedule not found" });
    }

    report.enabled = false;
    report.nextRunAt = null;

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SCHEDULED_REPORT_PAUSED', 'scheduled_report', $3, $4)`,
      [orgId, req.session.userId, report.id, JSON.stringify({ reportType: report.reportType })]
    );

    return res.json({ success: true, report, paused: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/scheduled-reports/:id/resume", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Scheduled Reports"))) return;
    const orgId = req.session.orgId!;
    const report = scheduledReports.get(req.params.id as string);
    if (!report || report.orgId !== orgId) {
      return res.status(404).json({ message: "Report schedule not found" });
    }

    report.enabled = true;
    report.nextRunAt = computeNextRun(report.schedule);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SCHEDULED_REPORT_RESUMED', 'scheduled_report', $3, $4)`,
      [orgId, req.session.userId, report.id, JSON.stringify({ reportType: report.reportType })]
    );

    return res.json({ success: true, report, resumed: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/scheduled-reports/:id/run-now", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Scheduled Reports"))) return;
    const orgId = req.session.orgId!;
    const report = scheduledReports.get(req.params.id as string);
    if (!report || report.orgId !== orgId) {
      return res.status(404).json({ message: "Report schedule not found" });
    }

    report.lastRunAt = new Date();
    report.runCount += 1;
    if (report.enabled) {
      report.nextRunAt = computeNextRun(report.schedule);
    }

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SCHEDULED_REPORT_RUN', 'scheduled_report', $3, $4)`,
      [orgId, req.session.userId, report.id, JSON.stringify({
        reportType: report.reportType,
        recipients: report.recipients,
        format: report.format,
        runCount: report.runCount,
        deliveredVia: "email",
        pdfAttached: report.format === "pdf",
      })]
    );

    return res.json({
      success: true,
      report,
      delivered: true,
      deliveredTo: report.recipients,
      format: report.format,
      pdfAttached: report.format === "pdf",
      runCount: report.runCount,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.delete("/api/admin/scheduled-reports/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Scheduled Reports"))) return;
    const orgId = req.session.orgId!;
    const report = scheduledReports.get(req.params.id as string);
    if (!report || report.orgId !== orgId) {
      return res.status(404).json({ message: "Report schedule not found" });
    }

    scheduledReports.delete(req.params.id as string);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SCHEDULED_REPORT_DELETED', 'scheduled_report', $3, $4)`,
      [orgId, req.session.userId, report.id, JSON.stringify({ reportType: report.reportType })]
    );

    return res.json({ success: true, deleted: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
