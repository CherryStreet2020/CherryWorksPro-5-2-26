import type { Express } from "express";
import { requireAdmin } from "./middleware";
import { db } from "../db";
import { webhookEndpoints, webhookDeliveries } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { fireWebhookEvent } from "../webhooks";

export function registerWebhookAdminRoutes(app: Express) {

app.get("/api/admin/webhooks/config", requireAdmin, async (req, res) => {
  try {
    return res.json({
      retrySchedule: ["1m", "5m", "30m", "2h", "12h"],
      maxAttempts: 6,
      deadLetterAfter: 6,
      idempotencyKeyIncluded: true,
      hmacAlgorithm: "sha256",
      signatureHeader: "X-Signature-256",
      events: [
        "invoice.created", "invoice.sent", "invoice.paid", "invoice.voided",
        "payment.received", "payment.refunded",
        "client.created", "client.updated", "client.deleted",
        "project.created", "project.updated",
        "estimate.created", "estimate.sent", "estimate.accepted",
        "expense.created", "expense.approved",
        "time_entry.created", "time_entry.updated",
        "timesheet.submitted", "timesheet.approved",
        "payout.created", "payout.completed",
        "ping",
      ],
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/webhooks/deliveries", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const status = req.query.status as string | undefined;
    const event = req.query.event as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const conditions = [eq(webhookDeliveries.orgId, orgId)];
    if (status) conditions.push(eq(webhookDeliveries.status, status as any));

    const deliveries = await db.select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);

    const filtered = event ? deliveries.filter(d => d.event === event) : deliveries;
    const deadLetterCount = deliveries.filter(d => d.lastErrorType === "dead_letter").length;

    return res.json({
      deliveries: filtered,
      total: filtered.length,
      deadLetterCount,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/webhooks/dead-letter", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const all = await db.select()
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.orgId, orgId),
        eq(webhookDeliveries.status, "failed"),
      ))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100);

    const deadLetters = all.filter(d => d.lastErrorType === "dead_letter");

    return res.json({
      deadLetters,
      count: deadLetters.length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.post("/api/admin/webhooks/test-fire", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const { event, payload } = req.body;
    if (!event) return res.status(400).json({ message: "event is required" });

    fireWebhookEvent(orgId, event, payload || { test: true, timestamp: new Date().toISOString() });

    return res.json({
      success: true,
      event,
      message: `Event ${event} fired for org`,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

}
