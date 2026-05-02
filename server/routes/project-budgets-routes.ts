import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface ProjectBudget {
  id: string;
  orgId: string;
  projectId: string;
  hoursBudget: number | null;
  dollarBudget: number | null;
  alertAt80: boolean;
  alertAt100: boolean;
  alertOverBudget: boolean;
  alertEmails: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface BudgetAlert {
  id: string;
  orgId: string;
  projectId: string;
  threshold: string;
  consumptionPct: number;
  sentAt: Date;
  emailsSent: string[];
}

const projectBudgets = new Map<string, ProjectBudget>();
const budgetAlerts = new Map<string, BudgetAlert>();

export function registerProjectBudgetRoutes(app: Express) {

app.post("/api/admin/project-budgets", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Project Budgets"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { projectId, hoursBudget, dollarBudget, alertAt80, alertAt100, alertOverBudget, alertEmails } = req.body;

    if (!projectId) return res.status(400).json({ message: "projectId is required" });
    if (!hoursBudget && !dollarBudget) return res.status(400).json({ message: "At least one of hoursBudget or dollarBudget is required" });

    const id = randomUUID();
    const budget: ProjectBudget = {
      id,
      orgId,
      projectId,
      hoursBudget: hoursBudget || null,
      dollarBudget: dollarBudget || null,
      alertAt80: alertAt80 !== false,
      alertAt100: alertAt100 !== false,
      alertOverBudget: alertOverBudget !== false,
      alertEmails: alertEmails || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    projectBudgets.set(projectId, budget);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'PROJECT_BUDGET_SET', 'project_budget', $3, $4)`,
      [orgId, userId, projectId, JSON.stringify({ hoursBudget, dollarBudget, alertEmails })]
    );

    return res.json({ success: true, budget });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/project-budgets/:projectId", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const budget = projectBudgets.get(req.params.projectId as string);
    if (!budget || budget.orgId !== orgId) return res.status(404).json({ message: "Budget not found for this project" });

    const hoursResult = await pool.query(
      `SELECT COALESCE(SUM(minutes), 0) as total_minutes FROM time_entries WHERE project_id = $1 AND org_id = $2`,
      [req.params.projectId, orgId]
    );
    const totalMinutes = parseInt(hoursResult.rows[0]?.total_minutes || "0");
    const totalHours = totalMinutes / 60;

    const dollarResult = await pool.query(
      `SELECT COALESCE(SUM(CAST(total AS DECIMAL)), 0) as total_billed FROM invoices WHERE org_id = $1`,
      [orgId]
    );
    const totalDollars = parseFloat(dollarResult.rows[0]?.total_billed || "0");

    const hoursConsumptionPct = budget.hoursBudget ? Math.round((totalHours / budget.hoursBudget) * 10000) / 100 : null;
    const dollarConsumptionPct = budget.dollarBudget ? Math.round((totalDollars / budget.dollarBudget) * 10000) / 100 : null;

    return res.json({
      budget,
      consumption: {
        hoursUsed: Math.round(totalHours * 100) / 100,
        hoursBudget: budget.hoursBudget,
        hoursConsumptionPct,
        dollarsUsed: totalDollars,
        dollarBudget: budget.dollarBudget,
        dollarConsumptionPct,
      },
      alerts: {
        at80: budget.alertAt80,
        at100: budget.alertAt100,
        overBudget: budget.alertOverBudget,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/project-budgets", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const budgets = Array.from(projectBudgets.values()).filter(b => b.orgId === orgId);
    return res.json({ budgets, count: budgets.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.put("/api/admin/project-budgets/:projectId", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Project Budgets"))) return;
    const orgId = req.session.orgId!;
    const budget = projectBudgets.get(req.params.projectId as string);
    if (!budget || budget.orgId !== orgId) return res.status(404).json({ message: "Budget not found" });

    const { hoursBudget, dollarBudget, alertAt80, alertAt100, alertOverBudget, alertEmails } = req.body;
    if (hoursBudget !== undefined) budget.hoursBudget = hoursBudget;
    if (dollarBudget !== undefined) budget.dollarBudget = dollarBudget;
    if (alertAt80 !== undefined) budget.alertAt80 = alertAt80;
    if (alertAt100 !== undefined) budget.alertAt100 = alertAt100;
    if (alertOverBudget !== undefined) budget.alertOverBudget = alertOverBudget;
    if (alertEmails !== undefined) budget.alertEmails = alertEmails;
    budget.updatedAt = new Date();

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'PROJECT_BUDGET_UPDATED', 'project_budget', $3, $4)`,
      [orgId, req.session.userId, req.params.projectId, JSON.stringify({ hoursBudget: budget.hoursBudget, dollarBudget: budget.dollarBudget })]
    );

    return res.json({ success: true, budget });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/project-budgets/:projectId/check-alerts", requireAuth, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Project Budgets"))) return;
    const orgId = req.session.orgId!;
    const budget = projectBudgets.get(req.params.projectId as string);
    if (!budget || budget.orgId !== orgId) return res.status(404).json({ message: "Budget not found" });

    const hoursResult = await pool.query(
      `SELECT COALESCE(SUM(minutes), 0) as total_minutes FROM time_entries WHERE project_id = $1 AND org_id = $2`,
      [req.params.projectId, orgId]
    );
    const totalHours = parseInt(hoursResult.rows[0]?.total_minutes || "0") / 60;
    const pct = budget.hoursBudget ? (totalHours / budget.hoursBudget) * 100 : 0;

    const alertsTriggered: string[] = [];
    if (budget.alertAt80 && pct >= 80 && pct < 100) alertsTriggered.push("80%");
    if (budget.alertAt100 && pct >= 100 && pct < 100.01) alertsTriggered.push("100%");
    if (budget.alertOverBudget && pct > 100) alertsTriggered.push("over_budget");

    for (const threshold of alertsTriggered) {
      const alertId = randomUUID();
      const alert: BudgetAlert = {
        id: alertId,
        orgId,
        projectId: req.params.projectId as string,
        threshold,
        consumptionPct: Math.round(pct * 100) / 100,
        sentAt: new Date(),
        emailsSent: budget.alertEmails,
      };
      budgetAlerts.set(alertId, alert);
    }

    return res.json({
      consumptionPct: Math.round(pct * 100) / 100,
      hoursUsed: Math.round(totalHours * 100) / 100,
      hoursBudget: budget.hoursBudget,
      alertsTriggered,
      alertCount: alertsTriggered.length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/project-budgets/dashboard/widget", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const budgets = Array.from(projectBudgets.values()).filter(b => b.orgId === orgId);
    const projects = [];

    for (const b of budgets) {
      const hoursResult = await pool.query(
        `SELECT COALESCE(SUM(minutes), 0) as total_minutes FROM time_entries WHERE project_id = $1 AND org_id = $2`,
        [b.projectId, orgId]
      );
      const totalHours = parseInt(hoursResult.rows[0]?.total_minutes || "0") / 60;
      const pct = b.hoursBudget ? Math.round((totalHours / b.hoursBudget) * 10000) / 100 : 0;

      const projResult = await pool.query(`SELECT name FROM projects WHERE id = $1`, [b.projectId]);

      projects.push({
        projectId: b.projectId,
        projectName: projResult.rows[0]?.name || "Unknown",
        hoursBudget: b.hoursBudget,
        hoursUsed: Math.round(totalHours * 100) / 100,
        consumptionPct: pct,
        status: pct >= 100 ? "over_budget" : pct >= 80 ? "warning" : "on_track",
      });
    }

    return res.json({
      widget: {
        totalProjects: projects.length,
        onTrack: projects.filter(p => p.status === "on_track").length,
        warning: projects.filter(p => p.status === "warning").length,
        overBudget: projects.filter(p => p.status === "over_budget").length,
        projects,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/project-budgets/alerts/history", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const alerts = Array.from(budgetAlerts.values()).filter(a => a.orgId === orgId);
    return res.json({ alerts, count: alerts.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
