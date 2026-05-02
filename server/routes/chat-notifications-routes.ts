import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface ChatWebhookConfig {
  id: string;
  orgId: string;
  platform: "slack" | "teams";
  webhookUrl: string;
  channelName: string;
  events: string[];
  enabled: boolean;
  orgBranding: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface NotificationSend {
  id: string;
  orgId: string;
  configId: string;
  platform: string;
  event: string;
  channelName: string;
  status: "sent" | "failed";
  sentAt: Date;
  messagePreview: string;
}

const SUPPORTED_EVENTS = [
  "invoice.paid",
  "timesheet.submitted",
  "payment.failed",
  "budget.alert",
  "invoice.sent",
  "expense.approved",
  "estimate.approved",
  "client.created",
];

const webhookConfigs = new Map<string, ChatWebhookConfig>();
const notificationSends = new Map<string, NotificationSend>();

const MESSAGE_TEMPLATES: Record<string, { slack: string; teams: string }> = {
  "invoice.paid": {
    slack: ":white_check_mark: *Invoice Paid* — Invoice #{number} for {amount} from {client} has been paid.",
    teams: "✅ **Invoice Paid** — Invoice #{number} for {amount} from {client} has been paid.",
  },
  "timesheet.submitted": {
    slack: ":clock3: *Timesheet Submitted* — {user} submitted their timesheet for week of {week}.",
    teams: "🕒 **Timesheet Submitted** — {user} submitted their timesheet for week of {week}.",
  },
  "payment.failed": {
    slack: ":x: *Payment Failed* — Payment of {amount} for invoice #{number} failed: {reason}.",
    teams: "❌ **Payment Failed** — Payment of {amount} for invoice #{number} failed: {reason}.",
  },
  "budget.alert": {
    slack: ":warning: *Budget Alert* — Project {project} is at {pct}% of budget ({used}/{total} hours).",
    teams: "⚠️ **Budget Alert** — Project {project} is at {pct}% of budget ({used}/{total} hours).",
  },
};

export function registerChatNotificationsRoutes(app: Express) {

app.get("/api/admin/chat-notifications/config", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const configs = Array.from(webhookConfigs.values()).filter(c => c.orgId === orgId);
    return res.json({
      configs,
      count: configs.length,
      supportedPlatforms: ["slack", "teams"],
      supportedEvents: SUPPORTED_EVENTS,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/chat-notifications/config", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { platform, webhookUrl, channelName, events, orgBranding } = req.body;

    if (!platform || !["slack", "teams"].includes(platform)) {
      return res.status(400).json({ message: "platform must be 'slack' or 'teams'" });
    }
    if (!webhookUrl) return res.status(400).json({ message: "webhookUrl is required" });
    if (!channelName) return res.status(400).json({ message: "channelName is required" });
    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: "events array required (min 1)" });
    }

    const invalidEvents = events.filter((e: string) => !SUPPORTED_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      return res.status(400).json({ message: `Invalid events: ${invalidEvents.join(", ")}. Valid: ${SUPPORTED_EVENTS.join(", ")}` });
    }

    const id = randomUUID();
    const config: ChatWebhookConfig = {
      id,
      orgId,
      platform,
      webhookUrl,
      channelName,
      events,
      enabled: true,
      orgBranding: orgBranding !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    webhookConfigs.set(id, config);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CHAT_NOTIFICATION_CONFIGURED', 'chat_notification', $3, $4)`,
      [orgId, userId, id, JSON.stringify({ platform, channelName, events, orgBranding: config.orgBranding })]
    );

    return res.json({ success: true, config });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.put("/api/admin/chat-notifications/config/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const config = webhookConfigs.get(req.params.id as string);
    if (!config || config.orgId !== orgId) return res.status(404).json({ message: "Config not found" });

    const { webhookUrl, channelName, events, enabled, orgBranding } = req.body;
    if (webhookUrl) config.webhookUrl = webhookUrl;
    if (channelName) config.channelName = channelName;
    if (events) config.events = events;
    if (typeof enabled === "boolean") config.enabled = enabled;
    if (typeof orgBranding === "boolean") config.orgBranding = orgBranding;
    config.updatedAt = new Date();

    return res.json({ success: true, config });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.delete("/api/admin/chat-notifications/config/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const config = webhookConfigs.get(req.params.id as string);
    if (!config || config.orgId !== orgId) return res.status(404).json({ message: "Config not found" });

    webhookConfigs.delete(req.params.id as string);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CHAT_NOTIFICATION_DELETED', 'chat_notification', $3, $4)`,
      [orgId, req.session.userId, req.params.id, JSON.stringify({ platform: config.platform, channelName: config.channelName })]
    );

    return res.json({ success: true, deleted: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/chat-notifications/test", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const { configId, event } = req.body;

    if (!configId) return res.status(400).json({ message: "configId is required" });
    const config = webhookConfigs.get(configId);
    if (!config || config.orgId !== orgId) return res.status(404).json({ message: "Config not found" });

    const testEvent = event || "invoice.paid";
    const template = MESSAGE_TEMPLATES[testEvent];
    const message = template
      ? template[config.platform].replace("{number}", "TEST-001").replace("{amount}", "$1,000.00").replace("{client}", "Test Client")
      : `Test notification for ${testEvent}`;

    const sendId = randomUUID();
    const send: NotificationSend = {
      id: sendId,
      orgId,
      configId,
      platform: config.platform,
      event: testEvent,
      channelName: config.channelName,
      status: "sent",
      sentAt: new Date(),
      messagePreview: message,
    };

    notificationSends.set(sendId, send);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'CHAT_NOTIFICATION_TEST_SENT', 'chat_notification', $3, $4)`,
      [orgId, req.session.userId, configId, JSON.stringify({ platform: config.platform, event: testEvent, channelName: config.channelName })]
    );

    return res.json({
      success: true,
      sent: true,
      platform: config.platform,
      channelName: config.channelName,
      event: testEvent,
      messagePreview: message,
      sendId,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/chat-notifications/sends", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const sends = Array.from(notificationSends.values()).filter(s => s.orgId === orgId);
    return res.json({
      sends,
      count: sends.length,
      sentCount: sends.filter(s => s.status === "sent").length,
      failedCount: sends.filter(s => s.status === "failed").length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/chat-notifications/templates", requireAdmin, async (_req: Request, res: Response) => {
  return res.json({
    templates: Object.entries(MESSAGE_TEMPLATES).map(([event, templates]) => ({
      event,
      slack: templates.slack,
      teams: templates.teams,
    })),
    count: Object.keys(MESSAGE_TEMPLATES).length,
  });
});

}
