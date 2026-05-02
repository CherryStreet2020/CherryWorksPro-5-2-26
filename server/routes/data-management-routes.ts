import type { Express, Request, Response } from "express";
import { requireAdmin } from "./middleware";
import { db } from "../db";
import { pool } from "../db";
import { sql } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import path from "path";
import fs from "fs";

const EXPORT_TABLES = [
  "orgs", "users", "clients", "client_contacts", "services", "projects",
  "project_members", "project_services", "time_entries", "timesheet_weeks",
  "invoices", "invoice_lines", "invoice_revisions", "payments",
  "estimates", "estimate_lines", "expenses", "expense_categories",
  "expense_reports", "team_member_payouts_v2", "imported_payouts",
  "payout_time_entries", "gl_accounts", "gl_journal_entries",
  "gl_journal_lines", "audit_logs", "outbox_emails",
  "recurring_invoice_templates", "import_runs", "imported_keys",
];

const WIPE_TABLES_ORDERED = [
  "payout_time_entries", "imported_payouts", "team_member_payouts_v2",
  "gl_journal_lines", "gl_journal_entries", "gl_accounts",
  "invoice_lines", "invoice_revisions", "payments", "invoices",
  "estimate_lines", "estimates",
  "time_entries", "timesheet_weeks",
  "expense_reports", "expenses", "expense_categories",
  "project_services", "project_members", "projects",
  "client_contacts", "clients", "services",
  "outbox_emails", "audit_logs",
  "recurring_invoice_templates",
  "import_runs", "imported_keys",
  "bank_transaction_matches", "bank_reconciliation_logs",
  "bank_transactions", "bank_connections",
  "webhook_deliveries", "webhook_endpoints",
  "stripe_events", "api_keys",
  "password_reset_tokens",
  "users", "orgs",
];

function escapeCSV(val: any): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowsToCSV(rows: any[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCSV).join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCSV(row[h])).join(","));
  }
  return lines.join("\n");
}

async function hasOrgColumn(table: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name='org_id'`,
    [table]
  );
  return result.rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return result.rows.length > 0;
}

export function registerDataManagementRoutes(app: Express) {

  app.get("/api/admin/data-export", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const archiver = await import("archiver");
      const archive = archiver.default("zip", { zlib: { level: 9 } });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="data-export-${orgId}-${Date.now()}.zip"`);
      archive.pipe(res);

      const manifest: Record<string, number> = {};

      for (const table of EXPORT_TABLES) {
        try {
          const exists = await tableExists(table);
          if (!exists) { manifest[table] = -1; continue; }

          const hasOrg = await hasOrgColumn(table);
          let rows: any[];
          if (hasOrg) {
            const result = await pool.query(`SELECT * FROM "${table}" WHERE org_id = $1`, [orgId]);
            rows = result.rows;
          } else if (table === "orgs") {
            const result = await pool.query(`SELECT * FROM "${table}" WHERE id = $1`, [orgId]);
            rows = result.rows;
          } else {
            rows = [];
          }

          manifest[table] = rows.length;
          if (rows.length > 0) {
            archive.append(rowsToCSV(rows), { name: `${table}.csv` });
          }
        } catch (err: any) {
          manifest[table] = -1;
        }
      }

      archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
      await archive.finalize();

    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({ message: err.message });
      }
    }
  });

  app.get("/api/admin/data-export/counts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const counts: Record<string, number> = {};

      for (const table of EXPORT_TABLES) {
        try {
          const exists = await tableExists(table);
          if (!exists) { counts[table] = 0; continue; }
          const hasOrg = await hasOrgColumn(table);
          if (hasOrg) {
            const result = await pool.query(`SELECT COUNT(*) as cnt FROM "${table}" WHERE org_id = $1`, [orgId]);
            counts[table] = Number(result.rows[0]?.cnt || 0);
          } else if (table === "orgs") {
            counts[table] = 1;
          } else {
            counts[table] = 0;
          }
        } catch {
          counts[table] = 0;
        }
      }

      return res.json({ orgId, counts, totalRows: Object.values(counts).reduce((a, b) => a + b, 0) });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/gdpr/erase-client", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const { clientId } = req.body;
      if (!clientId) return res.status(400).json({ message: "clientId is required" });

      const clientResult = await pool.query(
        `SELECT * FROM clients WHERE id = $1 AND org_id = $2`,
        [clientId, orgId]
      );
      if (clientResult.rows.length === 0) {
        return res.status(404).json({ message: "Client not found in this organization" });
      }
      const client = clientResult.rows[0];

      const invoiceTotals = await pool.query(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(total AS numeric)), 0) as total_amount
         FROM invoices WHERE client_id = $1 AND org_id = $2`,
        [clientId, orgId]
      );
      const paymentTotals = await pool.query(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(amount AS numeric)), 0) as total_amount
         FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = $1 AND org_id = $2)`,
        [clientId, orgId]
      );

      const redactedName = `[REDACTED-${clientId.substring(0, 8)}]`;
      const redactedEmail = `redacted-${clientId.substring(0, 8)}@erased.local`;

      await pool.query("BEGIN");
      try {
        await pool.query(
          `UPDATE clients SET
            name = $1, email = $2, phone = NULL, address = NULL,
            website = NULL, logo_url = NULL, portal_token = NULL,
            updated_at = NOW()
          WHERE id = $3 AND org_id = $4`,
          [redactedName, redactedEmail, clientId, orgId]
        );

        await pool.query(
          `DELETE FROM client_contacts WHERE client_id = $1`,
          [clientId]
        );

        await pool.query(
          `UPDATE invoices SET notes = NULL
           WHERE client_id = $1 AND org_id = $2`,
          [clientId, orgId]
        );

        const { storage } = await import("../storage");
        await storage.createAuditLog({
          orgId,
          userId: req.session.userId!,
          action: "GDPR_CLIENT_ERASURE",
          entityType: "client",
          entityId: clientId,
          details: {
            originalName: client.name,
            invoiceCount: Number(invoiceTotals.rows[0].cnt),
            invoiceTotal: invoiceTotals.rows[0].total_amount,
            paymentCount: Number(paymentTotals.rows[0].cnt),
            paymentTotal: paymentTotals.rows[0].total_amount,
            redactedAt: new Date().toISOString(),
          },
        });

        await pool.query("COMMIT");

        return res.json({
          ok: true,
          clientId,
          redactedName,
          invoiceCount: Number(invoiceTotals.rows[0].cnt),
          invoiceTotalPreserved: invoiceTotals.rows[0].total_amount,
          paymentCount: Number(paymentTotals.rows[0].cnt),
          paymentTotalPreserved: paymentTotals.rows[0].total_amount,
          auditLogged: true,
        });
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/org-wipe", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const { confirmOrgId } = req.body;
      if (confirmOrgId !== orgId) {
        return res.status(400).json({ message: "confirmOrgId must match your current org" });
      }

      const preWipeCounts: Record<string, number> = {};
      for (const table of WIPE_TABLES_ORDERED) {
        try {
          const exists = await tableExists(table);
          if (!exists) continue;
          const hasOrg = await hasOrgColumn(table);
          if (table === "orgs") {
            const r = await pool.query(`SELECT COUNT(*) as cnt FROM orgs WHERE id = $1`, [orgId]);
            preWipeCounts[table] = Number(r.rows[0].cnt);
          } else if (hasOrg) {
            const r = await pool.query(`SELECT COUNT(*) as cnt FROM "${table}" WHERE org_id = $1`, [orgId]);
            preWipeCounts[table] = Number(r.rows[0].cnt);
          }
        } catch {}
      }

      await pool.query("BEGIN");
      try {
        const deletedCounts: Record<string, number> = {};

        for (const table of WIPE_TABLES_ORDERED) {
          try {
            const exists = await tableExists(table);
            if (!exists) continue;

            if (table === "orgs") {
              const r = await pool.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
              deletedCounts[table] = r.rowCount || 0;
            } else if (table === "session") {
              continue;
            } else {
              const hasOrg = await hasOrgColumn(table);
              if (hasOrg) {
                const r = await pool.query(`DELETE FROM "${table}" WHERE org_id = $1`, [orgId]);
                deletedCounts[table] = r.rowCount || 0;
              }
            }
          } catch (err: any) {
            await pool.query("ROLLBACK");
            return res.status(500).json({ message: `Failed deleting from ${table}: ${err.message}` });
          }
        }

        await pool.query("COMMIT");

        const totalDeleted = Object.values(deletedCounts).reduce((a, b) => a + b, 0);

        return res.json({
          ok: true,
          orgId,
          totalRowsDeleted: totalDeleted,
          preWipeCounts,
          deletedCounts,
        });
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

}
