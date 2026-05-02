import { Router, Request, Response } from "express";
import { db } from "../db";
import { notificationPreferences } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export function registerNotificationRoutes(app: Router) {
  app.get("/api/notification-preferences", async (req: Request, res: Response) => {
    if (!req.session?.userId || !req.session?.orgId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const userId = req.session.userId;
    const orgId = req.session.orgId;

    let [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.orgId, orgId)));

    if (!prefs) {
      [prefs] = await db
        .insert(notificationPreferences)
        .values({ userId, orgId })
        .returning();
    }

    res.json(prefs);
  });

  app.put("/api/notification-preferences", async (req: Request, res: Response) => {
    if (!req.session?.userId || !req.session?.orgId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const userId = req.session.userId;
    const orgId = req.session.orgId;

    const {
      invoiceAlerts,
      timesheetReminders,
      approvalNotifications,
      systemUpdates,
      marketingTips,
      mailboxAlerts,
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd,
      quietHoursTimezone,
    } = req.body;

    // Task #303 — Validate quiet-hours fields. Reject malformed input
    // rather than silently dropping it; admins need to trust that what
    // they configured is what's running.
    const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
    if (quietHoursStart !== undefined && (typeof quietHoursStart !== "string" || !HHMM.test(quietHoursStart))) {
      return res.status(400).json({ message: "quietHoursStart must be HH:MM (24h)" });
    }
    if (quietHoursEnd !== undefined && (typeof quietHoursEnd !== "string" || !HHMM.test(quietHoursEnd))) {
      return res.status(400).json({ message: "quietHoursEnd must be HH:MM (24h)" });
    }
    if (quietHoursTimezone !== undefined) {
      if (typeof quietHoursTimezone !== "string" || quietHoursTimezone.length === 0) {
        return res.status(400).json({ message: "quietHoursTimezone must be a non-empty IANA zone" });
      }
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: quietHoursTimezone });
      } catch {
        return res.status(400).json({ message: `Unknown IANA timezone: ${quietHoursTimezone}` });
      }
    }

    let [existing] = await db
      .select()
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.orgId, orgId)));

    if (!existing) {
      [existing] = await db
        .insert(notificationPreferences)
        .values({ userId, orgId })
        .returning();
    }

    const [updated] = await db
      .update(notificationPreferences)
      .set({
        invoiceAlerts: typeof invoiceAlerts === "boolean" ? invoiceAlerts : existing.invoiceAlerts,
        timesheetReminders: typeof timesheetReminders === "boolean" ? timesheetReminders : existing.timesheetReminders,
        approvalNotifications: typeof approvalNotifications === "boolean" ? approvalNotifications : existing.approvalNotifications,
        systemUpdates: typeof systemUpdates === "boolean" ? systemUpdates : existing.systemUpdates,
        marketingTips: typeof marketingTips === "boolean" ? marketingTips : existing.marketingTips,
        mailboxAlerts: typeof mailboxAlerts === "boolean" ? mailboxAlerts : existing.mailboxAlerts,
        quietHoursEnabled: typeof quietHoursEnabled === "boolean" ? quietHoursEnabled : existing.quietHoursEnabled,
        quietHoursStart: typeof quietHoursStart === "string" ? quietHoursStart : existing.quietHoursStart,
        quietHoursEnd: typeof quietHoursEnd === "string" ? quietHoursEnd : existing.quietHoursEnd,
        quietHoursTimezone: typeof quietHoursTimezone === "string" ? quietHoursTimezone : existing.quietHoursTimezone,
        updatedAt: new Date(),
      })
      .where(eq(notificationPreferences.id, existing.id))
      .returning();

    res.json(updated);
  });
}
