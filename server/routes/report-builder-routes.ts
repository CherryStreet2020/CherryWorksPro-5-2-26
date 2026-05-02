import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { randomUUID } from "crypto";

interface CustomReport {
  id: string;
  orgId: string;
  name: string;
  description: string;
  entity: string;
  fields: string[];
  filters: Array<{ field: string; operator: string; value: string }>;
  groupBy: string[];
  sortBy: Array<{ field: string; direction: string }>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  runCount: number;
  scheduledReportId: string | null;
}

const reportLibrary = new Map<string, CustomReport>();

const AVAILABLE_ENTITIES = [
  {
    key: "invoices",
    label: "Invoices",
    fields: ["id", "number", "status", "total", "paidAmount", "clientId", "clientName", "dueDate", "createdAt", "sentAt"],
    filterOperators: ["equals", "not_equals", "greater_than", "less_than", "contains", "between", "in"],
  },
  {
    key: "payments",
    label: "Payments",
    fields: ["id", "invoiceId", "amount", "method", "paidAt", "clientName"],
    filterOperators: ["equals", "not_equals", "greater_than", "less_than", "between"],
  },
  {
    key: "time_entries",
    label: "Time Entries",
    fields: ["id", "userId", "userName", "projectId", "projectName", "minutes", "date", "billable", "notes"],
    filterOperators: ["equals", "not_equals", "greater_than", "less_than", "between", "contains"],
  },
  {
    key: "expenses",
    label: "Expenses",
    fields: ["id", "userId", "userName", "description", "amount", "category", "status", "date"],
    filterOperators: ["equals", "not_equals", "greater_than", "less_than", "contains"],
  },
  {
    key: "clients",
    label: "Clients",
    fields: ["id", "name", "email", "phone", "address", "createdAt", "invoiceCount", "totalBilled"],
    filterOperators: ["equals", "not_equals", "contains"],
  },
  {
    key: "projects",
    label: "Projects",
    fields: ["id", "name", "clientName", "status", "budget", "hoursLogged", "startDate", "endDate"],
    filterOperators: ["equals", "not_equals", "contains", "between"],
  },
];

export function registerReportBuilderRoutes(app: Express) {

app.get("/api/admin/report-builder/entities", requireAdmin, async (_req: Request, res: Response) => {
  return res.json({ entities: AVAILABLE_ENTITIES, count: AVAILABLE_ENTITIES.length });
});

app.get("/api/admin/report-builder/entities/:key", requireAdmin, async (req: Request, res: Response) => {
  const entity = AVAILABLE_ENTITIES.find(e => e.key === req.params.key);
  if (!entity) return res.status(404).json({ message: "Entity not found" });
  return res.json({ entity });
});

app.post("/api/admin/report-builder/reports", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Custom Report Builder"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { name, description, entity, fields, filters, groupBy, sortBy } = req.body;

    if (!name) return res.status(400).json({ message: "name is required" });
    if (!entity) return res.status(400).json({ message: "entity is required" });
    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ message: "fields array is required (min 1)" });
    }

    const validEntity = AVAILABLE_ENTITIES.find(e => e.key === entity);
    if (!validEntity) return res.status(400).json({ message: `Invalid entity. Valid: ${AVAILABLE_ENTITIES.map(e => e.key).join(", ")}` });

    const id = randomUUID();
    const report: CustomReport = {
      id,
      orgId,
      name,
      description: description || "",
      entity,
      fields,
      filters: filters || [],
      groupBy: groupBy || [],
      sortBy: sortBy || [],
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastRunAt: null,
      runCount: 0,
      scheduledReportId: null,
    };

    reportLibrary.set(id, report);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CUSTOM_REPORT_CREATED', 'custom_report', $3, $4)`,
      [orgId, userId, id, JSON.stringify({ name, entity, fieldCount: fields.length, filterCount: (filters || []).length })]
    );

    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/report-builder/reports", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const reports = Array.from(reportLibrary.values()).filter(r => r.orgId === orgId);
    return res.json({ reports, count: reports.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/report-builder/reports/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const report = reportLibrary.get(req.params.id as string);
    if (!report || report.orgId !== orgId) return res.status(404).json({ message: "Report not found" });
    return res.json({ report });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.put("/api/admin/report-builder/reports/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Custom Report Builder"))) return;
    const orgId = req.session.orgId!;
    const report = reportLibrary.get(req.params.id as string);
    if (!report || report.orgId !== orgId) return res.status(404).json({ message: "Report not found" });

    const { name, description, fields, filters, groupBy, sortBy } = req.body;
    if (name) report.name = name;
    if (description !== undefined) report.description = description;
    if (fields) report.fields = fields;
    if (filters) report.filters = filters;
    if (groupBy) report.groupBy = groupBy;
    if (sortBy) report.sortBy = sortBy;
    report.updatedAt = new Date();

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CUSTOM_REPORT_UPDATED', 'custom_report', $3, $4)`,
      [orgId, req.session.userId, report.id, JSON.stringify({ name: report.name })]
    );

    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/report-builder/reports/:id/run", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Custom Report Builder"))) return;
    const orgId = req.session.orgId!;
    const report = reportLibrary.get(req.params.id as string);
    if (!report || report.orgId !== orgId) return res.status(404).json({ message: "Report not found" });

    report.lastRunAt = new Date();
    report.runCount += 1;

    let data: any[] = [];
    let totalRows = 0;

    if (report.entity === "invoices") {
      const result = await pool.query(
        `SELECT i.id, i.number, i.status, i.total, i.paid_amount, i.due_date, i.created_at,
                c.name as client_name
         FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
         WHERE i.org_id = $1 ORDER BY i.created_at DESC LIMIT 100`, [orgId]
      );
      data = result.rows;
      totalRows = result.rows.length;
    } else if (report.entity === "clients") {
      const result = await pool.query(
        `SELECT c.id, c.name, c.email, c.phone, c.created_at,
                COUNT(i.id) as invoice_count, COALESCE(SUM(CAST(i.total AS DECIMAL) * COALESCE(CAST(i.exchange_rate AS DECIMAL), 1)), 0) as total_billed
         FROM clients c LEFT JOIN invoices i ON c.id = i.client_id
         WHERE c.org_id = $1 GROUP BY c.id ORDER BY c.name LIMIT 100`, [orgId]
      );
      data = result.rows;
      totalRows = result.rows.length;
    } else if (report.entity === "payments") {
      const result = await pool.query(
        `SELECT p.id, p.invoice_id, p.amount, p.method, p.paid_at
         FROM payments p JOIN invoices i ON p.invoice_id = i.id
         WHERE i.org_id = $1 ORDER BY p.paid_at DESC LIMIT 100`, [orgId]
      );
      data = result.rows;
      totalRows = result.rows.length;
    } else if (report.entity === "expenses") {
      const result = await pool.query(
        `SELECT e.id, e.description, e.amount, e.category, e.status, e.date
         FROM expenses e WHERE e.org_id = $1 ORDER BY e.date DESC LIMIT 100`, [orgId]
      );
      data = result.rows;
      totalRows = result.rows.length;
    } else {
      const result = await pool.query(
        `SELECT id, name, status FROM projects WHERE org_id = $1 LIMIT 100`, [orgId]
      );
      data = result.rows;
      totalRows = result.rows.length;
    }

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CUSTOM_REPORT_RUN', 'custom_report', $3, $4)`,
      [orgId, req.session.userId, report.id, JSON.stringify({ name: report.name, entity: report.entity, rows: totalRows, runCount: report.runCount })]
    );

    return res.json({
      success: true,
      report: { id: report.id, name: report.name, entity: report.entity },
      data,
      totalRows,
      fields: report.fields,
      filters: report.filters,
      groupBy: report.groupBy,
      sortBy: report.sortBy,
      runAt: report.lastRunAt!.toISOString(),
      runCount: report.runCount,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/report-builder/reports/:id/schedule", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Custom Report Builder"))) return;
    const orgId = req.session.orgId!;
    const report = reportLibrary.get(req.params.id as string);
    if (!report || report.orgId !== orgId) return res.status(404).json({ message: "Report not found" });

    const { schedule, recipients } = req.body;
    if (!schedule) return res.status(400).json({ message: "schedule is required" });
    if (!recipients || !Array.isArray(recipients)) return res.status(400).json({ message: "recipients array required" });

    const scheduledId = randomUUID();
    report.scheduledReportId = scheduledId;

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CUSTOM_REPORT_SCHEDULED', 'custom_report', $3, $4)`,
      [orgId, req.session.userId, report.id, JSON.stringify({ schedule, recipients, scheduledId })]
    );

    return res.json({
      success: true,
      scheduledReportId: scheduledId,
      reportId: report.id,
      schedule,
      recipients,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.delete("/api/admin/report-builder/reports/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Custom Report Builder"))) return;
    const orgId = req.session.orgId!;
    const report = reportLibrary.get(req.params.id as string);
    if (!report || report.orgId !== orgId) return res.status(404).json({ message: "Report not found" });

    reportLibrary.delete(req.params.id as string);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CUSTOM_REPORT_DELETED', 'custom_report', $3, $4)`,
      [orgId, req.session.userId, req.params.id, JSON.stringify({ name: report.name })]
    );

    return res.json({ success: true, deleted: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
