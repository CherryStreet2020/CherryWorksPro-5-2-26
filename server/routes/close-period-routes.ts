import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, sql, lte, gte } from "drizzle-orm";
import { closePeriods, timesheetWeeks } from "@shared/schema";
import { requireAdmin, sanitizeErrorMessage } from "./middleware";
import { requireTier } from "../lib/tier-gate";
import { storage } from "../storage";

export function registerClosePeriodRoutes(app: Express) {
  app.get("/api/close-periods", requireAdmin, requireTier("BUSINESS"), async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(closePeriods)
        .where(eq(closePeriods.orgId, req.session.orgId!))
        .orderBy(desc(closePeriods.periodEnd));
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: sanitizeErrorMessage(err) });
    }
  });

  app.post("/api/close-periods", requireAdmin, requireTier("BUSINESS"), async (req, res) => {
    try {
      const { periodStart, periodEnd, notes } = req.body;
      if (!periodStart || !periodEnd) {
        return res.status(400).json({ message: "periodStart and periodEnd are required" });
      }
      if (periodEnd < periodStart) {
        return res.status(400).json({ message: "periodEnd must be on or after periodStart" });
      }
      const [period] = await db
        .insert(closePeriods)
        .values({
          orgId: req.session.orgId!,
          periodStart,
          periodEnd,
          notes: notes || null,
        })
        .returning();
      return res.json(period);
    } catch (err: any) {
      if (err.message?.includes("duplicate") || err.code === "23505") {
        return res.status(400).json({ message: "A close period with this date range already exists" });
      }
      return res.status(400).json({ message: sanitizeErrorMessage(err) });
    }
  });

  app.post("/api/close-periods/:id/close", requireAdmin, requireTier("BUSINESS"), async (req, res) => {
    try {
      const periodId = req.params.id as string;
      const orgId = req.session.orgId!;
      const [period] = await db
        .select()
        .from(closePeriods)
        .where(and(eq(closePeriods.id, periodId), eq(closePeriods.orgId, orgId)));
      if (!period) return res.status(404).json({ message: "Close period not found" });
      if (period.status === "CLOSED") return res.status(400).json({ message: "Period is already closed" });

      const nonApproved = await db
        .select({ id: timesheetWeeks.id, weekStartDate: timesheetWeeks.weekStartDate, status: timesheetWeeks.status })
        .from(timesheetWeeks)
        .where(
          and(
            eq(timesheetWeeks.orgId, orgId),
            gte(timesheetWeeks.weekStartDate, period.periodStart),
            lte(timesheetWeeks.weekStartDate, period.periodEnd),
            sql`${timesheetWeeks.status} != 'APPROVED'`
          )
        );

      if (nonApproved.length > 0) {
        return res.status(400).json({
          message: `Cannot close period: ${nonApproved.length} timesheet week(s) are not approved`,
          nonApprovedWeeks: nonApproved.map(t => ({ id: t.id, weekStartDate: t.weekStartDate, status: t.status })),
        });
      }

      const [updated] = await db
        .update(closePeriods)
        .set({
          status: "CLOSED",
          closedAt: new Date(),
          closedByUserId: req.session.userId!,
        })
        .where(and(eq(closePeriods.id, periodId), eq(closePeriods.orgId, orgId)))
        .returning();
      return res.json(updated);
    } catch (err: any) {
      return res.status(400).json({ message: sanitizeErrorMessage(err) });
    }
  });

  app.post("/api/close-periods/:id/reopen", requireAdmin, requireTier("BUSINESS"), async (req, res) => {
    try {
      const periodId = req.params.id as string;
      const orgId = req.session.orgId!;
      const [period] = await db
        .select()
        .from(closePeriods)
        .where(and(eq(closePeriods.id, periodId), eq(closePeriods.orgId, orgId)));
      if (!period) return res.status(404).json({ message: "Close period not found" });
      if (period.status === "OPEN") return res.status(400).json({ message: "Period is already open" });

      const [updated] = await db
        .update(closePeriods)
        .set({
          status: "OPEN",
          closedAt: null,
          closedByUserId: null,
        })
        .where(and(eq(closePeriods.id, periodId), eq(closePeriods.orgId, orgId)))
        .returning();

      await storage.createAuditLog({
        orgId,
        userId: req.session.userId!,
        action: "REOPEN",
        entityType: "close_period",
        entityId: periodId,
        details: { periodStart: period.periodStart, periodEnd: period.periodEnd },
      });

      return res.json(updated);
    } catch (err: any) {
      return res.status(400).json({ message: sanitizeErrorMessage(err) });
    }
  });
}
