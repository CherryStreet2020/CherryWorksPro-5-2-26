import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requireManagerOrAbove, requireAdmin, sanitizeErrorMessage } from "./middleware";
import { requireTier } from "../lib/tier-gate";
import {
  createSupportCaseSchema,
  updateSupportCaseSchema,
  createSupportCaseMessageSchema,
  upsertSupportCaseTypeSchema,
  updateClientCaseSettingsSchema,
  SUPPORT_CASE_STATUSES,
} from "@shared/schema";
import * as cases from "../support-cases";
import { importJiraIssues } from "../support-import";
import { JiraClient, pullProject } from "../support-jira";
import { resolvePolicy, upsertPolicy, deleteClientPolicy, getPolicyRow, DEFAULT_POLICY } from "../support-sla";
import { slaPolicySchema, supportSettingsSchema } from "@shared/schema";
import { db } from "../db";
import { orgs } from "@shared/schema";
import { eq } from "drizzle-orm";

// Validation and business-rule messages are meant for the user; everything
// else goes through the production sanitizer.
const USER_FACING = [/not found/i, /belongs to a different client/i, /does not belong/i, /is required/i, /at most/i, /must be/i, /starting with a letter/i, /already used by another client/i, /exactly one key prefix/i];
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
    return res.json({ orgSlug: org.slug, portalUrl: `${base}/portal/${org.slug}` });
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
    const [messages, events, time] = await Promise.all([
      cases.listMessages(orgId, id, true),
      cases.listEvents(orgId, id),
      cases.listCaseTime(orgId, id),
    ]);
    return res.json({ ...cases.withSla({ ...row, minutesLogged: Number(row.minutesLogged) }), messages, events, time });
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
    const ok = await cases.deleteCase(req.session.orgId!, req.params.id as string);
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
    return res.json({ policy: row ? {
      firstResponseHours: Number(row.firstResponseHours), resolutionHours: Number(row.resolutionHours),
      businessHoursOnly: row.businessHoursOnly, businessStartHour: row.businessStartHour, businessEndHour: row.businessEndHour, timezone: row.timezone,
    } : DEFAULT_POLICY, isDefault: !row, supportInboundAddress: org?.supportInboundAddress ?? null });
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
  const jiraConnSchema = z.object({
    baseUrl: z.string().trim().url().refine(u => process.env.NODE_ENV === "test" || u.startsWith("https://"), "Jira URL must be https"),
    email: z.string().trim().email(),
    apiToken: z.string().min(8).max(500),
    projectKey: z.string().trim().regex(/^[A-Z][A-Z0-9]{1,9}$/, "Project key like ABS"),
  });

  app.post("/api/support/import/jira-test", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const conn = jiraConnSchema.parse(req.body);
      const client = new JiraClient(conn);
      const me = await client.whoAmI();
      const issues = await client.listIssues(conn.projectKey);
      const statuses: Record<string, number> = {};
      for (const it of issues) { const n = it.fields?.status?.name || "?"; statuses[n] = (statuses[n] || 0) + 1; }
      return res.json({ ok: true, connectedAs: me.displayName, issues: issues.length, firstKey: issues[0]?.key ?? null, lastKey: issues[issues.length - 1]?.key ?? null, statuses });
    } catch (err: any) {
      return res.status(400).json({ message: String(err?.message || "Could not reach Jira") });
    }
  });

  app.post("/api/support/import/jira-fetch", requireAuth, requireAdmin, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const conn = jiraConnSchema.parse(req.body);
      const body = req.body ?? {};
      if (!body.clientId) return res.status(400).json({ message: "clientId is required" });
      const items = await pullProject(conn, conn.projectKey);
      const report = await importJiraIssues({
        orgId: req.session.orgId!, clientId: String(body.clientId), projectId: body.projectId ? String(body.projectId) : null,
        items, relinkTime: body.relinkTime !== false, dryRun: body.dryRun === true,
      });
      if (!body.dryRun) {
        await storage.createAuditLog({
          orgId: req.session.orgId!, userId: req.session.userId!, action: "SUPPORT_CASES_IMPORTED", entityType: "client", entityId: String(body.clientId),
          details: { source: "jira-fetch", projectKey: conn.projectKey, pulled: items.length, imported: report.imported, skipped: report.skipped.length, contactsCreated: report.contactsCreated, timeEntriesLinked: report.timeEntriesLinked, errors: report.errors.length },
        });
      }
      return res.json({ pulled: items.length, ...report });
    } catch (err: any) {
      return res.status(400).json({ message: err instanceof z.ZodError ? friendlyError(err) : String(err?.message || "Import failed") });
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
