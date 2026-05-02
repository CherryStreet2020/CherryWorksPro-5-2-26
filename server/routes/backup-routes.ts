import type { Express, Request, Response } from "express";
import { requireAdmin , requirePlanTier } from "./middleware";
import { db } from "../db";
import { sql } from "drizzle-orm";

const BACKUP_TABLES = [
  "organizations", "users", "clients", "services", "projects", "project_members",
  "time_entries", "invoices", "invoice_lines", "payments",
  "team_member_payouts_v2", "expenses", "expense_reports", "gl_accounts",
  "gl_journal_entries", "gl_journal_lines", "audit_logs", "stripe_events",
  "password_reset_tokens", "webhook_endpoints", "import_runs", "imported_keys",
];

export function registerBackupRoutes(app: Express) {

  app.get("/api/admin/backup", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const snapshot: Record<string, any[]> = {};
      const counts: Record<string, number> = {};

      for (const table of BACKUP_TABLES) {
        try {
          const hasOrgId = await db.execute(sql.raw(
            `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' AND column_name='org_id'`
          ));
          const orgRows = (hasOrgId as any).rows || hasOrgId;
          let rows: any[];
          if (orgRows && orgRows.length > 0) {
            const result = await db.execute(sql.raw(
              `SELECT * FROM ${table} WHERE org_id='${orgId}'`
            ));
            rows = (result as any).rows || result as any;
          } else {
            rows = [];
          }
          snapshot[table] = Array.isArray(rows) ? rows : [];
          counts[table] = snapshot[table].length;
        } catch {
          snapshot[table] = [];
          counts[table] = 0;
        }
      }

      return res.json({
        success: true,
        orgId,
        timestamp: new Date().toISOString(),
        counts,
        data: snapshot,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/backup/verify", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "Backup Drill & Restore"))) return;
      const orgId = req.session.orgId!;
      const { counts: expectedCounts } = req.body;
      if (!expectedCounts || typeof expectedCounts !== "object") {
        return res.status(400).json({ message: "Expected counts object required" });
      }

      const currentCounts: Record<string, number> = {};
      const divergences: Record<string, { expected: number; actual: number }> = {};

      for (const table of BACKUP_TABLES) {
        try {
          const hasOrgId = await db.execute(sql.raw(
            `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' AND column_name='org_id'`
          ));
          const orgRows = (hasOrgId as any).rows || hasOrgId;
          if (orgRows && orgRows.length > 0) {
            const result = await db.execute(sql.raw(
              `SELECT COUNT(*) as cnt FROM ${table} WHERE org_id='${orgId}'`
            ));
            const rows = (result as any).rows || result;
            currentCounts[table] = Number(rows[0]?.cnt || 0);
          } else {
            currentCounts[table] = 0;
          }
        } catch {
          currentCounts[table] = 0;
        }

        const expected = Number(expectedCounts[table] ?? 0);
        const actual = currentCounts[table];
        if (expected !== actual) {
          divergences[table] = { expected, actual };
        }
      }

      return res.json({
        success: true,
        orgId,
        currentCounts,
        divergences,
        zeroDivergence: Object.keys(divergences).length === 0,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

}
