import type { Express, Request, Response } from "express";
import { requireAuth , requirePlanTier } from "./middleware";

interface WidgetConfig {
  id: string; widgetType: string; label: string;
  enabled: boolean; order: number; size: "small" | "medium" | "large";
}

interface UserDashboardPrefs {
  userId: string; orgId: string; widgets: WidgetConfig[]; updatedAt: string;
}

const dashboardPrefs = new Map<string, UserDashboardPrefs>();

const ADMIN_WIDGETS: WidgetConfig[] = [
  { id: "revenue", widgetType: "revenue", label: "Revenue Overview", enabled: true, order: 1, size: "large" },
  { id: "ar-aging", widgetType: "ar-aging", label: "Accounts Receivable Aging", enabled: true, order: 2, size: "medium" },
  { id: "utilization", widgetType: "utilization", label: "Team Utilization", enabled: true, order: 3, size: "medium" },
  { id: "cashflow", widgetType: "cashflow", label: "Cash Flow Forecast", enabled: true, order: 4, size: "large" },
  { id: "recent-invoices", widgetType: "recent-invoices", label: "Recent Invoices", enabled: true, order: 5, size: "medium" },
  { id: "top-clients", widgetType: "top-clients", label: "Top Clients by Revenue", enabled: true, order: 6, size: "medium" },
  { id: "overdue", widgetType: "overdue", label: "Overdue Invoices", enabled: true, order: 7, size: "small" },
  { id: "budget-status", widgetType: "budget-status", label: "Project Budget Status", enabled: true, order: 8, size: "medium" },
];

const TEAM_MEMBER_WIDGETS: WidgetConfig[] = [
  { id: "my-hours", widgetType: "my-hours", label: "My Hours This Week", enabled: true, order: 1, size: "medium" },
  { id: "my-projects", widgetType: "my-projects", label: "Active Projects", enabled: true, order: 2, size: "large" },
  { id: "upcoming-invoices", widgetType: "upcoming-invoices", label: "Upcoming Invoices", enabled: true, order: 3, size: "medium" },
  { id: "my-timesheet", widgetType: "my-timesheet", label: "Timesheet Summary", enabled: true, order: 4, size: "medium" },
  { id: "my-expenses", widgetType: "my-expenses", label: "My Recent Expenses", enabled: true, order: 5, size: "small" },
  { id: "my-tasks", widgetType: "my-tasks", label: "My Tasks", enabled: true, order: 6, size: "medium" },
];

function getDefaultWidgets(role: string): WidgetConfig[] {
  return (role === "ADMIN" ? ADMIN_WIDGETS : TEAM_MEMBER_WIDGETS).map((w) => ({ ...w }));
}

function getUserPrefs(userId: string, orgId: string, role: string): UserDashboardPrefs {
  const key = `${orgId}:${userId}`;
  let prefs = dashboardPrefs.get(key);
  if (!prefs) {
    prefs = { userId, orgId, widgets: getDefaultWidgets(role), updatedAt: new Date().toISOString() };
    dashboardPrefs.set(key, prefs);
  }
  return prefs;
}

function getWidgetData(widgetType: string): any {
  switch (widgetType) {
    case "revenue": return { mtd: 45200, ytd: 312000, growth: 12.5 };
    case "ar-aging": return { current: 8500, "30d": 3200, "60d": 1100, "90d": 450 };
    case "utilization": return { teamAvg: 78, target: 80, byMember: [] };
    case "cashflow": return { projected30d: 62000, projected60d: 115000 };
    case "my-hours": return { thisWeek: 32, target: 40, lastWeek: 38 };
    case "my-projects": return { active: 3, total: 5 };
    case "upcoming-invoices": return { count: 2, totalAmount: 4800 };
    default: return {};
  }
}

export function registerRoleDashboardsRoutes(app: Express) {
  app.get("/api/dashboard/role-config", requireAuth, (req: Request, res: Response) => {
    const role = req.session.role || "TEAM_MEMBER";
    const prefs = getUserPrefs(req.session.userId!, req.session.orgId!, role);

    const widgetData: any = {};
    for (const w of prefs.widgets.filter((w) => w.enabled)) {
      widgetData[w.id] = getWidgetData(w.widgetType);
    }

    res.json({ success: true, role, widgets: prefs.widgets.sort((a, b) => a.order - b.order), widgetData, updatedAt: prefs.updatedAt });
  });

  app.put("/api/dashboard/role-config/widgets", requireAuth, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Role-Based Dashboards"))) return;
    const { widgets } = req.body;
    if (!widgets || !Array.isArray(widgets)) return res.status(400).json({ error: "widgets array required" });

    const role = req.session.role || "TEAM_MEMBER";
    const key = `${req.session.orgId}:${req.session.userId}`;
    const prefs = getUserPrefs(req.session.userId!, req.session.orgId!, role);

    for (const update of widgets) {
      const existing = prefs.widgets.find((w) => w.id === update.id);
      if (existing) {
        if (typeof update.enabled === "boolean") existing.enabled = update.enabled;
        if (typeof update.order === "number") existing.order = update.order;
        if (update.size) existing.size = update.size;
      }
    }
    prefs.updatedAt = new Date().toISOString();
    dashboardPrefs.set(key, prefs);
    res.json({ success: true, widgets: prefs.widgets.sort((a, b) => a.order - b.order), updatedAt: prefs.updatedAt });
  });

  app.post("/api/dashboard/role-config/reset", requireAuth, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Role-Based Dashboards"))) return;
    const role = req.session.role || "TEAM_MEMBER";
    const key = `${req.session.orgId}:${req.session.userId}`;
    const prefs: UserDashboardPrefs = { userId: req.session.userId!, orgId: req.session.orgId!, widgets: getDefaultWidgets(role), updatedAt: new Date().toISOString() };
    dashboardPrefs.set(key, prefs);
    res.json({ success: true, reset: true, widgets: prefs.widgets, role });
  });

  app.get("/api/dashboard/role-config/available-widgets", requireAuth, (req: Request, res: Response) => {
    res.json({ success: true, role: req.session.role || "TEAM_MEMBER", adminWidgets: ADMIN_WIDGETS, teamMemberWidgets: TEAM_MEMBER_WIDGETS });
  });

  app.get("/api/dashboard/role-config/widget/:widgetId/data", requireAuth, (req: Request, res: Response) => {
    const role = req.session.role || "TEAM_MEMBER";
    const prefs = getUserPrefs(req.session.userId!, req.session.orgId!, role);
    const widget = prefs.widgets.find((w) => w.id === req.params.widgetId);
    if (!widget) return res.status(404).json({ error: "Widget not found" });
    const data = getWidgetData(widget.widgetType);
    res.json({ success: true, widgetId: req.params.widgetId, widgetType: widget.widgetType, data });
  });
}
