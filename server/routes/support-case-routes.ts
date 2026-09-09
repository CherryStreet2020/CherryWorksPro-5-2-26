import type { Express } from "express";
import { z } from "zod";
import { storage, encryptField, decryptField } from "../storage";
import { requireAuth, requireManagerOrAbove, requireAdmin, sanitizeErrorMessage } from "./middleware";
import { requireTier } from "../lib/tier-gate";
import {
  createSupportCaseSchema,
  updateSupportCaseSchema,
  createSupportCaseMessageSchema,
  upsertSupportCaseTypeSchema,
  updateClientCaseSettingsSchema,
  SUPPORT_CASE_STATUSES, supportJiraConnections } from "@shared/schema";
import * as cases from "../support-cases";
import { importJiraIssues } from "../support-import";
import { JiraClient, JiraHttpError, pullProject, MAX_ISSUES } from "../support-jira";
import multer from "multer";
import { MAX_ATTACHMENT_BYTES, createAttachment, listAttachments, getAttachment, deleteAttachment, streamBytes, attachmentView, isAllowedAttachment } from "../support-attachments";

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedAttachment(file.originalname)) return cb(new Error("That file type is not allowed"));
    cb(null, true);
  },
});
import { resolvePolicy, upsertPolicy, deleteClientPolicy, getPolicyRow, DEFAULT_POLICY } from "../support-sla";
import { slaPolicySchema, supportSettingsSchema } from "@shared/schema";
import { db } from "../db";
import { orgs } from "@shared/schema";
import { and, eq } from "drizzle-orm";

// Validation and business-rule messages are meant for the user; everything
// else goes through the production sanitizer.
const USER_FACING = [/not found/i, /belongs to a different client/i, /does not belong/i, /is required/i, /at most/i, /must be/i, /starting with a letter/i, /already used by another client/i, /exactly one key prefix/i, /not allowed/i, /15 MB/i, /is empty/i, /No files/i];
function friendlyError(err: any): string {
  if (err instanceof z.ZodError) return err.issues[0]?.message || "Invalid input";
  const msg = String(err?.message || "");
  if (USER_FACING.some(rx => rx.test(msg))) return msg;
  return sanitizeErrorMessage(err);
}

const listQuerySchema = z.object({
  view: z.enum(["open", "mine", "unassigned", "waiting", "breaching", "resolved", "all"]).optional(),
  clientId: z.string().optional(),
  status: z.enum(SUPPORT_CASE_STATUSES).optional(),
  assigneeUserId: z.string().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * Support Cases API. Every active user in the org can read and work cases
 * (agents are team members as often as managers); managers own case types,
 * client key settings, and deletion. The whole module sits behind the
 * PROFESSIONAL tier.
 */
export function registerSupportCaseRoutes(app: Express) {
  // Test-only: exercises the inbound processor without a mailbox (vitest).
  if (process.env.NODE_ENV === "test") {
    app.post("/api/test/inbound-email", async (req, res) => {
      const { type, from, to, subject, text, html, messageId, senderAuthenticated } = req.body || {};
      if (type && type !== "email.received") return res.status(200).json({ message: "Event type ignored", type });
      const { randomUUID } = await import("crypto");
      const { processInboundEmail } = await import("../inbound-email");
      const { inboundEmails } = await import("@shared/schema");
      const { db } = await import("../db");
      const id = randomUUID();
      const claimed = await db.insert(inboundEmails).values({ id, from: typeof from === "string" ? from : JSON.stringify(from ?? "unknown"), to: typeof to === "string" ? to : JSON.stringify(to ?? "unknown"), subject: subject || null, bodyText: text || null, bodyHtml: html || null, headers: null, resendMessageId: messageId || null }).onConflictDoNothing().returning({ id: inboundEmails.id });
      if (claimed.length === 0) return res.status(200).json({ success: true, duplicate: true });
      try {
        const result = await processInboundEmail({ from, to, subject: subject ?? null, text: text ?? null, html: html ?? null, messageId: messageId || null, senderAuthenticated: senderAuthenticated !== false });
        return res.status(200).json({ success: true, emailId: id, ...result });
      } catch (err) {
        const { eq } = await import("drizzle-orm");
        await db.delete(inboundEmails).where(eq(inboundEmails.id, id)).catch(() => {});
        return res.status(500).json({ message: (err as Error).message });
      }
    });
  }

  const gate = [requireAuth, requireTier("PROFESSIONAL")] as const;

  const actorOf = async (req: any): Promise<cases.Actor> => {
    const u = await storage.getUserById(req.session.userId!);
    return { userId: req.session.userId!, name: u?.name || u?.email || "Team member" };
  };

  app.get("/api/support/summary", ...gate, async (req, res) => {
    return res.json(await cases.summary(req.session.orgId!, req.session.userId!));
  });

  // Where this org's customer portal lives (agents paste this into emails and the case page shows it).
  app.get("/api/support/portal-info", ...gate, async (req, res) => {
    const org = await storage.getOrg(req.session.orgId!);
    if (!org) return res.status(404).json({ message: "Organization not found" });
    const configured = (process.env.APP_BASE_URL || process.env.BASE_URL || "").trim().replace(/\/$/, "");
    const base = /^https?:\/\//i.test(configured) ? configured : `${req.protocol}://${req.get("host")}`;
    return res.json({ orgSlug: org.slug, helpUrl: `${base}/help/${org.slug}`, portalUrl: `${base}/portal/${org.slug}` });
  });

  app.get("/api/support/agents", ...gate, async (req, res) => {
    return res.json(await cases.listAgents(req.session.orgId!));
  });

  app.get("/api/support/clients", ...gate, async (req, res) => {
    return res.json(await cases.listClientsForPicker(req.session.orgId!));
  });

  app.get("/api/support/clients/:clientId/projects", ...gate, async (req, res) => {
    return res.json(await cases.listClientProjectsForPicker(req.session.orgId!, req.params.clientId as string));
  });

  app.get("/api/support/types", ...gate, async (req, res) => {
    const includeInactive = req.query.all === "1";
    const rows = await cases.ensureDefaultTypes(req.session.orgId!);
    return res.json(includeInactive ? rows : rows.filter(t => t.isActive));
  });

  app.post("/api/support/types", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const parsed = upsertSupportCaseTypeSchema.parse(req.body);
      return res.status(201).json(await cases.createType(req.session.orgId!, parsed));
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.patch("/api/support/types/:id", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const parsed = upsertSupportCaseTypeSchema.partial().parse(req.body);
      const row = await cases.updateType(req.session.orgId!, req.params.id as string, parsed);
      if (!row) return res.status(404).json({ message: "Case type not found" });
      return res.json(row);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.get("/api/support/cases", ...gate, async (req, res) => {
    try {
      const q = listQuerySchema.parse(req.query);
      const rows = await cases.listCases(req.session.orgId!, { ...q, userId: req.session.userId! });
      return res.json(rows.map(r => cases.withSla({ ...r, minutesLogged: Number(r.minutesLogged) })));
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.post("/api/support/cases", ...gate, async (req, res) => {
    try {
      const parsed = createSupportCaseSchema.parse(req.body);
      const actor = await actorOf(req);
      const row = await cases.createCase(req.session.orgId!, { ...parsed, source: "AGENT" }, actor);
      return res.status(201).json(row);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.get("/api/support/cases/:id", ...gate, async (req, res) => {
    const orgId = req.session.orgId!;
    const id = req.params.id as string;
    const row = await cases.getCase(orgId, id);
    if (!row) return res.status(404).json({ message: "Support case not found" });
    const [messages, events, time, attachments] = await Promise.all([
      cases.listMessages(orgId, id, true),
      cases.listEvents(orgId, id),
      cases.listCaseTime(orgId, id),
      listAttachments(orgId, id),
    ]);
    return res.json({ ...cases.withSla({ ...row, minutesLogged: Number(row.minutesLogged) }), messages, events, time, attachments: attachments.map(a => attachmentView(a, "/api/support/attachments")) });
  });

  app.patch("/api/support/cases/:id", ...gate, async (req, res) => {
    try {
      const parsed = updateSupportCaseSchema.parse(req.body);
      const actor = await actorOf(req);
      const row = await cases.updateCase(req.session.orgId!, req.params.id as string, parsed, actor);
      if (!row) return res.status(404).json({ message: "Support case not found" });
      return res.json(row);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.delete("/api/support/cases/:id", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    let ok: boolean;
    try { ok = await cases.deleteCase(req.session.orgId!, req.params.id as string); }
    catch (err) { return res.status(409).json({ message: (err as Error).message }); }
    if (!ok) return res.status(404).json({ message: "Support case not found" });
    return res.json({ ok: true });
  });

  app.post("/api/support/cases/:id/messages", ...gate, async (req, res) => {
    try {
      const parsed = createSupportCaseMessageSchema.parse(req.body);
      const actor = await actorOf(req);
      const result = await cases.addMessage(req.session.orgId!, req.params.id as string, {
        body: parsed.body, visibility: parsed.visibility,
        author: { userId: actor.userId, name: actor.name },
      });
      if (!result) return res.status(404).json({ message: "Support case not found" });
      return res.status(201).json(result);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  // ── Attachments ───────────────────────────────────────────────────────
  app.post("/api/support/cases/:id/attachments", ...gate, (req, res, next) => {
    attachmentUpload.array("files", 10)(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err?.code === "LIMIT_FILE_SIZE" ? "Files must be 15 MB or smaller" : (err?.message || "Upload failed") });
      next();
    });
  }, async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const row = await cases.getCaseRaw(orgId, req.params.id as string);
      if (!row) return res.status(404).json({ message: "Support case not found" });
      const files = ((req as any).files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) return res.status(400).json({ message: "No files were uploaded" });
      const messageId = typeof req.body?.messageId === "string" && req.body.messageId ? req.body.messageId : null;
      const created = [];
      for (const f of files) {
        created.push(await createAttachment({ orgId, caseId: row.id, messageId, filename: f.originalname, mimeType: f.mimetype, bytes: f.buffer, uploadedByUserId: req.session.userId!, source: "AGENT" }));
      }
      return res.status(201).json(created.map(a => attachmentView(a, "/api/support/attachments")));
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.get("/api/support/attachments/:id", ...gate, async (req, res) => {
    const a = await getAttachment(req.session.orgId!, req.params.id as string);
    if (!a) return res.status(404).json({ message: "Attachment not found" });
    const inline = a.mimeType.startsWith("image/") || a.mimeType === "application/pdf";
    await streamBytes(a.storageKey, a.mimeType, a.filename, res, inline && req.query.download !== "1");
  });

  app.delete("/api/support/attachments/:id", ...gate, async (req, res) => {
    const a = await getAttachment(req.session.orgId!, req.params.id as string);
    if (!a) return res.status(404).json({ message: "Attachment not found" });
    const u = await storage.getUserById(req.session.userId!);
    const isManager = u?.role === "ADMIN" || u?.role === "MANAGER";
    if (!isManager && a.uploadedByUserId !== req.session.userId) return res.status(403).json({ message: "Only the uploader or a manager can remove this file" });
    await deleteAttachment(req.session.orgId!, a.id);
    return res.json({ ok: true });
  });

  app.get("/api/support/cases/:id/time", ...gate, async (req, res) => {
    const row = await cases.getCaseRaw(req.session.orgId!, req.params.id as string);
    if (!row) return res.status(404).json({ message: "Support case not found" });
    return res.json(await cases.listCaseTime(req.session.orgId!, row.id));
  });

  // ── Service levels ────────────────────────────────────────────────────
  app.get("/api/support/sla", ...gate, async (req, res) => {
    const orgId = req.session.orgId!;
    const row = await getPolicyRow(orgId, null);
    const org = await storage.getOrg(orgId);
    const { hasReadScope, INBOUND_REQUIRED_SCOPE } = await import("../support-inbound-graph");
    const mailbox = {
      provider: org?.emailProviderType ?? "smtp",
      connected: !!org?.emailOauthRefreshToken,
      status: org?.emailOauthStatus ?? "ok",
      canReadInbox: org?.emailProviderType === "m365" && !!org?.emailOauthRefreshToken && hasReadScope(org?.emailOauthScopes),
      requiredScope: INBOUND_REQUIRED_SCOPE,
      senderAddress: (org as any)?.emailSenderAddress ?? null,
    };
    return res.json({ policy: row ? {
      firstResponseHours: Number(row.firstResponseHours), resolutionHours: Number(row.resolutionHours),
      businessHoursOnly: row.businessHoursOnly, businessStartHour: row.businessStartHour, businessEndHour: row.businessEndHour, timezone: row.timezone,
    } : DEFAULT_POLICY, isDefault: !row, supportInboundAddress: org?.supportInboundAddress ?? null, mailbox });
  });

  app.put("/api/support/sla", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const parsed = slaPolicySchema.parse(req.body);
      const row = await upsertPolicy(req.session.orgId!, null, parsed);
      return res.json(row);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.get("/api/support/clients/:clientId/sla", ...gate, async (req, res) => {
    const r = await resolvePolicy(req.session.orgId!, req.params.clientId as string);
    return res.json(r);
  });

  app.put("/api/support/clients/:clientId/sla", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const parsed = slaPolicySchema.parse(req.body);
      const row = await upsertPolicy(req.session.orgId!, req.params.clientId as string, parsed);
      return res.json(row);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  app.delete("/api/support/clients/:clientId/sla", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    const ok = await deleteClientPolicy(req.session.orgId!, req.params.clientId as string);
    return res.json({ ok });
  });

  app.post("/api/support/inbound/check-now", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const org = await storage.getOrg(req.session.orgId!);
      if (!org?.supportInboundAddress) return res.status(400).json({ message: "Set the support address first" });
      if (org.emailProviderType !== "m365" || !org.emailOauthRefreshToken) return res.status(400).json({ message: "Connect a Microsoft 365 mailbox in Settings → Email first" });
      const { pollOrg } = await import("../support-inbound-graph");
      const r = await pollOrg({ id: org.id, supportInboundAddress: org.supportInboundAddress, emailOauthScopes: org.emailOauthScopes, emailOauthRefreshToken: org.emailOauthRefreshToken, emailProviderType: org.emailProviderType, emailOauthStatus: org.emailOauthStatus });
      return res.json(r);
    } catch (err: any) {
      return res.status(400).json({ message: String(err?.message || "Inbox check failed").slice(0, 200) });
    }
  });

  app.patch("/api/support/settings", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const parsed = supportSettingsSchema.parse(req.body);
      if (parsed.supportInboundAddress !== undefined) {
        await db.update(orgs).set({ supportInboundAddress: parsed.supportInboundAddress }).where(eq(orgs.id, req.session.orgId!));
      }
      const org = await storage.getOrg(req.session.orgId!);
      return res.json({ supportInboundAddress: org?.supportInboundAddress ?? null });
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  // ── Jira import (admin). Body: { clientId, projectId?, items: JiraExportIssue[], relinkTime?, dryRun? } ──
  app.post("/api/support/import/jira", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const body = req.body ?? {};
      if (!body.clientId || !Array.isArray(body.items)) return res.status(400).json({ message: "clientId and items[] are required" });
      if (body.items.length > 2000) return res.status(400).json({ message: "Import at most 2000 issues per request" });
      const report = await importJiraIssues({
        orgId: req.session.orgId!, clientId: String(body.clientId), projectId: body.projectId ? String(body.projectId) : null,
        items: body.items, relinkTime: body.relinkTime !== false, dryRun: body.dryRun === true,
      });
      if (!body.dryRun) {
        await storage.createAuditLog({
          orgId: req.session.orgId!, userId: req.session.userId!, action: "SUPPORT_CASES_IMPORTED", entityType: "client", entityId: String(body.clientId),
          details: { imported: report.imported, skipped: report.skipped.length, contactsCreated: report.contactsCreated, timeEntriesLinked: report.timeEntriesLinked, errors: report.errors.length },
        });
      }
      return res.json(report);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });

  // ── Jira import straight from Jira Cloud (admin). The API token is used for this request only. ──
  // The importer talks to Jira Cloud only: https and a *.atlassian.net host
  // (any http/host in the test env, where a fake Jira runs on localhost).
  // That closes the SSRF door an admin session would otherwise have.
  const isJiraHost = (u: string) => {
    try {
      const url = new URL(u);
      if (process.env.NODE_ENV === "test") return true;
      return url.protocol === "https:" && /^[a-z0-9-]+\.atlassian\.net$/i.test(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  };
  const jiraConnSchema = z.object({
    baseUrl: z.string().trim().url().refine(isJiraHost, "Jira URL must be https://<site>.atlassian.net"),
    email: z.string().trim().email(),
    apiToken: z.string().min(8).max(500),
    projectKey: z.string().trim().regex(/^[A-Z][A-Z0-9]{1,9}$/, "Project key like ABS"),
  });
  type JiraConn = z.infer<typeof jiraConnSchema>;

  /** Explicit credentials in the body win; otherwise the workspace's saved connection. */
  const resolveJiraConn = async (orgId: string, body: any): Promise<JiraConn> => {
    if (body?.apiToken) return jiraConnSchema.parse(body);
    const [saved] = await db.select().from(supportJiraConnections).where(eq(supportJiraConnections.orgId, orgId));
    if (!saved) throw new z.ZodError([{ code: "custom", path: ["apiToken"], message: "No saved Jira connection — enter the API token and save the connection first" }]);
    return jiraConnSchema.parse({
      baseUrl: body?.baseUrl || saved.baseUrl, email: body?.email || saved.email,
      apiToken: decryptField(saved.apiTokenEnc), projectKey: body?.projectKey || saved.projectKey,
    });
  };
  const jiraConnectionView = (row: any) => row ? ({
    connected: true, baseUrl: row.baseUrl, projectKey: row.projectKey, email: row.email, clientId: row.clientId, projectId: row.projectId,
    connectedAs: row.connectedAs, connectedAt: row.connectedAt, lastImportAt: row.lastImportAt, lastImportSummary: row.lastImportSummary,
  }) : { connected: false };

  // ── Saved connection: view / save (verifies with Jira first) / remove ──
  app.get("/api/support/import/jira-connection", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    const [row] = await db.select().from(supportJiraConnections).where(eq(supportJiraConnections.orgId, req.session.orgId!));
    return res.json(jiraConnectionView(row));
  });
  app.put("/api/support/import/jira-connection", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const body = req.body ?? {};
      // Editing a saved connection may leave the token blank: keep the stored one.
      if (!body.apiToken) {
        const [existing] = await db.select().from(supportJiraConnections).where(eq(supportJiraConnections.orgId, req.session.orgId!));
        if (existing) body.apiToken = decryptField(existing.apiTokenEnc);
      }
      const conn = jiraConnSchema.parse(body);
      const client = new JiraClient(conn);
      const me = await client.whoAmI(); // never store a token that does not work
      const values = {
        orgId: req.session.orgId!, baseUrl: conn.baseUrl, projectKey: conn.projectKey, email: conn.email, apiTokenEnc: encryptField(conn.apiToken),
        clientId: body.clientId ? String(body.clientId) : null, projectId: body.projectId ? String(body.projectId) : null,
        connectedAs: me.displayName || null, connectedAt: new Date(), updatedByUserId: req.session.userId!,
      };
      const [row] = await db.insert(supportJiraConnections).values(values)
        .onConflictDoUpdate({ target: supportJiraConnections.orgId, set: { ...values } }).returning();
      await storage.createAuditLog({ orgId: req.session.orgId!, userId: req.session.userId!, action: "SUPPORT_JIRA_CONNECTED", entityType: "org", entityId: req.session.orgId!, details: { baseUrl: conn.baseUrl, projectKey: conn.projectKey, email: conn.email, connectedAs: me.displayName } });
      return res.json(jiraConnectionView(row));
    } catch (err: any) {
      return res.status(400).json({ message: jiraError(err) });
    }
  });
  app.delete("/api/support/import/jira-connection", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    await db.delete(supportJiraConnections).where(eq(supportJiraConnections.orgId, req.session.orgId!));
    await storage.createAuditLog({ orgId: req.session.orgId!, userId: req.session.userId!, action: "SUPPORT_JIRA_DISCONNECTED", entityType: "org", entityId: req.session.orgId!, details: {} }).catch(() => {});
    return res.json({ connected: false });
  });
  const jiraError = (err: any): string => {
    if (err instanceof z.ZodError) return friendlyError(err);
    if (err instanceof JiraHttpError) return err.status === 401 || err.status === 403 ? `Jira ${err.status}: check the email and API token` : err.message;
    if (/more than \d+ (issues|comments)/.test(String(err?.message))) return String(err.message);
    return sanitizeErrorMessage(err);
  };

  app.post("/api/support/import/jira-test", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const conn = await resolveJiraConn(req.session.orgId!, req.body);
      const client = new JiraClient(conn);
      const me = await client.whoAmI();
      const issues = await client.listIssues(conn.projectKey);
      const statuses: Record<string, number> = {};
      for (const it of issues) { const n = it.fields?.status?.name || "?"; statuses[n] = (statuses[n] || 0) + 1; }
      return res.json({ ok: true, connectedAs: me.displayName, issues: issues.length, firstKey: issues[0]?.key ?? null, lastKey: issues[issues.length - 1]?.key ?? null, statuses });
    } catch (err: any) {
      return res.status(400).json({ message: jiraError(err) });
    }
  });

  app.post("/api/support/import/jira-fetch", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const conn = await resolveJiraConn(req.session.orgId!, req.body);
      const body = req.body ?? {};
      const [saved] = await db.select().from(supportJiraConnections).where(eq(supportJiraConnections.orgId, req.session.orgId!));
      // "Used the saved connection" = saved token, same site and project.
      const usedSaved = !!saved && !body.apiToken && conn.baseUrl === saved.baseUrl && conn.projectKey === saved.projectKey;
      // Saved destination applies only to that connection, and only when the
      // request OMITS the field ("None" arrives as null and must stay None).
      if (usedSaved && !("clientId" in body) && saved?.clientId) body.clientId = saved.clientId;
      if (usedSaved && !("projectId" in body) && saved?.projectId && saved.clientId && String(body.clientId) === saved.clientId) body.projectId = saved.projectId;
      if (!body.clientId) return res.status(400).json({ message: "clientId is required" });
      const items = await pullProject(conn, conn.projectKey);
      if (items.length > MAX_ISSUES) return res.status(400).json({ message: `Import at most ${MAX_ISSUES} issues per request` });
      const jira = new JiraClient(conn);
      const report = await importJiraIssues({
        orgId: req.session.orgId!, clientId: String(body.clientId), projectId: body.projectId ? String(body.projectId) : null,
        items, relinkTime: body.relinkTime !== false, dryRun: body.dryRun === true,
        downloadAttachment: body.attachments === false ? undefined : (att) => jira.getBytes(att.contentUrl, MAX_ATTACHMENT_BYTES),
        attachmentsForExisting: body.attachmentsForExisting === "all" || body.attachmentsForExisting === "none" ? body.attachmentsForExisting : "open",
      });
      if (!body.dryRun) {
        await storage.createAuditLog({
          orgId: req.session.orgId!, userId: req.session.userId!, action: "SUPPORT_CASES_IMPORTED", entityType: "client", entityId: String(body.clientId),
          details: { source: "jira-fetch", projectKey: conn.projectKey, pulled: items.length, imported: report.imported, skipped: report.skipped.length, contactsCreated: report.contactsCreated, timeEntriesLinked: report.timeEntriesLinked, errors: report.errors.length },
        });
      }
      // Remember destination + history only for an import that used the saved
      // connection — a one-off import with explicit credentials must not
      // rewrite the saved connection's defaults.
      if (!body.dryRun && saved && usedSaved) {
        await db.update(supportJiraConnections).set({
          clientId: String(body.clientId), projectId: body.projectId ? String(body.projectId) : null, lastImportAt: new Date(),
          lastImportSummary: { pulled: items.length, imported: report.imported, skipped: report.skipped.length, attachmentsImported: (report as any).attachmentsImported ?? 0, errors: report.errors.length },
        }).where(and(eq(supportJiraConnections.orgId, req.session.orgId!), eq(supportJiraConnections.connectedAt, saved.connectedAt))).catch(() => {}); // no-op if the connection changed meanwhile
      }
      return res.json({ pulled: items.length, ...report });
    } catch (err: any) {
      return res.status(400).json({ message: jiraError(err) });
    }
  });

  app.get("/api/support/clients/:clientId/settings", ...gate, async (req, res) => {
    const row = await cases.getClientCaseSettings(req.session.orgId!, req.params.clientId as string);
    if (!row) return res.status(404).json({ message: "Client not found" });
    return res.json(row);
  });

  app.patch("/api/support/clients/:clientId/settings", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const parsed = updateClientCaseSettingsSchema.parse(req.body);
      const row = await cases.updateClientCaseSettings(req.session.orgId!, req.params.clientId as string, parsed);
      if (!row) return res.status(404).json({ message: "Client not found" });
      return res.json(row);
    } catch (err: any) {
      return res.status(400).json({ message: friendlyError(err) });
    }
  });
}
