import type { Express } from "express";
import { requireAdmin , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { auditLogs } from "@shared/schema";
import { eq, and, desc, gte, lte, ilike, sql, or } from "drizzle-orm";

export function registerAuditSearchRoutes(app: Express) {

app.get("/api/admin/audit-logs/search", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const q = String(req.query.q || "").trim();
    const userId = req.query.userId as string | undefined;
    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const entityId = req.query.entityId as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(auditLogs.orgId, orgId)];

    if (q) {
      conditions.push(or(
        ilike(auditLogs.action, `%${q}%`),
        ilike(auditLogs.entityType, `%${q}%`),
        ilike(sql`CAST(${auditLogs.details} AS TEXT)`, `%${q}%`),
      ));
    }
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (action) conditions.push(eq(auditLogs.action, action));
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
    if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate)));

    const [results, countResult] = await Promise.all([
      db.select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)` })
        .from(auditLogs)
        .where(and(...conditions)),
    ]);

    const total = Number(countResult[0]?.count || 0);

    return res.json({
      logs: results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/audit-logs/actions", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const result = await pool.query(
      `SELECT DISTINCT action FROM audit_logs WHERE org_id = $1 ORDER BY action`,
      [orgId]
    );
    return res.json({ actions: result.rows.map(r => r.action) });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/audit-logs/entity-types", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const result = await pool.query(
      `SELECT DISTINCT entity_type FROM audit_logs WHERE org_id = $1 ORDER BY entity_type`,
      [orgId]
    );
    return res.json({ entityTypes: result.rows.map(r => r.entity_type) });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

const MAX_REPORT_ROWS = 10000;
const DEFAULT_PAGE_SIZE = 200;

app.get("/api/admin/audit-logs/export", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const format = (req.query.format as string || "json").toLowerCase();
    const q = String(req.query.q || "").trim();
    const userId = req.query.userId as string | undefined;
    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string || "1", 10) || 1);
    const limit = Math.min(MAX_REPORT_ROWS, Math.max(1, parseInt(req.query.limit as string || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));

    const conditions: any[] = [eq(auditLogs.orgId, orgId)];
    if (q) {
      conditions.push(or(
        ilike(auditLogs.action, `%${q}%`),
        ilike(auditLogs.entityType, `%${q}%`),
      ));
    }
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (action) conditions.push(eq(auditLogs.action, action));
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate)));

    const whereClause = and(...conditions);

    if (format === "csv") {
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(whereClause);
      const totalCount = Number(countResult[0]?.count || 0);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.write("id,created_at,user_id,action,entity_type,entity_id,details\n");

      const chunkSize = 500;
      let offset = 0;
      let streamed = 0;
      while (offset < totalCount && streamed < MAX_REPORT_ROWS) {
        const chunk = await db.select()
          .from(auditLogs)
          .where(whereClause)
          .orderBy(desc(auditLogs.createdAt))
          .limit(Math.min(chunkSize, MAX_REPORT_ROWS - streamed))
          .offset(offset);
        if (chunk.length === 0) break;
        for (const r of chunk) {
          const details = JSON.stringify(r.details || {}).replace(/"/g, '""');
          res.write(`${r.id},${r.createdAt?.toISOString() || ''},${r.userId || ''},${r.action},${r.entityType},${r.entityId || ''},"${details}"\n`);
        }
        streamed += chunk.length;
        offset += chunk.length;
      }

      await db.insert(auditLogs).values({
        orgId,
        userId: req.session.userId,
        action: "AUDIT_LOG_EXPORTED",
        entityType: "audit_log",
        entityId: null,
        details: { format, count: streamed, filters: { q, userId, action, entityType, startDate, endDate } },
      });

      return res.end();
    }

    const offset = (page - 1) * limit;
    const [results, countResult] = await Promise.all([
      db.select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(whereClause),
    ]);

    const totalCount = Number(countResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);
    const hasNext = page < totalPages;

    const linkParts: string[] = [];
    const baseUrl = `/api/admin/audit-logs/export`;
    const params = new URLSearchParams();
    params.set("format", "json");
    if (q) params.set("q", q);
    if (userId) params.set("userId", userId);
    if (action) params.set("action", action);
    if (entityType) params.set("entityType", entityType);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("limit", String(limit));
    if (hasNext) {
      params.set("page", String(page + 1));
      linkParts.push(`<${baseUrl}?${params.toString()}>; rel="next"`);
    }
    if (page > 1) {
      params.set("page", String(page - 1));
      linkParts.push(`<${baseUrl}?${params.toString()}>; rel="prev"`);
    }
    if (linkParts.length > 0) {
      res.setHeader("Link", linkParts.join(", "));
    }

    await db.insert(auditLogs).values({
      orgId,
      userId: req.session.userId,
      action: "AUDIT_LOG_EXPORTED",
      entityType: "audit_log",
      entityId: null,
      details: { format, count: results.length, page, filters: { q, userId, action, entityType, startDate, endDate } },
    });

    return res.json({
      format: "json",
      count: results.length,
      totalCount,
      page,
      totalPages,
      nextCursor: hasNext ? page + 1 : null,
      data: results,
      exportedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

}
