import type { Express } from "express";
import { requireAuth } from "./middleware";
import { db } from "../db";
import { clients, projects, invoices, users, timesheetWeeks, expenses } from "@shared/schema";
import { eq, and, or, ilike, sql, desc } from "drizzle-orm";

export function registerGlobalSearchRoutes(app: Express) {

app.get("/api/search/global", requireAuth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q || q.length < 1) return res.json({ results: [], durationMs: 0 });

  const orgId = req.session.orgId!;
  const pattern = `%${q}%`;
  const start = Date.now();
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 25);

  try {
    const [clientResults, projectResults, invoiceResults, teamMemberResults, timesheetResults, expenseResults] = await Promise.all([
      db.select({ id: clients.id, name: clients.name, email: clients.email })
        .from(clients)
        .where(and(
          eq(clients.orgId, orgId),
          or(ilike(clients.name, pattern), ilike(clients.email, pattern))
        ))
        .limit(limit),

      db.select({ id: projects.id, name: projects.name, status: projects.status })
        .from(projects)
        .where(and(
          eq(projects.orgId, orgId),
          ilike(projects.name, pattern)
        ))
        .limit(limit),

      db.select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total })
        .from(invoices)
        .where(and(
          eq(invoices.orgId, orgId),
          or(ilike(invoices.number, pattern), ilike(sql`CAST(${invoices.total} AS TEXT)`, pattern))
        ))
        .limit(limit),

      db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
        .from(users)
        .where(and(
          eq(users.orgId, orgId),
          eq(users.role, "TEAM_MEMBER"),
          or(ilike(users.name, pattern), ilike(users.email, pattern))
        ))
        .limit(limit),

      db.select({ id: timesheetWeeks.id, weekStartDate: timesheetWeeks.weekStartDate, status: timesheetWeeks.status })
        .from(timesheetWeeks)
        .where(and(
          eq(timesheetWeeks.orgId, orgId),
          ilike(sql`CAST(${timesheetWeeks.weekStartDate} AS TEXT)`, pattern)
        ))
        .limit(limit),

      db.select({ id: expenses.id, description: expenses.description, amount: expenses.amount, category: expenses.category })
        .from(expenses)
        .where(and(
          eq(expenses.orgId, orgId),
          or(ilike(expenses.description, pattern), ilike(expenses.category, pattern))
        ))
        .limit(limit),
    ]);

    const results = [
      ...clientResults.map(c => ({ type: "client" as const, id: c.id, label: c.name, sublabel: c.email || "", url: `/clients`, icon: "users" })),
      ...projectResults.map(p => ({ type: "project" as const, id: p.id, label: p.name, sublabel: p.status || "", url: `/projects`, icon: "briefcase" })),
      ...invoiceResults.map(i => ({ type: "invoice" as const, id: i.id, label: i.number, sublabel: `$${i.total} · ${i.status}`, url: `/invoices`, icon: "file-text" })),
      ...teamMemberResults.map(u => ({ type: "team_member" as const, id: u.id, label: u.name, sublabel: u.email, url: `/team`, icon: "user" })),
      ...timesheetResults.map(t => ({ type: "timesheet" as const, id: t.id, label: `Week of ${t.weekStartDate}`, sublabel: t.status || "", url: `/time`, icon: "clock" })),
      ...expenseResults.map(e => ({ type: "expense" as const, id: e.id, label: e.description || "Expense", sublabel: `$${e.amount} · ${e.category || ""}`, url: `/expenses`, icon: "receipt" })),
    ];

    const durationMs = Date.now() - start;
    res.json({
      results,
      total: results.length,
      durationMs,
      query: q,
      p95Target: 100,
      withinTarget: durationMs <= 100,
    });
  } catch (err) {
    console.error("[global-search] Error:", err);
    res.status(500).json({ message: "Search failed" });
  }
});

app.get("/api/search/global/categories", requireAuth, async (_req, res) => {
  return res.json({
    categories: [
      { key: "client", label: "Clients", icon: "users" },
      { key: "project", label: "Projects", icon: "briefcase" },
      { key: "invoice", label: "Invoices", icon: "file-text" },
      { key: "team_member", label: "Team Members", icon: "user" },
      { key: "timesheet", label: "Timesheets", icon: "clock" },
      { key: "expense", label: "Expenses", icon: "receipt" },
    ],
    shortcut: "⌘K / Ctrl+K",
  });
});

}
