import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { randomUUID } from "crypto";

interface DunningConfig {
  orgId: string;
  enabled: boolean;
  schedulesDays: number[];
  escalationDays: number;
  templates: Record<number, { subject: string; body: string }>;
  updatedAt: Date;
}

interface DunningSend {
  id: string;
  orgId: string;
  invoiceId: string;
  clientId: string;
  clientEmail: string;
  daysPastDue: number;
  scheduleDay: number;
  status: "sent" | "paused" | "escalated";
  sentAt: Date;
}

const dunningConfigs = new Map<string, DunningConfig>();
const dunningSends = new Map<string, DunningSend>();
const pausedClients = new Map<string, Set<string>>();

const DEFAULT_SCHEDULES = [7, 14, 30, 60];
const DEFAULT_TEMPLATES: Record<number, { subject: string; body: string }> = {
  7: { subject: "Friendly Reminder: Invoice #{number} is past due", body: "Hi {clientName},\n\nThis is a friendly reminder that invoice #{number} for {amount} was due on {dueDate}. Please arrange payment at your earliest convenience.\n\nBest regards,\n{orgName}" },
  14: { subject: "Second Notice: Invoice #{number} is 14 days overdue", body: "Hi {clientName},\n\nInvoice #{number} for {amount} is now 14 days past due. Please process payment as soon as possible to avoid further action.\n\nRegards,\n{orgName}" },
  30: { subject: "Important: Invoice #{number} is 30 days overdue", body: "Dear {clientName},\n\nInvoice #{number} for {amount} is now 30 days overdue. Immediate payment is required. Please contact us if you need to discuss payment arrangements.\n\n{orgName}" },
  60: { subject: "Final Notice: Invoice #{number} — 60+ days overdue", body: "Dear {clientName},\n\nThis is a final notice regarding invoice #{number} for {amount}, now over 60 days past due. This matter has been escalated to management. Please contact us immediately.\n\n{orgName}" },
};

function getOrgConfig(orgId: string): DunningConfig {
  let config = dunningConfigs.get(orgId);
  if (!config) {
    config = {
      orgId,
      enabled: true,
      schedulesDays: [...DEFAULT_SCHEDULES],
      escalationDays: 60,
      templates: { ...DEFAULT_TEMPLATES },
      updatedAt: new Date(),
    };
    dunningConfigs.set(orgId, config);
  }
  return config;
}

export function registerDunningRoutes(app: Express) {

app.get("/api/admin/dunning/config", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const config = getOrgConfig(orgId);
    return res.json({
      config,
      defaultSchedules: DEFAULT_SCHEDULES,
      escalationDays: config.escalationDays,
      templateCount: Object.keys(config.templates).length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/dunning/config", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Dunning Automation"))) return;
    const orgId = req.session.orgId!;
    const config = getOrgConfig(orgId);
    const { schedulesDays, escalationDays, enabled } = req.body;

    if (schedulesDays) config.schedulesDays = schedulesDays;
    if (escalationDays) config.escalationDays = escalationDays;
    if (typeof enabled === "boolean") config.enabled = enabled;
    config.updatedAt = new Date();

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'DUNNING_CONFIG_UPDATED', 'dunning', 'config', $3)`,
      [orgId, req.session.userId, JSON.stringify({ schedulesDays: config.schedulesDays, escalationDays: config.escalationDays, enabled: config.enabled })]
    );

    return res.json({ success: true, config });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/dunning/config/templates/:day", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Dunning Automation"))) return;
    const orgId = req.session.orgId!;
    const day = parseInt(req.params.day as string);
    const config = getOrgConfig(orgId);
    const { subject, body } = req.body;

    if (!subject || !body) return res.status(400).json({ message: "subject and body are required" });

    config.templates[day] = { subject, body };
    config.updatedAt = new Date();

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'DUNNING_TEMPLATE_UPDATED', 'dunning', $3, $4)`,
      [orgId, req.session.userId, String(day), JSON.stringify({ day, subject })]
    );

    return res.json({ success: true, day, template: config.templates[day] });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/dunning/simulate-send", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Dunning Automation"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { invoiceId, clientId, clientEmail, daysPastDue } = req.body;

    if (!invoiceId) return res.status(400).json({ message: "invoiceId is required" });
    if (!daysPastDue) return res.status(400).json({ message: "daysPastDue is required" });

    const config = getOrgConfig(orgId);
    const paused = pausedClients.get(orgId)?.has(clientId || "");
    if (paused) {
      return res.json({ success: true, sent: false, paused: true, reason: "Client dunning is paused" });
    }

    const scheduleDay = config.schedulesDays.reduce((prev, curr) =>
      daysPastDue >= curr ? curr : prev, config.schedulesDays[0]);

    const isEscalation = daysPastDue >= config.escalationDays;
    const id = randomUUID();
    const send: DunningSend = {
      id,
      orgId,
      invoiceId,
      clientId: clientId || "unknown",
      clientEmail: clientEmail || "client@example.com",
      daysPastDue,
      scheduleDay,
      status: isEscalation ? "escalated" : "sent",
      sentAt: new Date(),
    };

    dunningSends.set(id, send);

    const template = config.templates[scheduleDay] || config.templates[config.schedulesDays[0]];

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, $3, 'dunning', $4, $5)`,
      [orgId, userId,
       isEscalation ? "DUNNING_ESCALATED" : "DUNNING_EMAIL_SENT",
       invoiceId,
       JSON.stringify({ sendId: id, daysPastDue, scheduleDay, clientEmail: send.clientEmail, escalated: isEscalation, templateSubject: template?.subject })]
    );

    return res.json({
      success: true,
      sent: true,
      send,
      template: template ? { subject: template.subject } : null,
      escalated: isEscalation,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/dunning/sends", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const sends = Array.from(dunningSends.values()).filter(s => s.orgId === orgId);
    return res.json({
      sends,
      count: sends.length,
      sentCount: sends.filter(s => s.status === "sent").length,
      escalatedCount: sends.filter(s => s.status === "escalated").length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/dunning/pause-client", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Dunning Automation"))) return;
    const orgId = req.session.orgId!;
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ message: "clientId is required" });

    if (!pausedClients.has(orgId)) pausedClients.set(orgId, new Set());
    pausedClients.get(orgId)!.add(clientId);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'DUNNING_CLIENT_PAUSED', 'dunning', $3, $4)`,
      [orgId, req.session.userId, clientId, JSON.stringify({ clientId })]
    );

    return res.json({ success: true, clientId, paused: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/dunning/resume-client", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Dunning Automation"))) return;
    const orgId = req.session.orgId!;
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ message: "clientId is required" });

    pausedClients.get(orgId)?.delete(clientId);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'DUNNING_CLIENT_RESUMED', 'dunning', $3, $4)`,
      [orgId, req.session.userId, clientId, JSON.stringify({ clientId })]
    );

    return res.json({ success: true, clientId, paused: false });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/dunning/paused-clients", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const paused = Array.from(pausedClients.get(orgId) || []);
    return res.json({ pausedClients: paused, count: paused.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/dunning/overdue-invoices", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const result = await pool.query(
      `SELECT i.id, i.number, i.status, i.total, i.paid_amount, i.due_date, c.name as client_name, c.id as client_id, c.email as client_email,
              EXTRACT(DAY FROM NOW() - i.due_date::timestamp) as days_overdue
       FROM invoices i JOIN clients c ON i.client_id = c.id
       WHERE i.org_id = $1 AND i.status IN ('sent', 'overdue', 'partial') AND i.due_date < NOW()
       ORDER BY i.due_date ASC LIMIT 100`, [orgId]
    );

    const config = getOrgConfig(orgId);
    const invoices = result.rows.map(r => ({
      ...r,
      days_overdue: Math.floor(parseFloat(r.days_overdue || "0")),
      dunningStage: config.schedulesDays.reduce((prev: number, curr: number) =>
        parseFloat(r.days_overdue || "0") >= curr ? curr : prev, 0),
      needsEscalation: parseFloat(r.days_overdue || "0") >= config.escalationDays,
    }));

    return res.json({ overdueInvoices: invoices, count: invoices.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
