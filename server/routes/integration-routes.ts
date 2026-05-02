import type { Express, Request, Response, NextFunction } from "express";
import { storage, encryptField, decryptField } from "../storage";
import { db } from "../db";
import { eq, desc, asc, and, gte, lte, sql } from "drizzle-orm";
import { createHmac, randomBytes } from "crypto";
import { invoiceLines, invoices, payments, projectMembers, timeEntries, users, apiKeys, webhookEndpoints, webhookDeliveries, clients, projects, WEBHOOK_EVENT_TYPES, createClientSchema, createProjectSchema, createTimeEntrySchema } from "@shared/schema";
import { sanitizeErrorMessage, requireAdmin, requirePlanTier } from "./middleware";
import { hashPassword, comparePasswords } from "../auth";
import { getExchangeRate } from "../exchange-rates";
import { fireWebhookEvent } from "../webhooks";
import { z } from "zod";

export function registerIntegrationRoutes(app: Express) {

// ─── API KEY MANAGEMENT ─────────────────────────────────────────────
const INTEGRATION_TIERS = ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"];

app.post("/api/integrations/api-keys", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "API Keys"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { name, permissions } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ message: "Name is required" });
    }
    const rawKey = "cwp_" + randomBytes(32).toString("hex");
    const keyHash = await hashPassword(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    const perms = Array.isArray(permissions) ? permissions : ["read"];
    const [inserted] = await db.insert(apiKeys).values({
      orgId,
      name: name.trim(),
      keyHash,
      keyPrefix,
      permissions: perms,
      createdBy: userId,
    }).returning();
    await storage.createAuditLog({
      orgId,
      userId,
      action: "API_KEY_CREATED",
      entityType: "api_key",
      entityId: inserted.id,
      details: { name: name.trim(), prefix: keyPrefix },
    });
    return res.json({
      id: inserted.id,
      name: inserted.name,
      key: rawKey,
      keyPrefix,
      permissions: perms,
      createdAt: inserted.createdAt,
    });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/integrations/api-keys", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "API Keys"))) return;
    const orgId = req.session.orgId!;
    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      permissions: apiKeys.permissions,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    }).from(apiKeys).where(eq(apiKeys.orgId, orgId)).orderBy(desc(apiKeys.createdAt));
    return res.json(keys);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.delete("/api/integrations/api-keys/:id", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "API Keys"))) return;
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const [existing] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)));
    if (!existing) return res.status(404).json({ message: "API key not found" });
    await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)));
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "API_KEY_REVOKED",
      entityType: "api_key",
      entityId: id,
      details: { name: existing.name, prefix: existing.keyPrefix },
    });
    return res.json({ success: true });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/integrations/api-keys/:id/rotate", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "API Keys"))) return;
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const [existing] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)));
    if (!existing) return res.status(404).json({ message: "API key not found" });
    const rawKey = "cwp_" + randomBytes(32).toString("hex");
    const keyHash = await hashPassword(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    await db.update(apiKeys).set({ keyHash, keyPrefix }).where(eq(apiKeys.id, id));
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "API_KEY_ROTATED",
      entityType: "api_key",
      entityId: id,
      details: { name: existing.name, newPrefix: keyPrefix },
    });
    return res.json({ id, key: rawKey, keyPrefix });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});

// ─── API KEY AUTH MIDDLEWARE ───────────────────────────────────────────
async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const headerKey = req.headers["x-api-key"];
  if (!headerKey || typeof headerKey !== "string") {
    return res.status(401).json({ message: "Missing X-API-Key header" });
  }
  const prefix = headerKey.substring(0, 8);
  const candidates = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, prefix));
  let record = null;
  for (const candidate of candidates) {
    if (await comparePasswords(headerKey, candidate.keyHash)) {
      record = candidate;
      break;
    }
  }
  if (!record) {
    return res.status(401).json({ message: "Invalid API key" });
  }
  if (!record.isActive) {
    return res.status(401).json({ message: "API key has been revoked" });
  }
  const org = await storage.getOrg(record.orgId);
  if (!org || !INTEGRATION_TIERS.includes(org.planTier)) {
    return res.status(403).json({ message: "API access requires Professional plan or higher" });
  }
  (req as any).orgId = record.orgId;
  (req as any).apiKeyId = record.id;
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, record.id)).then(() => {}).catch(err => console.error("[api-key] Failed to update lastUsedAt:", err));
  next();
}

// ─── WEBHOOK MANAGEMENT ───────────────────────────────────────────────
function validateWebhookUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return "Webhook URL must use HTTPS";
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "[::1]" || hostname.endsWith(".local")) {
      return "Webhook URL must not point to localhost or private addresses";
    }
    const PRIVATE_PATTERNS = [
      /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
      /^0\.0\.0\.0/, /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/, /^fd/,
    ];
    if (PRIVATE_PATTERNS.some(p => p.test(hostname))) {
      return "Webhook URL must not point to private or internal IP addresses";
    }
    return null;
  } catch {
    return "Invalid URL format";
  }
}

const SUPPORTED_WEBHOOK_EVENTS = WEBHOOK_EVENT_TYPES;

app.post("/api/integrations/webhooks", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "Webhooks"))) return;
    const orgId = req.session.orgId!;
    const { url, events, description } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "URL is required" });
    }
    const urlError = validateWebhookUrl(url);
    if (urlError) return res.status(400).json({ message: urlError });
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: "At least one event type is required" });
    }
    const invalidEvents = events.filter((e: string) => !(SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (invalidEvents.length > 0) {
      return res.status(400).json({ message: `Unsupported events: ${invalidEvents.join(", ")}` });
    }
    const secret = "whsec_" + randomBytes(24).toString("hex");
    const [inserted] = await db.insert(webhookEndpoints).values({
      orgId,
      url,
      secret: encryptField(secret),
      events,
      description: description || null,
    }).returning();
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "WEBHOOK_CREATED",
      entityType: "webhook_endpoint",
      entityId: inserted.id,
      details: { url, events },
    });
    return res.json({ id: inserted.id, url: inserted.url, events: inserted.events, description: inserted.description, isActive: inserted.isActive, createdAt: inserted.createdAt, secret });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/integrations/webhooks", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "Webhooks"))) return;
    const orgId = req.session.orgId!;
    const endpoints = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.orgId, orgId)).orderBy(desc(webhookEndpoints.createdAt));
    return res.json(endpoints.map(ep => ({ id: ep.id, url: ep.url, events: ep.events, description: ep.description, isActive: ep.isActive, createdAt: ep.createdAt, updatedAt: ep.updatedAt })));
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.patch("/api/integrations/webhooks/:id", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "Webhooks"))) return;
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const [existing] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, orgId)));
    if (!existing) return res.status(404).json({ message: "Webhook endpoint not found" });
    const updates: any = {};
    if (req.body.url !== undefined) {
      const urlErr = validateWebhookUrl(req.body.url);
      if (urlErr) return res.status(400).json({ message: urlErr });
      updates.url = req.body.url;
    }
    if (req.body.events !== undefined) {
      if (!Array.isArray(req.body.events)) return res.status(400).json({ message: "events must be an array" });
      const invalidEvts = req.body.events.filter((e: string) => !(SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(e));
      if (invalidEvts.length > 0) return res.status(400).json({ message: `Unsupported events: ${invalidEvts.join(", ")}` });
      updates.events = req.body.events;
    }
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    if (req.body.description !== undefined) updates.description = req.body.description;
    const [updated] = await db.update(webhookEndpoints).set(updates).where(eq(webhookEndpoints.id, id)).returning();
    return res.json({ id: updated.id, url: updated.url, events: updated.events, description: updated.description, isActive: updated.isActive, createdAt: updated.createdAt, updatedAt: updated.updatedAt });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/integrations/webhooks/:id/rotate-secret", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "Webhooks"))) return;
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const [existing] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, orgId)));
    if (!existing) return res.status(404).json({ message: "Webhook endpoint not found" });
    const newSecret = "whsec_" + randomBytes(24).toString("hex");
    const [updated] = await db.update(webhookEndpoints).set({
      oldSecret: existing.secret,
      secretRotatedAt: new Date(),
      secret: encryptField(newSecret),
      updatedAt: new Date(),
    }).where(eq(webhookEndpoints.id, id)).returning();
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "WEBHOOK_SECRET_ROTATED",
      entityType: "webhook_endpoint",
      entityId: id,
      details: { url: existing.url },
    });
    return res.json({ id: updated.id, url: updated.url, events: updated.events, description: updated.description, isActive: updated.isActive, createdAt: updated.createdAt, updatedAt: updated.updatedAt, secret: newSecret });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.delete("/api/integrations/webhooks/:id", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "Webhooks"))) return;
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const [existing] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, orgId)));
    if (!existing) return res.status(404).json({ message: "Webhook endpoint not found" });
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookEndpointId, id));
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "WEBHOOK_DELETED",
      entityType: "webhook_endpoint",
      entityId: id,
      details: { url: existing.url },
    });
    return res.json({ success: true });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.post("/api/integrations/webhooks/:id/test", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "Webhooks"))) return;
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const [endpoint] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, orgId)));
    if (!endpoint) return res.status(404).json({ message: "Webhook endpoint not found" });
    const payload = {
      event: "ping",
      data: { message: "This is a test webhook delivery from CherryWorks Pro", timestamp: new Date().toISOString() },
    };
    const payloadStr = JSON.stringify(payload);
    const decryptedSecret = decryptField(endpoint.secret);
    const signature = createHmac("sha256", decryptedSecret).update(payloadStr).digest("hex");
    const [delivery] = await db.insert(webhookDeliveries).values({
      orgId,
      webhookEndpointId: id,
      event: "ping",
      payload,
      attempts: 1,
      status: "pending",
    }).returning();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CWP-Signature": `sha256=${signature}`,
          "X-CWP-Event": "ping",
          "X-CWP-Delivery-Id": delivery.id,
        },
        body: payloadStr,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const responseBody = await response.text().catch(() => "");
      const contentLength = response.headers.get("content-length");
      const truncated = responseBody.length > 2000;
      const storedBody = truncated
        ? responseBody.substring(0, 2000) + `\n[truncated — full Content-Length: ${contentLength || responseBody.length}]`
        : responseBody;
      await db.update(webhookDeliveries).set({
        statusCode: response.status,
        responseBody: storedBody,
        deliveredAt: new Date(),
        status: response.ok ? "delivered" : "failed",
      }).where(eq(webhookDeliveries.id, delivery.id));
      await db.update(webhookEndpoints).set({
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: response.ok ? "delivered" : "failed",
      }).where(eq(webhookEndpoints.id, id));
      return res.json({ success: response.ok, statusCode: response.status, deliveryId: delivery.id });
    } catch (fetchErr: any) {
      await db.update(webhookDeliveries).set({
        status: "failed",
        responseBody: fetchErr.message?.substring(0, 2000) || "Connection failed",
      }).where(eq(webhookDeliveries.id, delivery.id));
      await db.update(webhookEndpoints).set({
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: "failed",
      }).where(eq(webhookEndpoints.id, id));
      return res.json({ success: false, statusCode: null, error: "Failed to connect", deliveryId: delivery.id });
    }
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/integrations/webhooks/:id/deliveries", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, INTEGRATION_TIERS, "Webhooks"))) return;
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const [endpoint] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.orgId, orgId)));
    if (!endpoint) return res.status(404).json({ message: "Webhook endpoint not found" });
    const deliveries = await db.select().from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.webhookEndpointId, id), eq(webhookDeliveries.orgId, orgId)))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    return res.json(deliveries);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/integrations/supported-events", requireAdmin, async (req, res) => {
  return res.json(SUPPORTED_WEBHOOK_EVENTS);
});

// ─── EXTERNAL REST API v1 ─────────────────────────────────────────────

function parsePagination(query: any) {
  const limit = Math.min(Math.max(parseInt(query.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset) || 0, 0);
  return { limit, offset };
}

app.get("/api/v1/clients", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { limit, offset } = parsePagination(req.query);
    const conditions = [eq(clients.orgId, orgId)];
    if (req.query.search) {
      const escapedSearch = String(req.query.search).toLowerCase().replace(/[%_\\]/g, '\\$&');
      conditions.push(sql`lower(${clients.name}) like ${'%' + escapedSearch + '%'} escape '\\'`);
    }
    const rows = await db.select({
      id: clients.id, name: clients.name, email: clients.email, phone: clients.phone,
      address: clients.address, website: clients.website, currency: clients.currency, createdAt: clients.createdAt,
    }).from(clients).where(and(...conditions)).orderBy(asc(clients.name)).limit(limit).offset(offset);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(clients).where(and(...conditions));
    return res.json({ data: rows, total: Number(count), limit, offset });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/clients/:id", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const [client] = await db.select({
      id: clients.id, name: clients.name, email: clients.email, phone: clients.phone,
      address: clients.address, website: clients.website, currency: clients.currency, createdAt: clients.createdAt,
    }).from(clients).where(and(eq(clients.id, req.params.id as string), eq(clients.orgId, orgId)));
    if (!client) return res.status(404).json({ message: "Client not found" });
    return res.json(client);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/invoices", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { limit, offset } = parsePagination(req.query);
    const VALID_INVOICE_STATUSES = ["DRAFT", "SENT", "VIEWED", "PARTIAL", "PAID", "OVERDUE", "VOID"];
    const conditions: any[] = [eq(invoices.orgId, orgId)];
    if (req.query.status) {
      if (!VALID_INVOICE_STATUSES.includes(String(req.query.status))) {
        return res.status(400).json({ message: `Invalid status. Allowed: ${VALID_INVOICE_STATUSES.join(", ")}` });
      }
      conditions.push(eq(invoices.status, req.query.status as any));
    }
    if (req.query.clientId) conditions.push(eq(invoices.clientId, String(req.query.clientId)));
    if (req.query.dateFrom) conditions.push(gte(invoices.issuedDate, String(req.query.dateFrom)));
    if (req.query.dateTo) conditions.push(lte(invoices.issuedDate, String(req.query.dateTo)));
    const rows = await db.select({
      id: invoices.id, number: invoices.number, clientId: invoices.clientId, clientName: clients.name,
      status: invoices.status, issuedDate: invoices.issuedDate, dueDate: invoices.dueDate,
      currency: invoices.currency, subtotal: invoices.subtotal, taxRate: invoices.taxRate,
      taxAmount: invoices.taxAmount, discountAmount: invoices.discountAmount,
      total: invoices.total, paidAmount: invoices.paidAmount, createdAt: invoices.createdAt,
    }).from(invoices).innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(...conditions)).orderBy(desc(invoices.createdAt)).limit(limit).offset(offset);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(invoices).where(and(...conditions));
    return res.json({ data: rows, total: Number(count), limit, offset });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/invoices/:id", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const [inv] = await db.select({
      id: invoices.id, number: invoices.number, clientId: invoices.clientId, clientName: clients.name,
      status: invoices.status, issuedDate: invoices.issuedDate, dueDate: invoices.dueDate,
      currency: invoices.currency, exchangeRate: invoices.exchangeRate, subtotal: invoices.subtotal,
      discountType: invoices.discountType, discountValue: invoices.discountValue,
      discountAmount: invoices.discountAmount, taxRate: invoices.taxRate, taxAmount: invoices.taxAmount,
      total: invoices.total, paidAmount: invoices.paidAmount, notes: invoices.notes, createdAt: invoices.createdAt,
    }).from(invoices).innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(invoices.id, req.params.id as string), eq(invoices.orgId, orgId)));
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    const lines = await db.select({
      id: invoiceLines.id, description: invoiceLines.description, quantity: invoiceLines.quantity,
      unitRate: invoiceLines.unitRate, amount: invoiceLines.amount, sortOrder: invoiceLines.sortOrder,
      isHeader: invoiceLines.isHeader,
    }).from(invoiceLines).where(eq(invoiceLines.invoiceId, req.params.id as string)).orderBy(asc(invoiceLines.sortOrder));
    return res.json({ ...inv, lines });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/payments", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { limit, offset } = parsePagination(req.query);
    const conditions: any[] = [eq(payments.orgId, orgId)];
    if (req.query.invoiceId) conditions.push(eq(payments.invoiceId, String(req.query.invoiceId)));
    if (req.query.clientId) conditions.push(eq(invoices.clientId, String(req.query.clientId)));
    if (req.query.dateFrom) conditions.push(gte(payments.date, String(req.query.dateFrom)));
    if (req.query.dateTo) conditions.push(lte(payments.date, String(req.query.dateTo)));
    const rows = await db.select({
      id: payments.id, invoiceId: payments.invoiceId, invoiceNumber: invoices.number,
      clientName: clients.name, amount: payments.amount, currency: payments.currency,
      date: payments.date, method: payments.method, provider: payments.provider,
      referenceNumber: payments.referenceNumber, status: payments.status, notes: payments.notes,
      createdAt: payments.createdAt,
    }).from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(...conditions)).orderBy(desc(payments.createdAt)).limit(limit).offset(offset);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(...conditions));
    return res.json({ data: rows, total: Number(count), limit, offset });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/payments/:id", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const [payment] = await db.select({
      id: payments.id, invoiceId: payments.invoiceId, invoiceNumber: invoices.number,
      clientName: clients.name, amount: payments.amount, currency: payments.currency,
      date: payments.date, method: payments.method, provider: payments.provider,
      providerRef: payments.providerRef, referenceNumber: payments.referenceNumber,
      status: payments.status, notes: payments.notes, createdAt: payments.createdAt,
    }).from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(payments.id, req.params.id as string), eq(payments.orgId, orgId)));
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    return res.json(payment);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/time-entries", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { limit, offset } = parsePagination(req.query);
    const conditions: any[] = [eq(timeEntries.orgId, orgId)];
    if (req.query.userId) conditions.push(eq(timeEntries.userId, String(req.query.userId)));
    if (req.query.projectId) conditions.push(eq(timeEntries.projectId, String(req.query.projectId)));
    if (req.query.clientId) conditions.push(eq(projects.clientId, String(req.query.clientId)));
    if (req.query.dateFrom) conditions.push(gte(timeEntries.date, String(req.query.dateFrom)));
    if (req.query.dateTo) conditions.push(lte(timeEntries.date, String(req.query.dateTo)));
    if (req.query.billable !== undefined) conditions.push(eq(timeEntries.billable, req.query.billable === "true"));
    const rows = await db.select({
      id: timeEntries.id, projectId: timeEntries.projectId, projectName: projects.name,
      clientName: clients.name, userId: timeEntries.userId, userName: users.name,
      date: timeEntries.date, minutes: timeEntries.minutes, billable: timeEntries.billable,
      rate: timeEntries.rate, notes: timeEntries.notes, invoiced: timeEntries.invoiced,
      startTime: timeEntries.startTime, endTime: timeEntries.endTime, createdAt: timeEntries.createdAt,
    }).from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(...conditions)).orderBy(desc(timeEntries.date)).limit(limit).offset(offset);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(and(...conditions));
    return res.json({ data: rows, total: Number(count), limit, offset });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/projects", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { limit, offset } = parsePagination(req.query);
    const VALID_PROJECT_STATUSES = ["ACTIVE", "COMPLETED", "ON_HOLD", "CANCELLED"];
    const conditions: any[] = [eq(projects.orgId, orgId)];
    if (req.query.clientId) conditions.push(eq(projects.clientId, String(req.query.clientId)));
    if (req.query.status) {
      if (!VALID_PROJECT_STATUSES.includes(String(req.query.status))) {
        return res.status(400).json({ message: `Invalid status. Allowed: ${VALID_PROJECT_STATUSES.join(", ")}` });
      }
      conditions.push(eq(projects.status, req.query.status as any));
    }
    const rows = await db.select({
      id: projects.id, clientId: projects.clientId, clientName: clients.name,
      name: projects.name, description: projects.description, status: projects.status,
      budgetHours: projects.budgetHours, startDate: projects.startDate, endDate: projects.endDate,
      createdAt: projects.createdAt,
    }).from(projects).innerJoin(clients, eq(projects.clientId, clients.id))
      .where(and(...conditions)).orderBy(desc(projects.createdAt)).limit(limit).offset(offset);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(and(...conditions));
    return res.json({ data: rows, total: Number(count), limit, offset });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/projects/:id", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const [project] = await db.select({
      id: projects.id, clientId: projects.clientId, clientName: clients.name,
      name: projects.name, description: projects.description, status: projects.status,
      budgetHours: projects.budgetHours, startDate: projects.startDate, endDate: projects.endDate,
      createdAt: projects.createdAt,
    }).from(projects).innerJoin(clients, eq(projects.clientId, clients.id))
      .where(and(eq(projects.id, req.params.id as string), eq(projects.orgId, orgId)));
    if (!project) return res.status(404).json({ message: "Project not found" });
    const members = await db.select({
      userId: projectMembers.userId, userName: users.name,
      hourlyRate: projectMembers.hourlyRate, role: projectMembers.role,
    }).from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.projectId, req.params.id as string), eq(projects.orgId, orgId)));
    return res.json({ ...project, members });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});
app.get("/api/v1/team", requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { limit, offset } = parsePagination(req.query);
    const VALID_ROLES = ["ADMIN", "TEAM_MEMBER"];
    const conditions: any[] = [eq(users.orgId, orgId)];
    if (req.query.role) {
      if (!VALID_ROLES.includes(String(req.query.role))) {
        return res.status(400).json({ message: `Invalid role. Allowed: ${VALID_ROLES.join(", ")}` });
      }
      conditions.push(eq(users.role, req.query.role as any));
    }
    if (req.query.status === "active") conditions.push(eq(users.isActive, true));
    else if (req.query.status === "inactive") conditions.push(eq(users.isActive, false));
    const rows = await db.select({
      id: users.id, name: users.name, email: users.email, role: users.role,
      title: users.title, department: users.department, isActive: users.isActive,
      phone: users.phone, startDate: users.startDate, createdAt: users.createdAt,
    }).from(users).where(and(...conditions)).orderBy(asc(users.name)).limit(limit).offset(offset);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users).where(and(...conditions));
    return res.json({ data: rows, total: Number(count), limit, offset });
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});

// ─── API KEY WRITE RATE LIMITER (60 writes/min/key) ──────────────────
const API_WRITE_RPM = parseInt(process.env.API_WRITE_RPM || "60", 10);
const apiWriteBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function apiWriteRateLimit(req: Request, res: Response, next: NextFunction) {
  const headerKey = req.headers["x-api-key"];
  if (!headerKey || typeof headerKey !== "string") {
    return next();
  }
  const bucketKey = headerKey.substring(0, 12);
  const now = Date.now();
  let bucket = apiWriteBuckets.get(bucketKey);
  if (!bucket) {
    bucket = { tokens: API_WRITE_RPM, lastRefill: now };
    apiWriteBuckets.set(bucketKey, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 60000;
  bucket.tokens = Math.min(API_WRITE_RPM, bucket.tokens + elapsed * API_WRITE_RPM);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil(60 / API_WRITE_RPM);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ message: "Rate limit exceeded. Max 60 writes per minute per API key.", retryAfter });
  }
  bucket.tokens -= 1;
  next();
}

// ─── EXTERNAL REST API v1 — WRITE ENDPOINTS ─────────────────────────

app.post("/api/v1/clients", apiWriteRateLimit, requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const apiKeyId = (req as any).apiKeyId;
    const body = { ...req.body };
    delete body.orgId;

    const parsed = createClientSchema.parse(body);

    const org = await storage.getOrg(orgId);
    const { randomBytes: rb } = await import("crypto");
    const portalToken = rb(32).toString("hex");

    const client = await storage.createClient({
      orgId,
      name: parsed.name,
      email: parsed.email || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
      website: parsed.website || null,
      logoUrl: null,
      currency: parsed.currency || org?.baseCurrency || "USD",
      portalToken,
    });

    await storage.createAuditLog({
      orgId,
      userId: null,
      action: "CLIENT_CREATED",
      entityType: "client",
      entityId: client.id,
      details: { source: "api", apiKeyId, name: parsed.name },
    });

    fireWebhookEvent(orgId, "client.created", { id: client.id, name: client.name, email: client.email });
    return res.status(201).json(client);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Validation failed", errors: err.errors });
    }
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/v1/projects", apiWriteRateLimit, requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const apiKeyId = (req as any).apiKeyId;
    const body = { ...req.body };
    delete body.orgId;

    const parsed = createProjectSchema.parse(body);

    const client = await storage.getClientById(parsed.clientId, orgId);
    if (!client) {
      return res.status(400).json({ message: "Client not found in your organization" });
    }

    const project = await storage.createProject({
      orgId,
      clientId: parsed.clientId,
      name: parsed.name,
      description: parsed.description || null,
      budgetHours: parsed.budgetHours != null ? String(parsed.budgetHours) : null,
      startDate: parsed.startDate || null,
      endDate: parsed.endDate || null,
    });

    await storage.createAuditLog({
      orgId,
      userId: null,
      action: "PROJECT_CREATED",
      entityType: "project",
      entityId: project.id,
      details: { source: "api", apiKeyId, name: parsed.name, clientId: parsed.clientId },
    });

    return res.status(201).json(project);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Validation failed", errors: err.errors });
    }
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/v1/time-entries", apiWriteRateLimit, requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const apiKeyId = (req as any).apiKeyId;
    const body = { ...req.body };
    delete body.orgId;

    if (!body.userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const parsed = createTimeEntrySchema.parse(body);

    const user = await storage.getUserById(body.userId);
    if (!user || user.orgId !== orgId) {
      return res.status(400).json({ message: "User not found in your organization" });
    }
    if (!user.isActive) {
      return res.status(400).json({ message: "Cannot create time entries for deactivated users" });
    }

    const project = await storage.getProjectById(parsed.projectId, orgId);
    if (!project) {
      return res.status(400).json({ message: "Project not found in your organization" });
    }
    if (project.status !== "ACTIVE") {
      return res.status(400).json({ message: "Cannot record time on " + project.status + " project" });
    }

    const membership = await storage.getProjectMembership(parsed.projectId, body.userId);

    let finalMinutes = parsed.minutes || 0;
    if (parsed.startTime && parsed.endTime) {
      const [sh, sm] = parsed.startTime.split(":").map(Number);
      const [eh, em] = parsed.endTime.split(":").map(Number);
      finalMinutes = (eh * 60 + em) - (sh * 60 + sm);
      if (finalMinutes <= 0) finalMinutes += 24 * 60;
      if (finalMinutes <= 0 || finalMinutes > 24 * 60) {
        return res.status(400).json({ message: "Invalid time range" });
      }
    }

    const costRate = membership ? (Number(membership.costRateHourly) || 0) : 0;
    const entry = await storage.createTimeEntry({
      orgId,
      projectId: parsed.projectId,
      userId: body.userId,
      date: parsed.date,
      minutes: finalMinutes,
      startTime: parsed.startTime || null,
      endTime: parsed.endTime || null,
      serviceId: parsed.serviceId || null,
      billable: parsed.billable,
      rate: parsed.rate?.toFixed(2) || (membership?.hourlyRate ?? "0"),
      notes: parsed.notes || null,
    }, costRate.toFixed(2));

    await storage.createAuditLog({
      orgId,
      userId: null,
      action: "TIME_ENTRY_CREATED",
      entityType: "time_entry",
      entityId: entry.id,
      details: { source: "api", apiKeyId, projectId: parsed.projectId, userId: body.userId, date: parsed.date },
    });

    return res.status(201).json(entry);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Validation failed", errors: err.errors });
    }
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/v1/invoices", apiWriteRateLimit, requireApiKey, async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const apiKeyId = (req as any).apiKeyId;
    const body = { ...req.body };
    delete body.orgId;

    const schema = z.object({
      clientId: z.string().min(1, "Client is required"),
      issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
      currency: z.string().length(3, "Must be 3-letter currency code").default("USD"),
      notes: z.string().nullable().optional(),
      status: z.string().optional(),
    });
    const parsed = schema.parse(body);

    const client = await storage.getClientById(parsed.clientId, orgId);
    if (!client) {
      return res.status(400).json({ message: "Client not found in your organization" });
    }

    const org = await storage.getOrg(orgId);
    const baseCurrency = org?.baseCurrency || "USD";
    let exchangeRate = "1";
    if (parsed.currency !== baseCurrency) {
      const rateResult = await getExchangeRate(baseCurrency, parsed.currency, orgId);
      if (rateResult.rate === 0) {
        return res.status(503).json({ message: `Exchange rate unavailable for ${baseCurrency}→${parsed.currency}.` });
      }
      exchangeRate = rateResult.rateStr;
    }

    const invoiceNumber = await storage.getNextInvoiceNumber(orgId);
    const invoice = await storage.createInvoice({
      orgId,
      clientId: parsed.clientId,
      number: invoiceNumber,
      status: "DRAFT",
      issuedDate: parsed.issuedDate,
      dueDate: parsed.dueDate,
      notes: parsed.notes || null,
      discountType: "NONE",
      discountValue: "0",
      taxRate: org?.defaultTaxRate || "0",
      currency: parsed.currency,
      exchangeRate,
    });

    await storage.createAuditLog({
      orgId,
      userId: null,
      action: "INVOICE_CREATED",
      entityType: "invoice",
      entityId: invoice.id,
      details: { source: "api", apiKeyId, number: invoiceNumber, clientId: parsed.clientId, forcedStatus: "DRAFT" },
    });

    const result = await storage.getInvoice(invoice.id, orgId);
    fireWebhookEvent(orgId, "invoice.created", { id: invoice.id, number: invoiceNumber, clientId: parsed.clientId, status: "DRAFT" });
    return res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Validation failed", errors: err.errors });
    }
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

}
