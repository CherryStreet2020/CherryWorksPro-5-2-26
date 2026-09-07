import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requireManagerOrAbove, sanitizeErrorMessage } from "./middleware";
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

// Validation and business-rule messages are meant for the user; everything
// else goes through the production sanitizer.
const USER_FACING = [/not found/i, /belongs to a different client/i, /does not belong/i, /is required/i, /at most/i, /must be/i, /starting with a letter/i, /already used by another client/i];
function friendlyError(err: any): string {
  if (err instanceof z.ZodError) return err.issues[0]?.message || "Invalid input";
  const msg = String(err?.message || "");
  if (USER_FACING.some(rx => rx.test(msg))) return msg;
  return sanitizeErrorMessage(err);
}

const listQuerySchema = z.object({
  view: z.enum(["open", "mine", "unassigned", "waiting", "resolved", "all"]).optional(),
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
    const base = (process.env.APP_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
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
      return res.json(rows.map(r => ({ ...r, minutesLogged: Number(r.minutesLogged) })));
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
    return res.json({ ...row, minutesLogged: Number(row.minutesLogged), messages, events, time });
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
