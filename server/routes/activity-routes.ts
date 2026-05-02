import type { Express, Request, Response } from "express";
import { requireAuth } from "./middleware";
import { pool } from "../db";

export function registerActivityRoutes(app: Express) {
  app.get("/api/activity", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const { actor, entityType, action, dateRange, startDate, endDate, limit: rawLimit, offset: rawOffset } = req.query;

      const conditions: string[] = ["a.org_id = $1"];
      const params: any[] = [orgId];
      let idx = 2;

      if (actor && typeof actor === "string") {
        conditions.push(`a.user_id = $${idx++}`);
        params.push(actor);
      }

      if (entityType && typeof entityType === "string") {
        conditions.push(`LOWER(a.entity_type) = LOWER($${idx++})`);
        params.push(entityType);
      }

      if (action && typeof action === "string") {
        conditions.push(`LOWER(a.action) LIKE '%' || LOWER($${idx++}) || '%'`);
        params.push(action);
      }

      if (dateRange && typeof dateRange === "string") {
        const now = new Date();
        let from: Date | null = null;
        if (dateRange === "today") {
          from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (dateRange === "7d") {
          from = new Date(now.getTime() - 7 * 86400000);
        } else if (dateRange === "30d") {
          from = new Date(now.getTime() - 30 * 86400000);
        }
        if (from) {
          conditions.push(`a.created_at >= $${idx++}`);
          params.push(from.toISOString());
        }
      }

      if (startDate && typeof startDate === "string") {
        conditions.push(`a.created_at >= $${idx++}`);
        params.push(new Date(startDate).toISOString());
      }

      if (endDate && typeof endDate === "string") {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push(`a.created_at <= $${idx++}`);
        params.push(end.toISOString());
      }

      const limit = Math.min(Math.max(parseInt(String(rawLimit)) || 50, 1), 200);
      const offset = Math.max(parseInt(String(rawOffset)) || 0, 0);

      const where = conditions.join(" AND ");

      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0]?.total || "0");

      const dataResult = await pool.query(
        `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
                u.name AS user_name, u.email AS user_email
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE ${where}
         ORDER BY a.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset],
      );

      const entityTypesResult = await pool.query(
        `SELECT DISTINCT entity_type FROM audit_logs WHERE org_id = $1 ORDER BY entity_type`,
        [orgId],
      );
      const actionTypesResult = await pool.query(
        `SELECT DISTINCT action FROM audit_logs WHERE org_id = $1 ORDER BY action`,
        [orgId],
      );

      res.json({
        success: true,
        total,
        limit,
        offset,
        activities: dataResult.rows.map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          userName: r.user_name,
          userEmail: r.user_email,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          details: r.details,
          createdAt: r.created_at,
        })),
        availableEntityTypes: entityTypesResult.rows.map((r: any) => r.entity_type),
        availableActions: actionTypesResult.rows.map((r: any) => r.action),
      });
    } catch (e: any) {
      console.error("[activity] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
}
