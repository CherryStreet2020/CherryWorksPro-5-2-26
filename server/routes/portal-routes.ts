import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  orgs, clients, clientContacts, supportCases, supportCaseTypes, clientActivities, portalBlockedEmails,
  portalRequestLinkSchema, portalVerifySchema, portalCreateCaseSchema, portalMessageSchema,
  portalSetNameSchema, portalAdminCaseUpdateSchema, portalInviteColleagueSchema,
  SUPPORT_CASE_OPEN_STATUSES, SUPPORT_CASE_PRIORITIES,
} from "@shared/schema";
import { emailDomain, isSharedMailDomain } from "@shared/mail-domains";
import * as cases from "../support-cases";
import {
  findPortalContact, resolveOrProvisionContact, withContactEmailLock, isPortalBlocked, blockPortalEmail, issueLoginLink, consumeLoginLink, revokeSession, requirePortal,
  requireBilling, requireCustomerAdmin, readCookie, setSessionCookie, clearSessionCookie, resolveSession, portalBaseUrl, PORTAL_COOKIE,
  type PortalSurface,
} from "../portal-auth";
import { isNull, ne } from "drizzle-orm";
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
// Harnesses (vitest AND the Playwright launcher, both NODE_ENV=test) request many links.
const isHarness = process.env.NODE_ENV === "test";

const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isHarness ? 1000 : 10,
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

/** Where a sign-in link lands. The token is the same for both; access is decided by the contact's flags. */
export function loginLinkFor(orgSlug: string, token: string, surface: PortalSurface, returnTo: string | null = null): string {
  const next = returnTo ? `&next=${encodeURIComponent(returnTo)}` : "";
  return `${portalBaseUrl()}/${surface === "portal" ? "portal" : "help"}/${orgSlug}/verify?token=${encodeURIComponent(token)}${next}`;
}

/** A place to return to after sign-in: same org, one of the two customer surfaces, a plain path. Anything else → null. */
export function safeReturnPath(raw: unknown, orgSlug: string): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^\/(help|portal)\/([A-Za-z0-9-]+)(\/[A-Za-z0-9/_-]*)?$/);
  if (!m || m[2] !== orgSlug) return null;
  if (/\/(login|verify)$/.test(raw)) return null;
  return raw;
}

/** "My case": raised by this contact (by id, or by address for cases recorded before the contact existed). */
function ownCaseWhere(p: NonNullable<Request["portal"]>) {
  return or(
    eq(supportCases.requesterContactId, p.contact.id),
    p.contact.email ? sql`lower(${supportCases.requesterEmail}) = ${p.contact.email.toLowerCase()}` : sql`false`,
  )!;
}
function isOwnCase(p: NonNullable<Request["portal"]>, r: { requesterContactId: string | null; requesterEmail?: string | null }) {
  return r.requesterContactId === p.contact.id || (!!p.contact.email && !!r.requesterEmail && r.requesterEmail.toLowerCase() === p.contact.email.toLowerCase());
}

/** Cases this contact may see: their own, or the whole client when they are a Customer Admin. */
function visibleCaseWhere(req: Request) {
  const p = req.portal!;
  return and(
    eq(supportCases.orgId, p.orgId),
    eq(supportCases.clientId, p.client.id),
    p.contact.portalRole === "admin" ? sql`true` : ownCaseWhere(p),
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
      const { email, surface: requested, next } = portalRequestLinkSchema.parse(req.body);
      const org = await orgBySlug(String(req.params.orgSlug));
      if (!org) return res.status(404).json({ message: "Portal not found" });
      const returnTo = safeReturnPath(next, org.slug);
      // Help Center sign-ins may self-register an address on a client's approved domain;
      // the Customer Portal never provisions (money needs an explicit billing contact).
      const contact = (await isPortalBlocked(org.id, email)) ? undefined
        : requested === "portal" ? await findPortalContact(org.id, email) : await resolveOrProvisionContact(org.id, email, "help-center");
      let debugLink: string | undefined;
      if (contact) {
        const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || null;
        const { token, email: boundEmail } = await issueLoginLink(org.id, contact.id, ip);
        const surface: PortalSurface = requested === "portal" && contact.billingAccess ? "portal" : "help";
        const link = loginLinkFor(org.slug, token, surface, returnTo && returnTo.startsWith(`/${surface}/`) ? returnTo : null);
        const fullOrg = await storage.getOrg(org.id);
        try {
          await sendPortalLoginEmail({
            to: boundEmail, contactName: `${contact.firstName} ${contact.lastName}`.trim(), orgName: org.name, link, org: fullOrg ?? null,
            surface, billingDenied: requested === "portal" && surface === "help",
          });
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

  // A self-registered contact tells us their name once; firm users edit names after that.
  app.put("/api/portal/:orgSlug/me", requirePortal, async (req, res) => {
    try {
      const p = req.portal!;
      if (!p.contact.needsName) return res.status(400).json({ message: "Your name is already on file. Ask the support team to change it." });
      const { firstName, lastName } = portalSetNameSchema.parse(req.body);
      await db.update(clientContacts).set({ firstName, lastName, updatedAt: new Date() }).where(and(eq(clientContacts.id, p.contact.id), eq(clientContacts.orgId, p.orgId)));
      const fresh = await resolveSession(p.orgSlug, readCookie(req, PORTAL_COOKIE) || "");
      return res.json(fresh ? publicIdentity(fresh) : { ok: true });
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  app.get("/api/portal/:orgSlug/types", requirePortal, async (req, res) => {
    const rows = await cases.ensureDefaultTypes(req.portal!.orgId);
    return res.json(rows.filter(t => t.isActive).map(t => ({ id: t.id, name: t.name, description: t.description })));
  });

  app.get("/api/portal/:orgSlug/cases", requirePortal, async (req, res) => {
    const p = req.portal!;
    const filters = [visibleCaseWhere(req)];
    const requester = typeof req.query.requester === "string" ? req.query.requester : "";
    const priority = typeof req.query.priority === "string" ? req.query.priority.toUpperCase() : "";
    if (requester) filters.push(eq(supportCases.requesterContactId, requester));
    if (req.query.mine === "1") filters.push(ownCaseWhere(p));
    if ((SUPPORT_CASE_PRIORITIES as readonly string[]).includes(priority)) filters.push(eq(supportCases.priority, priority));
    // Status is filtered in SQL and counts are aggregated over the whole authorised set,
    // so an old open case never hides behind newer resolved ones and totals are exact.
    const status = req.query.status === "resolved" ? "resolved" : req.query.status === "all" ? "all" : "open";
    const openStatuses = SUPPORT_CASE_OPEN_STATUSES as readonly string[];
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const authorised = and(...filters)!;
    const statusWhere = status === "open" ? sql`${supportCases.status} IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)})`
      : status === "resolved" ? sql`${supportCases.status} NOT IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)})` : sql`true`;
    const [rows, [agg], byPrio] = await Promise.all([
      db.select({
          id: supportCases.id, caseKey: supportCases.caseKey, subject: supportCases.subject, status: supportCases.status,
          priority: supportCases.priority, typeName: supportCaseTypes.name, requesterName: supportCases.requesterName,
          requesterContactId: supportCases.requesterContactId, requesterEmail: supportCases.requesterEmail,
          createdAt: supportCases.createdAt, updatedAt: supportCases.updatedAt,
          lastAgentMessageAt: supportCases.lastAgentMessageAt, lastCustomerMessageAt: supportCases.lastCustomerMessageAt,
          resolvedAt: supportCases.resolvedAt,
        })
        .from(supportCases)
        .leftJoin(supportCaseTypes, and(eq(supportCases.typeId, supportCaseTypes.id), eq(supportCaseTypes.orgId, p.orgId)))
        .where(and(authorised, statusWhere))
        .orderBy(sql`${supportCases.updatedAt} desc`, sql`${supportCases.id} desc`)
        .limit(limit + 1).offset(offset),
      db.select({
          open: sql<number>`count(*) filter (where ${supportCases.status} IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)}))`.mapWith(Number),
          waitingOnYou: sql<number>`count(*) filter (where ${supportCases.status} = 'WAITING_ON_CUSTOMER')`.mapWith(Number),
          resolved: sql<number>`count(*) filter (where ${supportCases.status} NOT IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)}))`.mapWith(Number),
        }).from(supportCases).where(authorised),
      db.select({ priority: supportCases.priority, n: sql<number>`count(*)`.mapWith(Number) }).from(supportCases)
        .where(and(authorised, sql`${supportCases.status} IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)})`)).groupBy(supportCases.priority),
    ]);
    const byPriority: Record<string, number> = {};
    for (const r of byPrio) byPriority[r.priority] = r.n;
    const page = rows.slice(0, limit);
    return res.json({
      cases: page.map(({ requesterEmail: _e, ...r }) => ({ ...r, mine: isOwnCase(p, { requesterContactId: r.requesterContactId, requesterEmail: _e }), awaitingYou: r.status === "WAITING_ON_CUSTOMER", hasNewReply: !!r.lastAgentMessageAt && (!r.lastCustomerMessageAt || r.lastAgentMessageAt > r.lastCustomerMessageAt) })),
      counts: { open: agg?.open ?? 0, waitingOnYou: agg?.waitingOnYou ?? 0, resolved: agg?.resolved ?? 0, byPriority },
      paging: { status, limit, offset, hasMore: rows.length > limit },
      scope: p.contact.portalRole === "admin" ? "client" : "own",
    });
  });

  // Customer Admin: prioritise, close, reopen. Never a raw status from the customer.
  app.patch("/api/portal/:orgSlug/cases/:id", requirePortal, requireCustomerAdmin, async (req, res) => {
    try {
      const parsed = portalAdminCaseUpdateSchema.parse(req.body);
      const p = req.portal!;
      const [row] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
      if (!row) return res.status(404).json({ message: "Support case not found" });
      // The action is checked against the LOCKED row inside updateCase, never here.
      const input: cases.UpdateCaseInput = { customerAction: parsed.action };
      if (parsed.priority) input.priority = parsed.priority;
      const updated = await cases.updateCase(p.orgId, row.id, input, { userId: null, contactId: p.contact.id, name: `${p.contact.firstName} ${p.contact.lastName}`.trim() });
      if (!updated) return res.status(404).json({ message: "Support case not found" });
      return res.json({ id: updated.id, status: updated.status, priority: updated.priority });
    } catch (err: any) {
      if (err instanceof cases.CaseTransitionError) return res.status(409).json({ message: err.message });
      return res.status(400).json({ message: friendly(err) });
    }
  });

  // Customer Admin: who at the company can use the Help Center, and invite a colleague.
  app.get("/api/portal/:orgSlug/team", requirePortal, requireCustomerAdmin, async (req, res) => {
    const p = req.portal!;
    const rows = await db
      .select({ id: clientContacts.id, firstName: clientContacts.firstName, lastName: clientContacts.lastName, email: clientContacts.email, portalRole: clientContacts.portalRole, isPrimary: clientContacts.isPrimary, createdAt: clientContacts.createdAt, pending: sql<boolean>`${clientContacts.portalPendingAt} IS NOT NULL` })
      .from(clientContacts)
      .where(and(eq(clientContacts.orgId, p.orgId), eq(clientContacts.clientId, p.client.id), isNull(clientContacts.deletedAt)))
      .orderBy(sql`${clientContacts.lastName}, ${clientContacts.firstName}`);
    const [client] = await db.select({ domains: clients.portalEmailDomains }).from(clients).where(eq(clients.id, p.client.id));
    return res.json({ contacts: rows, approvedDomains: client?.domains ?? [] });
  });

  app.post("/api/portal/:orgSlug/team", requirePortal, requireCustomerAdmin, async (req, res) => {
    try {
      const { firstName, lastName, email } = portalInviteColleagueSchema.parse(req.body);
      const p = req.portal!;
      const norm = email.toLowerCase();
      const domain = emailDomain(norm);
      if (!domain || isSharedMailDomain(domain)) return res.status(400).json({ message: "Use a work email address for your colleague" });
      if (await isPortalBlocked(p.orgId, norm)) return res.status(400).json({ message: `${p.orgName} has closed the Help Center to that address. Ask them to allow it again.` });
      const [client] = await db.select({ domains: clients.portalEmailDomains }).from(clients).where(eq(clients.id, p.client.id));
      const approved = client?.domains ?? [];
      if (approved.length > 0 && !approved.includes(domain)) return res.status(400).json({ message: `Colleagues must use an approved address (${approved.map(d => "@" + d).join(", ")})` });
      // A domain approved for ANOTHER client of this firm belongs to that client's people:
      // inviting one of them here would file them (and their future cases) under the wrong company.
      const [owner] = await db.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.orgId, p.orgId), ne(clients.id, p.client.id), sql`${domain} = ANY(${clients.portalEmailDomains})`)).limit(1);
      if (owner) return res.status(400).json({ message: "That address belongs to another company's Help Center. Ask them to invite their colleague." });
      const created = await withContactEmailLock(p.orgId, norm, async (tx) => {
        const existing = await findPortalContact(p.orgId, norm, tx);
        if (existing) return null;
        const [row] = await tx.insert(clientContacts).values({
          orgId: p.orgId, clientId: p.client.id, firstName, lastName, email: norm,
          portalRole: "member", billingAccess: false, isPrimary: false, source: "help-center-invite", lifecycleStage: "customer",
        }).returning({ id: clientContacts.id });
        return row;
      });
      if (!created) return res.status(400).json({ message: "Someone with that email address is already set up" });
      const org = await storage.getOrg(p.orgId);
      const { token, email: boundEmail } = await issueLoginLink(p.orgId, created.id, null);
      const link = loginLinkFor(p.orgSlug, token, "help");
      try {
        await sendPortalLoginEmail({ to: boundEmail, contactName: `${firstName} ${lastName}`.trim(), orgName: p.orgName, link, org: org ?? null, surface: "help", invitedBy: `${p.contact.firstName} ${p.contact.lastName}`.trim() });
      } catch (err) {
        console.error("[help-center] invite email failed", { orgId: p.orgId, contactId: created.id, err: (err as Error)?.message });
      }
      await db.insert(clientActivities).values({
        orgId: p.orgId, clientId: p.client.id, userId: null, type: "PORTAL_INVITE_SENT",
        title: `${p.contact.firstName} ${p.contact.lastName} invited ${firstName} ${lastName} to the Help Center`, description: norm, linkUrl: null, metadata: { contactId: created.id },
      });
      return res.status(201).json({ id: created.id, ...(isTestEnv ? { debugLink: link } : {}) });
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
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

  app.get("/api/portal/:orgSlug/billing", requirePortal, requireBilling, async (req, res) => {
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
      const surface: PortalSurface = req.body?.surface === "portal" ? "portal" : "help";
      if (surface === "portal" && !contact.billingAccess) return res.status(400).json({ message: "Turn on billing access for this contact before sending a Customer Portal link" });
      if (await isPortalBlocked(orgId, contact.email)) return res.status(400).json({ message: "This address has been kept out of the Help Center. Use \"Allow again\" on the client's Contacts tab first." });
      const org = await storage.getOrg(orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const { token, email: boundEmail } = await issueLoginLink(orgId, contact.id, null);
      const link = loginLinkFor(org.slug, token, surface);
      await sendPortalLoginEmail({ to: boundEmail, contactName: `${contact.firstName} ${contact.lastName}`.trim(), orgName: org.name, link, org, surface });
      await db.insert(clientActivities).values({
        orgId, clientId: contact.clientId, userId: req.session.userId!, type: "PORTAL_INVITE_SENT",
        title: `${surface === "portal" ? "Customer Portal" : "Help Center"} sign-in link sent to ${contact.firstName} ${contact.lastName}`, description: contact.email, linkUrl: null, metadata: { contactId: contact.id, surface },
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
    // Revocation is a decision, not a hiccup: sessions die, outstanding links are voided,
    // and the address stays out until "Allow again" — all in one transaction.
    // The address to block is re-read under the contact's row lock inside blockPortalEmail.
    await blockPortalEmail({ orgId, clientId: contact.clientId, contactId: contact.id, email: contact.email ?? "", reason: "revoked", byUserId: req.session.userId ?? null });
    return res.json({ ok: true });
  });

  // Firm side: who is shut out, and letting them back in.
  app.get("/api/support/clients/:clientId/portal-blocked", requireAuth, requireTier("PROFESSIONAL"), async (req, res) => {
    const orgId = req.session.orgId!;
    const rows = await db.select({ id: portalBlockedEmails.id, email: portalBlockedEmails.email, reason: portalBlockedEmails.reason, createdAt: portalBlockedEmails.createdAt })
      .from(portalBlockedEmails).where(and(eq(portalBlockedEmails.orgId, orgId), eq(portalBlockedEmails.clientId, String(req.params.clientId))));
    return res.json(rows);
  });
  app.delete("/api/support/portal-blocked/:id", requireAuth, requireManagerOrAbove, requireTier("PROFESSIONAL"), async (req, res) => {
    const orgId = req.session.orgId!;
    const gone = await db.delete(portalBlockedEmails).where(and(eq(portalBlockedEmails.id, String(req.params.id)), eq(portalBlockedEmails.orgId, orgId))).returning({ id: portalBlockedEmails.id });
    if (gone.length === 0) return res.status(404).json({ message: "Not found" });
    return res.json({ ok: true });
  });
}

function publicIdentity(p: NonNullable<Request["portal"]>) {
  return {
    orgSlug: p.orgSlug,
    orgName: p.orgName,
    orgLogoUrl: p.orgLogoUrl,
    contact: { id: p.contact.id, firstName: p.contact.firstName, lastName: p.contact.lastName, email: p.contact.email, isPrimary: p.contact.isPrimary, portalRole: p.contact.portalRole, billingAccess: p.contact.billingAccess, needsName: p.contact.needsName },
    client: { id: p.client.id, name: p.client.name, showHours: p.client.portalShowHours },
  };
}

