import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage } from "./middleware";
import { db, pool } from "../db";
import { webhookEndpoints, webhookDeliveries } from "@shared/schema";
import { eq, and, desc, sql, inArray, gte, lte } from "drizzle-orm";
import { fireWebhookEvent } from "../webhooks";

export function registerWebhookDashboardRoutes(app: Express) {

app.get("/api/admin/webhook-dashboard/summary", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;

    const [endpoints, totalResult, deliveredResult, failedResult, pendingResult, deadLetterResult] = await Promise.all([
      db.select().from(webhookEndpoints).where(eq(webhookEndpoints.orgId, orgId)),
      pool.query(`SELECT COUNT(*) as count FROM webhook_deliveries WHERE org_id = $1`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM webhook_deliveries WHERE org_id = $1 AND status = 'delivered'`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM webhook_deliveries WHERE org_id = $1 AND status = 'failed'`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM webhook_deliveries WHERE org_id = $1 AND status = 'pending'`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM webhook_deliveries WHERE org_id = $1 AND status = 'failed' AND last_error_type = 'dead_letter'`, [orgId]),
    ]);

    return res.json({
      endpoints: {
        total: endpoints.length,
        active: endpoints.filter(e => e.isActive).length,
        inactive: endpoints.filter(e => !e.isActive).length,
      },
      deliveries: {
        total: parseInt(totalResult.rows[0]?.count || "0"),
        delivered: parseInt(deliveredResult.rows[0]?.count || "0"),
        failed: parseInt(failedResult.rows[0]?.count || "0"),
        pending: parseInt(pendingResult.rows[0]?.count || "0"),
        deadLetter: parseInt(deadLetterResult.rows[0]?.count || "0"),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/webhook-dashboard/deliveries", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const status = req.query.status as string | undefined;
    const event = req.query.event as string | undefined;
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const offset = (page - 1) * limit;

    let whereClause = `WHERE org_id = $1`;
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }
    if (event) {
      whereClause += ` AND event = $${paramIdx}`;
      params.push(event);
      paramIdx++;
    }

    const [countResult, deliveryResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM webhook_deliveries ${whereClause}`, params),
      pool.query(
        `SELECT id, webhook_endpoint_id, event, status, attempts, max_attempts, status_code,
                payload, response_body, idempotency_key, last_error_type, next_retry_at,
                created_at, delivered_at
         FROM webhook_deliveries ${whereClause}
         ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0]?.count || "0");

    return res.json({
      deliveries: deliveryResult.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/webhook-dashboard/deliveries/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const result = await pool.query(
      `SELECT d.*, e.url as endpoint_url, e.events as endpoint_events, e.is_active as endpoint_active
       FROM webhook_deliveries d
       LEFT JOIN webhook_endpoints e ON d.webhook_endpoint_id = e.id
       WHERE d.id = $1 AND d.org_id = $2`,
      [req.params.id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    return res.json({ delivery: result.rows[0] });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/webhook-dashboard/deliveries/:id/replay", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const result = await pool.query(
      `SELECT * FROM webhook_deliveries WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    const delivery = result.rows[0];
    const payload = delivery.payload;

    fireWebhookEvent(orgId, delivery.event, payload?.data || payload || {});

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'WEBHOOK_DELIVERY_REPLAYED', 'webhook_delivery', $3, $4)`,
      [orgId, req.session.userId, delivery.id, JSON.stringify({
        event: delivery.event, originalDeliveryId: delivery.id,
        originalStatus: delivery.status, originalAttempts: delivery.attempts,
      })]
    );

    return res.json({
      success: true,
      replayed: true,
      originalDeliveryId: delivery.id,
      event: delivery.event,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/webhook-dashboard/event-types", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const result = await pool.query(
      `SELECT event, COUNT(*) as count, 
              SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM webhook_deliveries WHERE org_id = $1 GROUP BY event ORDER BY count DESC`,
      [orgId]
    );

    return res.json({
      eventTypes: result.rows.map(r => ({
        event: r.event,
        total: parseInt(r.count),
        delivered: parseInt(r.delivered),
        failed: parseInt(r.failed),
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/webhook-dashboard/endpoints", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const endpoints = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.orgId, orgId));

    const enriched = [];
    for (const ep of endpoints) {
      const statsResult = await pool.query(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM webhook_deliveries WHERE webhook_endpoint_id = $1`,
        [ep.id]
      );
      const stats = statsResult.rows[0] || {};
      enriched.push({
        ...ep,
        deliveryStats: {
          total: parseInt(stats.total || "0"),
          delivered: parseInt(stats.delivered || "0"),
          failed: parseInt(stats.failed || "0"),
        },
      });
    }

    return res.json({ endpoints: enriched, count: enriched.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
