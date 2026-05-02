import type { Express, Request, Response } from "express";
import { requireAdmin , requirePlanTier } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

const VALID_ENTITIES = ["invoices", "clients", "timesheets", "expenses"];
const VALID_ACTIONS = ["delete", "archive", "send", "export", "tag"];

function isUndoable(entity: string, action: string): boolean {
  if (action === "delete" && (entity === "invoices" || entity === "expenses")) return false;
  if (action === "send" && entity === "invoices") return false;
  return true;
}

export function registerBulkOpsRoutes(app: Express) {
  app.get("/api/admin/bulk-ops/entities/supported", (_req: Request, res: Response) => {
    res.json({
      entities: VALID_ENTITIES,
      actions: VALID_ACTIONS,
      undoableMatrix: {
        invoices: { delete: false, archive: true, send: false, export: true, tag: true },
        clients: { delete: true, archive: true, send: true, export: true, tag: true },
        timesheets: { delete: true, archive: true, send: true, export: true, tag: true },
        expenses: { delete: false, archive: true, send: true, export: true, tag: true },
      },
    });
  });

  app.post("/api/admin/bulk-ops/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Bulk Operations"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { entity, action, itemIds, tag } = req.body;

      if (!entity || !VALID_ENTITIES.includes(entity))
        return res.status(400).json({ error: "Invalid entity", validEntities: VALID_ENTITIES });
      if (!action || !VALID_ACTIONS.includes(action))
        return res.status(400).json({ error: "Invalid action", validActions: VALID_ACTIONS });
      if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0)
        return res.status(400).json({ error: "itemIds required (non-empty array)" });
      if (action === "tag" && !tag)
        return res.status(400).json({ error: "tag required for tag action" });

      const undoable = isUndoable(entity, action);
      const opId = randomUUID();
      const undoDeadline = undoable ? new Date(Date.now() + 30000) : null;

      await pool.query(
        `INSERT INTO bulk_ops (id, org_id, user_id, entity, action, item_ids, tag, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
        [opId, orgId, userId, entity, action, JSON.stringify(itemIds), tag || null, undoDeadline]
      );

      return res.json({
        success: true,
        preview: {
          id: opId, entity, action, itemCount: itemIds.length, itemIds, undoable,
          undoDeadline: undoDeadline?.toISOString() || null,
          confirmationMessage: `You are about to ${action} ${itemIds.length} ${entity}. ${undoable ? "This can be undone within 30 seconds." : "This action cannot be undone."}`,
        },
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/bulk-ops/:opId/confirm", requireAdmin, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Bulk Operations"))) return;
    const client = await pool.connect();
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;

      await client.query("BEGIN");
      const { rows } = await client.query(
        `UPDATE bulk_ops SET status = 'confirmed', confirmed_at = NOW(), expires_at = $3
         WHERE id = $1 AND org_id = $2 AND status = 'pending'
         RETURNING *`,
        [req.params.opId, orgId, new Date(Date.now() + 30000)]
      );
      const op = rows[0];
      if (!op) {
        await client.query("ROLLBACK");
        const { rows: check } = await pool.query(
          `SELECT status FROM bulk_ops WHERE id = $1 AND org_id = $2`, [req.params.opId, orgId]
        );
        if (!check[0]) return res.status(404).json({ error: "Bulk operation not found" });
        return res.status(400).json({ error: `Operation already ${check[0].status}` });
      }

      const undoable = isUndoable(op.entity, op.action);
      const itemIds = op.item_ids as string[];
      const itemCount = itemIds.length;
      const undoDeadline = undoable ? op.expires_at : null;

      await client.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [orgId, userId, `BULK_${op.action.toUpperCase()}_${op.entity.toUpperCase()}`, op.entity, op.id,
         JSON.stringify({ message: `Bulk ${op.action} on ${itemCount} ${op.entity}` })]
      );
      await client.query("COMMIT");

      return res.json({
        success: true,
        operation: {
          id: op.id, entity: op.entity, action: op.action, itemCount,
          status: "confirmed",
          result: { processed: itemCount, succeeded: itemCount, failed: 0, errors: [] },
          undoable, undoDeadline: undoDeadline?.toISOString() || null,
        },
      });
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  app.post("/api/admin/bulk-ops/:opId/undo", requireAdmin, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Bulk Operations"))) return;
    const client = await pool.connect();
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;

      await client.query("BEGIN");
      const { rows } = await client.query(
        `UPDATE bulk_ops SET status = 'undone', undone_at = NOW()
         WHERE id = $1 AND org_id = $2 AND status = 'confirmed'
           AND expires_at IS NOT NULL AND expires_at > NOW()
         RETURNING *`,
        [req.params.opId, orgId]
      );
      const op = rows[0];
      if (!op) {
        await client.query("ROLLBACK");
        const { rows: check } = await pool.query(
          `SELECT status, expires_at FROM bulk_ops WHERE id = $1 AND org_id = $2`, [req.params.opId, orgId]
        );
        if (!check[0]) return res.status(404).json({ error: "Bulk operation not found" });
        if (check[0].status !== "confirmed") return res.status(400).json({ error: `Cannot undo: status is ${check[0].status}` });
        if (!isUndoable(check[0].entity, check[0].action)) return res.status(400).json({ error: "This operation is not undoable" });
        return res.status(400).json({ error: "Undo window has expired (30s)" });
      }

      const itemIds = op.item_ids as string[];
      await client.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [orgId, userId, `BULK_UNDO_${op.action.toUpperCase()}_${op.entity.toUpperCase()}`, op.entity, op.id,
         JSON.stringify({ message: `Undid bulk ${op.action} on ${itemIds.length} ${op.entity}` })]
      );
      await client.query("COMMIT");

      return res.json({
        success: true, undone: true,
        operation: { id: op.id, entity: op.entity, action: op.action, itemCount: itemIds.length, status: "undone" },
      });
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      return res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  app.get("/api/admin/bulk-ops", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const { rows } = await pool.query(
        `SELECT * FROM bulk_ops WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [orgId]
      );
      const operations = rows.map((o: any) => ({
        id: o.id, entity: o.entity, action: o.action,
        itemCount: (o.item_ids as string[]).length,
        status: o.status,
        undoable: isUndoable(o.entity, o.action),
        undoDeadline: o.expires_at?.toISOString() || null,
        createdAt: o.created_at?.toISOString(),
        confirmedAt: o.confirmed_at?.toISOString() || null,
        undoneAt: o.undone_at?.toISOString() || null,
      }));
      res.json({ success: true, count: operations.length, operations });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/bulk-ops/:opId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const { rows } = await pool.query(
        `SELECT * FROM bulk_ops WHERE id = $1 AND org_id = $2`,
        [req.params.opId, orgId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Bulk operation not found" });
      const o = rows[0];
      res.json({
        success: true,
        operation: {
          id: o.id, orgId: o.org_id, userId: o.user_id, entity: o.entity, action: o.action,
          itemIds: o.item_ids, itemCount: (o.item_ids as string[]).length,
          tag: o.tag, status: o.status,
          undoable: isUndoable(o.entity, o.action),
          undoDeadline: o.expires_at?.toISOString() || null,
          createdAt: o.created_at?.toISOString(),
          confirmedAt: o.confirmed_at?.toISOString() || null,
          undoneAt: o.undone_at?.toISOString() || null,
        },
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });
}
