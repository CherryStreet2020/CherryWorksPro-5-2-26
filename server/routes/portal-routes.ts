import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  orgs, supportCases, supportCaseTypes, clientActivities,
  portalRequestLinkSchema, portalVerifySchema, portalCreateCaseSchema, portalMessageSchema,
  SUPPORT_CASE_OPEN_STATUSES,
} from "@shared/schema";
import * as cases from "../support-cases";
import {
  findPortalContact, issueLoginLink, consumeLoginLink, revokeSession, requirePortal,
  readCookie, setSessionCookie, clearSessionCookie, resolveSession, portalBaseUrl, PORTAL_COOKIE,
} from "../portal-auth";
import { sendPortalLoginEmail } from "../email";
import multer from "multer";
import { MAX_ATTACHMENT_BYTES, createAttachment, listAttachments, getAttachment, streamBytes, attachmentView, isAllowedAttachment } from "../support-attachments";

const portalUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedAttachment(file.originalname)) return cb(new Error("That file type is not allowed"));
    cb(null, true);
  },
});
import { requireAuth, requireManagerOrAbove, sanitizeErrorMessage } from "./middleware";
import { requireTier } from "../lib/tier-gate";

const isTestEnv = process.env.NODE_ENV === "test" && process.env.VITEST === "true";

const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many sign-in requests. Please wait a few minutes and try again." },
});

function friendly(err: any): string {
  if (err instanceof z.ZodError) return err.issues[0]?.message || "Invalid input";
  const msg = String(err?.message || "");
  if (/not found|write a message|tell us|at most|valid email|not allowed|15 MB|is empty|No files/i.test(msg)) return msg;
  return sanitizeErrorMessage(err);
}

async function orgBySlug(slug: string) {
  const [org] = await db.select({ id: orgs.id, name: orgs.name, slug: orgs.slug, logoUrl: orgs.logoUrl, email: orgs.email, phone: orgs.phone, website: orgs.website })
    .from(orgs).where(eq(orgs.slug, slug));
  return org;
}

/** Cases this contact may see: their own, or the whole client when they are the primary contact. */
function visibleCaseWhere(req: Request) {
  const p = req.portal!;
  const own = or(
    eq(supportCases.requesterContactId, p.contact.id),
    p.contact.email ? sql`lower(${supportCases.requesterEmail}) = ${p.contact.email.toLowerCase()}` : sql`false`,
  )!;
  return and(
    eq(supportCases.orgId, p.orgId),
    eq(supportCases.clientId, p.client.id),
    p.contact.isPrimary ? sql`true` : own,
  )!;
}

/** Non-GET portal calls must carry X-Requested-With: cwp-portal (cross-site forms cannot set it). */
export function requirePortalHeader(req: Request, res: Response, next: () => void) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (String(req.headers["x-requested-with"] || "").toLowerCase() !== "cwp-portal") {
    return res.status(403).json({ message: "Missing portal request header" });
  }
  next();
}

export function registerPortalRoutes(app: Express) {
  app.use("/api/portal", requirePortalHeader);
  // ── Public: branding for the sign-in page ─────────────────────────────
  app.get("/api/portal/:orgSlug/branding", async (req, res) => {
    const org = await orgBySlug(String(req.params.orgSlug));
    if (!org) return res.status(404).json({ message: "Portal not found" });
    return res.json({ name: org.name, logoUrl: org.logoUrl, slug: org.slug });
  });

  // ── Public: request a sign-in link. Always 200 — never reveals whether the address exists. ──
  app.post("/api/portal/:orgSlug/auth/request-link", linkLimiter, async (req, res) => {
    try {
      const { email } = portalRequestLinkSchema.parse(req.body);
      const org = await orgBySlug(String(req.params.orgSlug));
      if (!org) return res.status(404).json({ message: "Portal not found" });
      const contact = await findPortalContact(org.id, email);
      let debugLink: string | undefined;
      if (contact) {
        const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || null;
        const { token } = await issueLoginLink(org.id, contact.id, ip);
        const link = `${portalBaseUrl()}/portal/${org.slug}/verify?token=${encodeURIComponent(token)}`;
        const fullOrg = await storage.getOrg(org.id);
        try {
          await sendPortalLoginEmail({ to: contact.email!, contactName: `${contact.firstName} ${contact.lastName}`.trim(), orgName: org.name, link, org: fullOrg ?? null });
        } catch (err) {
          console.error("[portal] sign-in email failed", { orgId: org.id, contactId: contact.id, err: (err as Error)?.message });
        }
        if (isTestEnv) debugLink = link;
      }
      return res.json({ ok: true, message: "If that address is on file, a sign-in link is on its way.", ...(debugLink ? { debugLink } : {}) });
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  // ── Public: exchange the link for a session cookie ────────────────────
  app.post("/api/portal/:orgSlug/auth/verify", linkLimiter, async (req, res) => {
    try {
      const { token } = portalVerifySchema.parse(req.body);
      const result = await consumeLoginLink(String(req.params.orgSlug), token, req.headers["user-agent"] ?? null);
      if (!result) return res.status(400).json({ message: "That sign-in link is no longer valid. Request a new one." });
      setSessionCookie(res, result.sessionToken);
      return res.json(publicIdentity(result.identity));
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  app.post("/api/portal/:orgSlug/auth/logout", async (req, res) => {
    const token = readCookie(req, PORTAL_COOKIE);
    if (token) {
      const identity = await resolveSession(String(req.params.orgSlug), token);
      if (identity) await revokeSession(identity.sessionId);
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  // ── Signed-in ─────────────────────────────────────────────────────────
  app.get("/api/portal/:orgSlug/me", requirePortal, async (req, res) => {
    const org = await orgBySlug(req.portal!.orgSlug);
    return res.json({ ...publicIdentity(req.portal!), org: org ? { name: org.name, logoUrl: org.logoUrl, email: org.email, phone: org.phone, website: org.website } : null });
  });

  app.get("/api/portal/:orgSlug/types", requirePortal, async (req, res) => {
    const rows = await cases.ensureDefaultTypes(req.portal!.orgId);
    return res.json(rows.filter(t => t.isActive).map(t => ({ id: t.id, name: t.name, description: t.description })));
  });

  app.get("/api/portal/:orgSlug/cases", requirePortal, async (req, res) => {
    const rows = await db
      .select({
        id: supportCases.id, caseKey: supportCases.caseKey, subject: supportCases.subject, status: supportCases.status,
        priority: supportCases.priority, typeName: supportCaseTypes.name, requesterName: supportCases.requesterName,
        createdAt: supportCases.createdAt, updatedAt: supportCases.updatedAt,
        lastAgentMessageAt: supportCases.lastAgentMessageAt, lastCustomerMessageAt: supportCases.lastCustomerMessageAt,
        resolvedAt: supportCases.resolvedAt,
      })
      .from(supportCases)
      .leftJoin(supportCaseTypes, and(eq(supportCases.typeId, supportCaseTypes.id), eq(supportCaseTypes.orgId, req.portal!.orgId)))
      .where(visibleCaseWhere(req))
      .orderBy(sql`${supportCases.updatedAt} desc`)
      .limit(300);
    const open = rows.filter(r => (SUPPORT_CASE_OPEN_STATUSES as readonly string[]).includes(r.status));
    return res.json({
      cases: rows.map(r => ({ ...r, awaitingYou: r.status === "WAITING_ON_CUSTOMER", hasNewReply: !!r.lastAgentMessageAt && (!r.lastCustomerMessageAt || r.lastAgentMessageAt > r.lastCustomerMessageAt) })),
      counts: { open: open.length, waitingOnYou: open.filter(r => r.status === "WAITING_ON_CUSTOMER").length, resolved: rows.length - open.length },
    });
  });

  app.post("/api/portal/:orgSlug/cases", requirePortal, async (req, res) => {
    try {
      const parsed = portalCreateCaseSchema.parse(req.body);
      const p = req.portal!;
      const row = await cases.createCase(p.orgId, {
        clientId: p.client.id,
        typeId: parsed.typeId ?? null,
        subject: parsed.subject,
        description: parsed.description || null,
        priority: parsed.priority,
        requesterContactId: p.contact.id,
        requesterName: `${p.contact.firstName} ${p.contact.lastName}`.trim(),
        requesterEmail: p.contact.email || null,
        source: "PORTAL",
      }, null);
      return res.status(201).json({ id: row.id, caseKey: row.caseKey, subject: row.subject, status: row.status });
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  app.get("/api/portal/:orgSlug/cases/:id", requirePortal, async (req, res) => {
    const p = req.portal!;
    const [row] = await db
      .select({
        id: supportCases.id, caseKey: supportCases.caseKey, subject: supportCases.subject, description: supportCases.description,
        status: supportCases.status, priority: supportCases.priority, typeName: supportCaseTypes.name,
        requesterName: supportCases.requesterName, createdAt: supportCases.createdAt, updatedAt: supportCases.updatedAt,
        firstResponseAt: supportCases.firstResponseAt, resolvedAt: supportCases.resolvedAt, closedAt: supportCases.closedAt,
        assigneeUserId: supportCases.assigneeUserId,
      })
      .from(supportCases)
      .leftJoin(supportCaseTypes, and(eq(supportCases.typeId, supportCaseTypes.id), eq(supportCaseTypes.orgId, p.orgId)))
      .where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
    if (!row) return res.status(404).json({ message: "Support case not found" });
    const [messages, events] = await Promise.all([
      cases.listMessages(p.orgId, row.id, false),
      cases.listEvents(p.orgId, row.id),
    ]);
    let assigneeName: string | null = null;
    if (row.assigneeUserId) {
      const agent = (await cases.listAgents(p.orgId)).find(a => a.id === row.assigneeUserId);
      assigneeName = agent?.name ?? null;
    }
    let hours: { minutes: number; billableMinutes: number } | null = null;
    if (p.client.portalShowHours) {
      const t = await cases.listCaseTime(p.orgId, row.id);
      hours = { minutes: t.totals.minutes, billableMinutes: t.totals.billableMinutes };
    }
    const attachments = await listAttachments(p.orgId, row.id);
    const { assigneeUserId: _a, ...safe } = row;
    return res.json({
      ...safe,
      assigneeName,
      attachments: attachments.map(a => attachmentView(a, `/api/portal/${p.orgSlug}/attachments`)),
      messages: messages.map(m => ({ id: m.id, authorName: m.authorName, fromTeam: !!m.authorUserId, body: m.body, createdAt: m.createdAt })),
      events: events.filter(e => e.kind === "status" || e.kind === "created").map(e => ({ id: e.id, kind: e.kind, toValue: e.toValue, createdAt: e.createdAt })),
      hours,
    });
  });

  app.post("/api/portal/:orgSlug/cases/:id/messages", requirePortal, async (req, res) => {
    try {
      const { body } = portalMessageSchema.parse(req.body);
      const p = req.portal!;
      const [row] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
      if (!row) return res.status(404).json({ message: "Support case not found" });
      const result = await cases.addMessage(p.orgId, row.id, {
        body, visibility: "CUSTOMER",
        author: { contactId: p.contact.id, name: `${p.contact.firstName} ${p.contact.lastName}`.trim() },
      });
      if (!result) return res.status(404).json({ message: "Support case not found" });
      return res.status(201).json({ id: result.message.id, status: result.case.status });
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  app.post("/api/portal/:orgSlug/cases/:id/attachments", requirePortal, (req, res, next) => {
    portalUpload.array("files", 10)(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err?.code === "LIMIT_FILE_SIZE" ? "Files must be 15 MB or smaller" : (err?.message || "Upload failed") });
      next();
    });
  }, async (req, res) => {
    try {
      const p = req.portal!;
      const [row] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
      if (!row) return res.status(404).json({ message: "Support case not found" });
      const files = ((req as any).files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) return res.status(400).json({ message: "No files were uploaded" });
      const created = [];
      for (const f of files) {
        created.push(await createAttachment({ orgId: p.orgId, caseId: row.id, filename: f.originalname, mimeType: f.mimetype, bytes: f.buffer, uploadedByContactId: p.contact.id, source: "PORTAL" }));
      }
      return res.status(201).json(created.map(a => attachmentView(a, `/api/portal/${p.orgSlug}/attachments`)));
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  app.get("/api/portal/:orgSlug/attachments/:id", requirePortal, async (req, res) => {
    const p = req.portal!;
    const a = await getAttachment(p.orgId, String(req.params.id));
    if (!a) return res.status(404).json({ message: "Attachment not found" });
    const [row] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, a.caseId)));
    if (!row) return res.status(404).json({ message: "Attachment not found" });
    const inline = a.mimeType.startsWith("image/") || a.mimeType === "application/pdf";
    await streamBytes(a.storageKey, a.mimeType, a.filename, res, inline && req.query.download !== "1");
  });

  app.get("/api/portal/:orgSlug/billing", requirePortal, async (req, res) => {
    const data = await storage.getClientPortalDataByClientId(req.portal!.client.id);
    if (!data) return res.status(404).json({ message: "Not found" });
    return res.json(data);
  });

  // ── Agent side: send a contact their sign-in link ─────────────────────
  app.post("/api/support/contacts/:contactId/portal-invite", requireAuth, requireTier("PROFESSIONAL"), async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const contact = await storage.getContactById(String(req.params.contactId), orgId);
      if (!contact || !contact.clientId) return res.status(404).json({ message: "Contact not found" });
      if (!contact.email) return res.status(400).json({ message: "This contact has no email address" });
      const org = await storage.getOrg(orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const { token } = await issueLoginLink(orgId, contact.id, null);
      const link = `${portalBaseUrl()}/portal/${org.slug}/verify?token=${encodeURIComponent(token)}`;
      await sendPortalLoginEmail({ to: contact.email, contactName: `${contact.firstName} ${contact.lastName}`.trim(), orgName: org.name, link, org });
      await db.insert(clientActivities).values({
        orgId, clientId: contact.clientId, userId: req.session.userId!, type: "PORTAL_INVITE_SENT",
        title: `Portal sign-in link sent to ${contact.firstName} ${contact.lastName}`, description: contact.email, linkUrl: null, metadata: { contactId: contact.id },
      });
      return res.json({ ok: true, ...(isTestEnv ? { debugLink: link } : {}) });
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  app.post("/api/support/contacts/:contactId/portal-revoke", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    const orgId = req.session.orgId!;
    const contact = await storage.getContactById(String(req.params.contactId), orgId);
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    const { revokeAllForContact } = await import("../portal-auth");
    await revokeAllForContact(orgId, contact.id);
    return res.json({ ok: true });
  });
}

function publicIdentity(p: NonNullable<Request["portal"]>) {
  return {
    orgSlug: p.orgSlug,
    orgName: p.orgName,
    orgLogoUrl: p.orgLogoUrl,
    contact: { id: p.contact.id, firstName: p.contact.firstName, lastName: p.contact.lastName, email: p.contact.email, isPrimary: p.contact.isPrimary },
    client: { id: p.client.id, name: p.client.name, showHours: p.client.portalShowHours },
  };
}

