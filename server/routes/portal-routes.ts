import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  orgs, clients, clientContacts, supportCases, supportCaseTypes, clientActivities, portalBlockedEmails,
  portalRequestLinkSchema, portalVerifySchema, portalCreateCaseSchema, portalMessageSchema, portalWatcherAddSchema, supportCaseWatchers, portalCaseReads,
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
import { MAX_ATTACHMENT_BYTES, createAttachment, listAttachments, getAttachment, streamBytes, attachmentView, isAllowedAttachment, AttachmentConflictError, AttachmentForbiddenError, parseClientFileIds } from "../support-attachments";

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
  const [org] = await db.select({ id: orgs.id, name: orgs.name, slug: orgs.slug, logoUrl: orgs.logoUrl, email: orgs.email, phone: orgs.phone, website: orgs.website, supportInboundAddress: orgs.supportInboundAddress })
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

/**
 * "My case": raised by this contact — by id, or by address ONLY for cases that have no linked
 * requester (recorded before the contact existed). Once a case has a linked requester, a stale
 * requester_email grants nothing to whoever holds that address now.
 */
function ownCaseWhere(p: NonNullable<Request["portal"]>) {
  return or(
    eq(supportCases.requesterContactId, p.contact.id),
    p.contact.email ? and(isNull(supportCases.requesterContactId), sql`lower(${supportCases.requesterEmail}) = ${p.contact.email.toLowerCase()}`)! : sql`false`,
  )!;
}
function isOwnCase(p: NonNullable<Request["portal"]>, r: { requesterContactId: string | null; requesterEmail?: string | null }) {
  if (r.requesterContactId) return r.requesterContactId === p.contact.id;
  return !!p.contact.email && !!r.requesterEmail && r.requesterEmail.toLowerCase() === p.contact.email.toLowerCase();
}
/** Cases this contact follows as a watcher. */
function watchedCaseWhere(p: NonNullable<Request["portal"]>) {
  return sql`EXISTS (SELECT 1 FROM ${supportCaseWatchers} w WHERE w.case_id = ${supportCases.id} AND w.contact_id = ${p.contact.id})`;
}

/** Cases this contact may see: their own or watched, or the whole client when they are a Customer Admin. */
function visibleCaseWhere(req: Request) {
  const p = req.portal!;
  return and(
    eq(supportCases.orgId, p.orgId),
    eq(supportCases.clientId, p.client.id),
    p.contact.portalRole === "admin" ? sql`true` : or(ownCaseWhere(p), watchedCaseWhere(p))!,
  )!;
}
/** In-transaction re-check of the same authority (for writes: message, upload, watcher changes). */
/**
 * Authority re-checks run INSIDE the write transaction under the case row lock.
 * authorizeContact: writes (reply, upload, add people) — anyone with access EXCEPT a reviewer (review only).
 * authorizeContactAccess: any access, a reviewer included — used for self-removal ("Stop following").
 * authorizeContactManage: requester or Customer Admin only — removing other people.
 */
function authorizeContact(req: Request) {
  const p = req.portal!;
  return async (tx: any, c: any) => { const r = await cases.customerCanAccess(tx, p.orgId, c, p.contact.id, { lock: true }); return r.ok && r.role !== "reviewer"; };
}
function authorizeContactAccess(req: Request) {
  const p = req.portal!;
  return async (tx: any, c: any) => (await cases.customerCanAccess(tx, p.orgId, c, p.contact.id, { lock: true })).ok;
}
function authorizeContactManage(req: Request) {
  const p = req.portal!;
  return async (tx: any, c: any) => { const r = await cases.customerCanAccess(tx, p.orgId, c, p.contact.id, { lock: true }); return r.ok && r.role !== "watcher" && r.role !== "reviewer"; };
}
/** The latest customer-visible moment on a case (see the unread rule in the list route). */
const customerActivitySql = sql`GREATEST(${supportCases.createdAt}, COALESCE(${supportCases.lastAgentMessageAt}, ${supportCases.createdAt}), COALESCE(${supportCases.lastCustomerMessageAt}, ${supportCases.createdAt}), COALESCE((SELECT max(e.created_at) FROM support_case_events e WHERE e.case_id = ${supportCases.id} AND e.kind IN ('status', 'watcher')), ${supportCases.createdAt}))`;

/** Field values arrive as strings in a multipart form; JSON bodies arrive typed. */
function parseCreateBody(req: Request) {
  const b: any = req.body ?? {};
  const asArr = (v: unknown) => v === undefined ? undefined : Array.isArray(v) ? v : typeof v === "string" && v.startsWith("[") ? JSON.parse(v) : [v];
  const body = { ...b };
  if (typeof b.intake === "string") body.intake = b.intake ? JSON.parse(b.intake) : undefined;
  for (const k of ["watcherContactIds", "watcherEmails", "reviewerContactIds", "reviewerEmails", "clientFileIds"]) body[k] = asArr(b[k]);
  if (body.typeId === "") body.typeId = null;
  if (body.onBehalfOfContactId === "") delete body.onBehalfOfContactId;
  if (body.submissionKey === "") delete body.submissionKey;
  return portalCreateCaseSchema.parse(body);
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
    // supportEmail: what the Help Center shows customers (the support mailbox, not the firm's general address).
    return res.json({ ...publicIdentity(req.portal!), org: org ? { name: org.name, logoUrl: org.logoUrl, email: org.email, phone: org.phone, website: org.website, supportEmail: org.supportInboundAddress || org.email } : null });
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
    if (requester) {
      // The selected person must be a contact of this client; match their cases by id OR by
      // address (cases recorded before they existed as a contact carry only the email).
      const [who] = await db.select({ id: clientContacts.id, email: clientContacts.email }).from(clientContacts)
        .where(and(eq(clientContacts.id, requester), eq(clientContacts.orgId, p.orgId), eq(clientContacts.clientId, p.client.id), isNull(clientContacts.deletedAt)));
      filters.push(who
        ? or(eq(supportCases.requesterContactId, who.id), who.email ? sql`lower(${supportCases.requesterEmail}) = ${who.email.trim().toLowerCase()}` : sql`false`)!
        : sql`false`);
    }
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
    // "Unread" is per person: customer-VISIBLE activity since THIS contact last opened the case
    // (never opened = unread). Internal notes and firm-only edits bump updated_at but must not
    // flag a customer, so activity = creation, customer-visible messages, status/follower events.
    const unreadSql = sql`(${portalCaseReads.lastReadAt} IS NULL OR ${customerActivitySql} > ${portalCaseReads.lastReadAt})`;
    const readJoin = and(eq(portalCaseReads.caseId, supportCases.id), eq(portalCaseReads.contactId, p.contact.id))!;
    const [rows, [agg], byPrio] = await Promise.all([
      db.select({
          id: supportCases.id, caseKey: supportCases.caseKey, subject: supportCases.subject, status: supportCases.status,
          priority: supportCases.priority, typeName: supportCaseTypes.name, requesterName: supportCases.requesterName,
          requesterContactId: supportCases.requesterContactId, requesterEmail: supportCases.requesterEmail,
          createdAt: supportCases.createdAt, updatedAt: supportCases.updatedAt,
          lastAgentMessageAt: supportCases.lastAgentMessageAt, lastCustomerMessageAt: supportCases.lastCustomerMessageAt,
          resolvedAt: supportCases.resolvedAt, unread: sql<boolean>`${unreadSql}`.mapWith(Boolean),
        })
        .from(supportCases)
        .leftJoin(supportCaseTypes, and(eq(supportCases.typeId, supportCaseTypes.id), eq(supportCaseTypes.orgId, p.orgId)))
        .leftJoin(portalCaseReads, readJoin)
        .where(and(authorised, statusWhere))
        .orderBy(sql`${supportCases.updatedAt} desc`, sql`${supportCases.id} desc`)
        .limit(limit + 1).offset(offset),
      db.select({
          open: sql<number>`count(*) filter (where ${supportCases.status} IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)}))`.mapWith(Number),
          waitingOnYou: sql<number>`count(*) filter (where ${supportCases.status} = 'WAITING_ON_CUSTOMER')`.mapWith(Number),
          resolved: sql<number>`count(*) filter (where ${supportCases.status} NOT IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)}))`.mapWith(Number),
          unread: sql<number>`count(*) filter (where ${unreadSql})`.mapWith(Number),
        }).from(supportCases).leftJoin(portalCaseReads, readJoin).where(authorised),
      db.select({ priority: supportCases.priority, n: sql<number>`count(*)`.mapWith(Number) }).from(supportCases)
        .where(and(authorised, sql`${supportCases.status} IN (${sql.join(openStatuses.map(x => sql`${x}`), sql`, `)})`)).groupBy(supportCases.priority),
    ]);
    const byPriority: Record<string, number> = {};
    for (const r of byPrio) byPriority[r.priority] = r.n;
    const page = rows.slice(0, limit);
    return res.json({
      cases: page.map(({ requesterEmail: _e, ...r }) => ({ ...r, mine: isOwnCase(p, { requesterContactId: r.requesterContactId, requesterEmail: _e }), awaitingYou: r.status === "WAITING_ON_CUSTOMER", hasNewReply: !!r.lastAgentMessageAt && (!r.lastCustomerMessageAt || r.lastAgentMessageAt > r.lastCustomerMessageAt) })),
      counts: { open: agg?.open ?? 0, waitingOnYou: agg?.waitingOnYou ?? 0, resolved: agg?.resolved ?? 0, unread: agg?.unread ?? 0, byPriority },
      paging: { status, limit, offset, hasMore: rows.length > limit },
      scope: p.contact.portalRole === "admin" ? "client" : "own",
    });
  });

  /** Unread cases for the nav badge — cheap enough to poll. */
  app.get("/api/portal/:orgSlug/cases/unread-count", requirePortal, async (req, res) => {
    const p = req.portal!;
    const [row] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(supportCases)
      .leftJoin(portalCaseReads, and(eq(portalCaseReads.caseId, supportCases.id), eq(portalCaseReads.contactId, p.contact.id)))
      .where(and(visibleCaseWhere(req), sql`(${portalCaseReads.lastReadAt} IS NULL OR ${customerActivitySql} > ${portalCaseReads.lastReadAt})`));
    return res.json({ unread: row?.n ?? 0 });
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
      // Create the contact, or — when the same person was invited before and has not used
      // their link yet — re-send to that pending contact (a failed delivery can be retried).
      const target = await withContactEmailLock(p.orgId, norm, async (tx) => {
        const existing = await findPortalContact(p.orgId, norm, tx);
        if (existing) return existing.portalPendingAt && existing.clientId === p.client.id ? { id: existing.id, resend: true } : null;
        const [row] = await tx.insert(clientContacts).values({
          orgId: p.orgId, clientId: p.client.id, firstName, lastName, email: norm,
          portalRole: "member", billingAccess: false, isPrimary: false, source: "help-center-invite", lifecycleStage: "customer", portalPendingAt: new Date(),
        }).returning({ id: clientContacts.id });
        return { id: row.id, resend: false };
      });
      if (!target) return res.status(400).json({ message: "Someone with that email address is already set up" });
      const org = await storage.getOrg(p.orgId);
      const { token, email: boundEmail } = await issueLoginLink(p.orgId, target.id, null);
      const link = loginLinkFor(p.orgSlug, token, "help");
      try {
        await sendPortalLoginEmail({ to: boundEmail, contactName: `${firstName} ${lastName}`.trim(), orgName: p.orgName, link, org: org ?? null, surface: "help", invitedBy: `${p.contact.firstName} ${p.contact.lastName}`.trim() });
      } catch (err) {
        console.error("[help-center] invite email failed", { orgId: p.orgId, contactId: target.id, err: (err as Error)?.message });
        // The contact stays (pending); the admin is told the truth and can send again.
        return res.status(502).json({ message: "We couldn't deliver the invitation email. Try again in a moment — the invitation is saved.", id: target.id });
      }
      await db.insert(clientActivities).values({
        orgId: p.orgId, clientId: p.client.id, userId: null, type: "PORTAL_INVITE_SENT",
        title: `${p.contact.firstName} ${p.contact.lastName} ${target.resend ? "re-invited" : "invited"} ${firstName} ${lastName} to the Help Center`, description: norm, linkUrl: null, metadata: { contactId: target.id },
      });
      return res.status(target.resend ? 200 : 201).json({ id: target.id, resent: target.resend, ...(isTestEnv ? { debugLink: link } : {}) });
    } catch (err: any) {
      return res.status(400).json({ message: friendly(err) });
    }
  });

  /** Colleagues at this contact's company who can be added as watchers (never another client's people). */
  app.get("/api/portal/:orgSlug/colleagues", requirePortal, async (req, res) => {
    const p = req.portal!;
    // The case filter (hide current watchers) only applies to a case this contact may see —
    // otherwise comparing the two lists would reveal who follows a case they cannot open.
    let excludeCaseId = typeof req.query.caseId === "string" ? req.query.caseId : undefined;
    if (excludeCaseId) {
      const [visible] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, excludeCaseId)));
      if (!visible) excludeCaseId = undefined;
    }
    return res.json(await cases.listColleagues(p.orgId, p.client.id, { excludeContactIds: [p.contact.id], excludeCaseId }));
  });

  /** Resolves a watcher email: an existing colleague, or a new address on the client's approved domains (provisioned like self-registration). */
  async function resolveWatcherEmail(p: NonNullable<Request["portal"]>, email: string): Promise<string> {
    const norm = email.trim().toLowerCase();
    const known = await findPortalContact(p.orgId, norm);
    if (known) {
      if (known.clientId !== p.client.id) throw new Error(`${norm} is not part of your company`);
      if (await isPortalBlocked(p.orgId, norm)) throw new Error(`${norm} cannot be added`);
      return known.id;
    }
    const [client] = await db.select({ domains: clients.portalEmailDomains }).from(clients).where(eq(clients.id, p.client.id));
    const domain = emailDomain(norm);
    if (!domain || !client?.domains?.includes(domain)) throw new Error(`${norm} is not on your company's approved email domains`);
    const created = await resolveOrProvisionContact(p.orgId, norm, "help-center-invite");
    if (!created || created.clientId !== p.client.id) throw new Error(`${norm} cannot be added`);
    return created.id;
  }

  // Multipart (fields + up to 10 files) or plain JSON. Order: files parsed in memory → fields
  // validated → replay lookup → colleagues resolved → ONE transaction (case + watchers + events,
  // contacts re-locked and re-validated) → attachments (each its own idempotent write, errors
  // reported, never a lost case) → notifications.
  app.post("/api/portal/:orgSlug/cases", requirePortal, (req, res, next) => {
    if (!req.is("multipart/form-data")) return next();
    portalUpload.array("files", 10)(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err?.code === "LIMIT_FILE_SIZE" ? "Files must be 15 MB or smaller" : (err?.message || "Upload failed") });
      next();
    });
  }, async (req, res) => {
    const p = req.portal!;
    let parsed: ReturnType<typeof parseCreateBody>;
    try { parsed = parseCreateBody(req); } catch (err: any) { return res.status(400).json({ message: friendly(err) }); }
    const files = ((req as any).files as Express.Multer.File[] | undefined) ?? [];
    let fileIds: string[] = [];
    try { fileIds = parseClientFileIds((req.body as any)?.clientFileIds, files.length) ?? []; } catch (err: any) { return res.status(400).json({ message: friendly(err) }); }
    const attachmentErrors: Array<{ filename: string; clientFileId: string | null; error: string }> = [];
    const attachmentsOf = async (caseId: string) => (await listAttachments(p.orgId, caseId)).map(a => attachmentView(a, `/api/portal/${p.orgSlug}/attachments`));
    const storeFiles = async (caseId: string) => {
      const out = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          out.push(await createAttachment({ orgId: p.orgId, caseId, filename: f.originalname, mimeType: f.mimetype, bytes: f.buffer, uploadedByContactId: p.contact.id, source: "PORTAL", clientFileId: fileIds[i] ?? null, authorize: (tx) => cases.customerCanAccessCase(tx, p.orgId, caseId, p.contact.id, { lock: true, write: true }) }));
        } catch (err: any) {
          attachmentErrors.push({ filename: f.originalname, clientFileId: fileIds[i] ?? null, error: friendly(err) });
        }
      }
      return out;
    };
    try {
      // Replay: the same authenticated contact already submitted this key → return that case (after the
      // normal visibility check) and let the client finish its uploads. Never a second case.
      // One path for every replay (initial lookup AND the unique-conflict race): visibility first,
      // restricted response without it, uploads (each authorised under the case lock) with it.
      const replayResponse = async (prior: { id: string; caseKey: string; subject: string; status: string }) => {
        const [visible] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, prior.id)));
        if (!visible) return res.status(404).json({ message: "Support case not found" }); // masked like every other inaccessible case
        await storeFiles(prior.id);
        return res.status(200).json({ id: prior.id, caseKey: prior.caseKey, subject: prior.subject, status: prior.status, replay: true, attachments: await attachmentsOf(prior.id), attachmentErrors });
      };
      if (parsed.submissionKey) {
        const prior = await cases.findSubmission(p.orgId, p.contact.id, parsed.submissionKey);
        if (prior) return replayResponse(prior);
      }
      const watcherIds = new Set(parsed.watcherContactIds ?? []);
      for (const e of parsed.watcherEmails ?? []) watcherIds.add(await resolveWatcherEmail(p, e));
      const reviewerIds = new Set(parsed.reviewerContactIds ?? []);
      for (const e of parsed.reviewerEmails ?? []) reviewerIds.add(await resolveWatcherEmail(p, e));
      let requesterId = p.contact.id;
      if (parsed.onBehalfOfContactId && parsed.onBehalfOfContactId !== p.contact.id) {
        if (p.contact.portalRole !== "admin") return res.status(403).json({ message: "Only a Customer Admin can open a case for a colleague" });
        requesterId = parsed.onBehalfOfContactId;
      }
      watcherIds.delete(requesterId); reviewerIds.delete(requesterId);
      const [requester] = await db.select().from(clientContacts).where(and(eq(clientContacts.id, requesterId), eq(clientContacts.orgId, p.orgId), eq(clientContacts.clientId, p.client.id), isNull(clientContacts.deletedAt)));
      if (!requester) return res.status(400).json({ message: "That colleague is not part of your company" });
      let row;
      try {
        row = await cases.createCase(p.orgId, {
          clientId: p.client.id,
          typeId: parsed.typeId ?? null,
          subject: parsed.subject,
          description: parsed.description || null,
          priority: parsed.priority,
          intake: parsed.intake && Object.values(parsed.intake).some(v => v !== undefined && v !== "") ? parsed.intake : null,
          requesterContactId: requester.id,
          requesterName: `${requester.firstName} ${requester.lastName}`.trim(),
          requesterEmail: requester.email || null,
          openedByName: `${p.contact.firstName} ${p.contact.lastName}`.trim(),
          source: "PORTAL",
          portal: { submitterContactId: p.contact.id, submissionKey: parsed.submissionKey ?? null, watcherContactIds: [...watcherIds], reviewerContactIds: [...reviewerIds] },
          deferNotify: true,
        }, null);
      } catch (err: any) {
        if (!(err instanceof cases.CaseReplay)) throw err;
        const winner = await err.resolve();
        if (!winner) throw new Error("Could not open the case; please try again", { cause: err });
        return replayResponse(winner);
      }
      // Files first, then the "case opened" mails — recipients open a case whose screenshots are already there.
      await storeFiles(row.id);
      cases.notifyCreated(row, requester.id !== p.contact.id ? { name: `${p.contact.firstName} ${p.contact.lastName}`.trim(), contactId: p.contact.id } : undefined);
      return res.status(201).json({ id: row.id, caseKey: row.caseKey, subject: row.subject, status: row.status, attachments: await attachmentsOf(row.id), attachmentErrors });
    } catch (err: any) {
      if (err instanceof cases.CaseAccessError) return res.status(403).json({ message: err.message });
      return res.status(400).json({ message: friendly(err) });
    }
  });

  // ── Watchers: colleagues following a case ──
  app.get("/api/portal/:orgSlug/cases/:id/watchers", requirePortal, async (req, res) => {
    const p = req.portal!;
    const [row] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
    if (!row) return res.status(404).json({ message: "Support case not found" });
    return res.json(await cases.listWatchers(p.orgId, row.id));
  });
  app.post("/api/portal/:orgSlug/cases/:id/watchers", requirePortal, async (req, res) => {
    try {
      const p = req.portal!;
      const body = portalWatcherAddSchema.parse(req.body);
      const [row] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
      if (!row) return res.status(404).json({ message: "Support case not found" });
      const contactId = body.contactId ?? await resolveWatcherEmail(p, body.email!);
      const r = await cases.addWatcher(p.orgId, row.id, contactId, { contactId: p.contact.id, name: `${p.contact.firstName} ${p.contact.lastName}`.trim() }, authorizeContact(req), body.role ?? "watcher", authorizeContactManage(req));
      return res.status(r.changed ? 201 : 200).json(r.watchers);
    } catch (err: any) {
      if (err instanceof cases.CaseAccessError) return res.status(404).json({ message: "Support case not found" });
      return res.status(400).json({ message: friendly(err) });
    }
  });
  app.delete("/api/portal/:orgSlug/cases/:id/watchers/:contactId", requirePortal, async (req, res) => {
    try {
      const p = req.portal!;
      const [row] = await db.select({ id: supportCases.id }).from(supportCases).where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
      if (!row) return res.status(404).json({ message: "Support case not found" });
      const target = String(req.params.contactId);
      // A watcher may remove THEMSELVES; removing others is for the requester / Customer Admin.
      const auth = target === p.contact.id ? authorizeContactAccess(req) : authorizeContactManage(req);
      const r = await cases.removeWatcher(p.orgId, row.id, target, { contactId: p.contact.id, name: `${p.contact.firstName} ${p.contact.lastName}`.trim() }, auth);
      return res.json(r.watchers);
    } catch (err: any) {
      if (err instanceof cases.CaseAccessError) return res.status(404).json({ message: "Support case not found" });
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
        assigneeUserId: supportCases.assigneeUserId, intake: supportCases.intake, requesterContactId: supportCases.requesterContactId, requesterEmail: supportCases.requesterEmail,
      })
      .from(supportCases)
      .leftJoin(supportCaseTypes, and(eq(supportCases.typeId, supportCaseTypes.id), eq(supportCaseTypes.orgId, p.orgId)))
      .where(and(visibleCaseWhere(req), eq(supportCases.id, String(req.params.id))));
    if (!row) return res.status(404).json({ message: "Support case not found" });
    // Read watermark taken BEFORE the snapshot is loaded: a reply landing while these queries run is
    // not in the response, so it must stay unread.
    const readAt = new Date();
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
    const [attachments, watchers, access] = await Promise.all([listAttachments(p.orgId, row.id), cases.listWatchers(p.orgId, row.id), cases.customerCanAccess(db, p.orgId, { id: row.id, clientId: p.client.id, requesterContactId: row.requesterContactId, requesterEmail: row.requesterEmail }, p.contact.id)]);
    // Opening the case is reading it: clear this person's "New" badge.
    await db.insert(portalCaseReads).values({ orgId: p.orgId, caseId: row.id, contactId: p.contact.id, lastReadAt: readAt })
      .onConflictDoUpdate({ target: [portalCaseReads.caseId, portalCaseReads.contactId], set: { lastReadAt: readAt } }).catch(() => {});
    const { assigneeUserId: _a, requesterContactId, requesterEmail, ...safe } = row;
    return res.json({
      ...safe,
      assigneeName,
      isRequester: isOwnCase(p, { requesterContactId, requesterEmail }),
      myRole: access.role,
      watchers,
      attachments: attachments.map(a => attachmentView(a, `/api/portal/${p.orgSlug}/attachments`)),
      messages: messages.map(m => ({ id: m.id, authorName: m.authorName, fromTeam: !!m.authorUserId, body: m.body, createdAt: m.createdAt })),
      events: events.filter(e => e.kind === "status" || e.kind === "created" || e.kind === "watcher").map(e => ({ id: e.id, kind: e.kind, fromValue: e.fromValue, toValue: e.toValue, createdAt: e.createdAt })),
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
        author: { contactId: p.contact.id, email: p.contact.email, name: `${p.contact.firstName} ${p.contact.lastName}`.trim() },
        authorize: authorizeContact(req),
      });
      if (!result) return res.status(404).json({ message: "Support case not found" });
      return res.status(201).json({ id: result.message.id, status: result.case.status });
    } catch (err: any) {
      if (err instanceof cases.CaseAccessError) return res.status(404).json({ message: "Support case not found" });
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
      const ids = parseClientFileIds((req.body as any)?.clientFileIds, files.length) ?? [];
      const created = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        created.push(await createAttachment({ orgId: p.orgId, caseId: row.id, filename: f.originalname, mimeType: f.mimetype, bytes: f.buffer, uploadedByContactId: p.contact.id, source: "PORTAL", clientFileId: ids[i] ?? null, authorize: (tx) => cases.customerCanAccessCase(tx, p.orgId, row.id, p.contact.id, { lock: true, write: true }) }));
      }
      return res.status(201).json(created.map(a => attachmentView(a, `/api/portal/${p.orgSlug}/attachments`)));
    } catch (err: any) {
      if (err instanceof AttachmentForbiddenError || err instanceof cases.CaseAccessError) return res.status(404).json({ message: "Support case not found" });
      if (err instanceof AttachmentConflictError) return res.status(409).json({ message: err.message });
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

