import type { Express } from "express";
import { requireAuth } from "./middleware";
import { db } from "../db";
import { clients, projects, invoices, users, timesheetWeeks } from "@shared/schema";
import { eq, and, or, ilike, sql } from "drizzle-orm";

export function registerSearchRoutes(app: Express) {
  app.get("/api/search", requireAuth, async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 1) return res.json({ results: [] });

    const orgId = req.session.orgId!;
    const pattern = `%${q}%`;
    const start = Date.now();

    try {
      const [clientResults, projectResults, invoiceResults, teamMemberResults, timesheetResults] = await Promise.all([
        db.select({ id: clients.id, name: clients.name, email: clients.email })
          .from(clients)
          .where(and(
            eq(clients.orgId, orgId),
            or(ilike(clients.name, pattern), ilike(clients.email, pattern))
          ))
          .limit(5),

        db.select({ id: projects.id, name: projects.name, status: projects.status })
          .from(projects)
          .where(and(
            eq(projects.orgId, orgId),
            ilike(projects.name, pattern)
          ))
          .limit(5),

        db.select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total })
          .from(invoices)
          .where(and(
            eq(invoices.orgId, orgId),
            or(ilike(invoices.number, pattern), ilike(sql`CAST(${invoices.total} AS TEXT)`, pattern))
          ))
          .limit(5),

        db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
          .from(users)
          .where(and(
            eq(users.orgId, orgId),
            eq(users.role, "TEAM_MEMBER"),
            or(ilike(users.name, pattern), ilike(users.email, pattern))
          ))
          .limit(5),

        db.select({ id: timesheetWeeks.id, weekStartDate: timesheetWeeks.weekStartDate, status: timesheetWeeks.status, userId: timesheetWeeks.userId })
          .from(timesheetWeeks)
          .where(and(
            eq(timesheetWeeks.orgId, orgId),
            ilike(sql`CAST(${timesheetWeeks.weekStartDate} AS TEXT)`, pattern)
          ))
          .limit(5),
      ]);

      const results = [
        ...clientResults.map(c => ({ type: "client" as const, id: c.id, label: c.name, sublabel: c.email || "", url: `/clients` })),
        ...projectResults.map(p => ({ type: "project" as const, id: p.id, label: p.name, sublabel: p.status || "", url: `/projects` })),
        ...invoiceResults.map(i => ({ type: "invoice" as const, id: i.id, label: i.number, sublabel: `$${i.total} · ${i.status}`, url: `/invoices` })),
        ...teamMemberResults.map(u => ({ type: "team_member" as const, id: u.id, label: u.name, sublabel: u.email, url: `/team` })),
        ...timesheetResults.map(t => ({ type: "timesheet" as const, id: t.id, label: `Week of ${t.weekStartDate}`, sublabel: t.status || "", url: `/time` })),
      ];

      const durationMs = Date.now() - start;
      res.json({ results, durationMs });
    } catch (err) {
      console.error("[search] Error:", err);
      res.status(500).json({ message: "Search failed" });
    }
  });
}
