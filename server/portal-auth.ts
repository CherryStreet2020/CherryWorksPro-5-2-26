/**
 * Customer portal identity.
 *
 * A contact signs in with a one-time link emailed to their address. The link
 * carries a random token; only its SHA-256 lands in the database. Consuming a
 * link creates a 30-day session whose token is likewise stored hashed and
 * handed to the browser as an HttpOnly cookie. Nothing here trusts anything
 * in a request body beyond the token itself.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { clientContacts, clients, orgs, portalLoginLinks, portalSessions, psoContactActivities, portalBlockedEmails, supportCases, supportCaseMessages } from "@shared/schema";
import { emailDomain, isSharedMailDomain } from "@shared/mail-domains";

export const PORTAL_COOKIE = "cwp_portal";
const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface PortalIdentity {
  sessionId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  orgLogoUrl: string | null;
  contact: {
    id: string; firstName: string; lastName: string; email: string; isPrimary: boolean;
    /** "member" sees the cases they raised; "admin" (Customer Admin) sees the whole client. */
    portalRole: PortalRole;
    /** May enter the Customer Portal (invoices / estimates / payments). */
    billingAccess: boolean;
    /** Self-registered through the Help Center and has not told us their name yet. */
    needsName: boolean;
  };
  client: { id: string; name: string; portalShowHours: boolean };
}
export type PortalRole = "member" | "admin";
export type PortalSurface = "help" | "portal";

declare module "express-serve-static-core" {
  interface Request {
    portal?: PortalIdentity;
  }
}

/** Contacts who can sign in: in this org, attached to a client, not deleted, with this email. */
export type PortalContactRow = { id: string; firstName: string; lastName: string; email: string | null; isPrimary: boolean; clientId: string | null; portalRole: string; billingAccess: boolean; portalPendingAt: Date | null };
export async function findPortalContact(orgId: string, email: string, conn: DbOrTx = db): Promise<PortalContactRow | undefined> {
  const norm = email.trim().toLowerCase();
  if (!norm) return undefined;
  const rows = await conn
    .select({
      id: clientContacts.id, firstName: clientContacts.firstName, lastName: clientContacts.lastName,
      email: clientContacts.email, isPrimary: clientContacts.isPrimary, clientId: clientContacts.clientId,
      portalRole: clientContacts.portalRole, billingAccess: clientContacts.billingAccess, portalPendingAt: clientContacts.portalPendingAt,
    })
    .from(clientContacts)
    .innerJoin(clients, eq(clientContacts.clientId, clients.id))
    .where(and(
      eq(clientContacts.orgId, orgId),
      isNull(clientContacts.deletedAt),
      sql`lower(${clientContacts.email}) = ${norm}`,
    ))
    .limit(2);
  // Two contacts sharing an address is ambiguous; the primary wins, else the first.
  return rows.find(r => r.isPrimary) ?? rows[0];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/**
 * Serialises every writer that may create a contact for (org, email): concurrent
 * sign-in requests, a Customer Admin's invite and a firm user's "Add contact" all take
 * this transaction-scoped advisory lock before they look, so exactly one of them inserts.
 */
export async function withContactEmailLock<T>(orgId: string, email: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const key = `${orgId}:${email.trim().toLowerCase()}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    return fn(tx);
  });
}

// Self-registration cap: at most this many new contacts per client per hour. Blunts
// directory-stuffing from a leaked or over-broad approved domain.
const PROVISION_CAP_PER_HOUR = 20;
const provisionCounts = new Map<string, { windowStart: number; n: number }>();
function underProvisionCap(clientId: string): boolean {
  const now = Date.now();
  const cur = provisionCounts.get(clientId);
  if (!cur || now - cur.windowStart > 60 * 60 * 1000) { provisionCounts.set(clientId, { windowStart: now, n: 1 }); return true; }
  if (cur.n >= PROVISION_CAP_PER_HOUR) return false;
  cur.n += 1;
  return true;
}
/** Test hook. */
export function _resetProvisionCounts() { provisionCounts.clear(); }

export type ProvisionSource = "help-center" | "help-center-invite";

/**
 * The Help Center sign-in resolver. A known contact wins. Otherwise, when the address
 * belongs to a business domain one of the org's clients has approved, a member contact
 * is created for that client. Ownership of the address is proved later by the magic
 * link — this only decides who the link would be for. Never called for inbound mail.
 * Returns undefined when nobody may sign in with this address.
 */
export async function isPortalBlocked(orgId: string, email: string, conn: DbOrTx = db): Promise<boolean> {
  const norm = email.trim().toLowerCase();
  if (!norm) return false;
  const [row] = await conn.select({ id: portalBlockedEmails.id }).from(portalBlockedEmails)
    .where(and(eq(portalBlockedEmails.orgId, orgId), sql`lower(${portalBlockedEmails.email}) = ${norm}`)).limit(1);
  return !!row;
}

/**
 * Records a firm's decision that this address may not use the Help Center, and in the
 * same transaction revokes every live session and voids every outstanding sign-in link
 * of the contact (when one is given). The contact row is locked first — the same order
 * consumeLoginLink uses — so a link being exchanged at that moment either finishes
 * before the block (and its session dies here) or sees the block and fails.
 */
export async function blockPortalEmail(input: { orgId: string; clientId: string | null; contactId?: string | null; email: string; reason: string; byUserId: string | null }) {
  let norm = input.email.trim().toLowerCase();
  if (!norm && !input.contactId) return;
  await db.transaction(async (tx) => {
    if (input.contactId) {
      // The address is re-read under the contact's row lock: what gets blocked is the
      // address the contact has NOW, not one the caller looked up earlier.
      const [c] = await tx.select({ email: clientContacts.email }).from(clientContacts).where(eq(clientContacts.id, input.contactId)).for("update");
      if (c?.email) norm = c.email.trim().toLowerCase();
      await tx.update(portalSessions).set({ revokedAt: new Date() })
        .where(and(eq(portalSessions.orgId, input.orgId), eq(portalSessions.contactId, input.contactId), isNull(portalSessions.revokedAt)));
      await tx.update(portalLoginLinks).set({ consumedAt: new Date() })
        .where(and(eq(portalLoginLinks.orgId, input.orgId), eq(portalLoginLinks.contactId, input.contactId), isNull(portalLoginLinks.consumedAt)));
    }
    if (!norm) return;
    await tx.insert(portalBlockedEmails).values({ orgId: input.orgId, clientId: input.clientId, email: norm, reason: input.reason, blockedByUserId: input.byUserId })
      .onConflictDoNothing();
  });
}

export async function resolveOrProvisionContact(orgId: string, email: string, source: ProvisionSource = "help-center") {
  const norm = email.trim().toLowerCase();
  if (!norm) return undefined;
  if (await isPortalBlocked(orgId, norm)) return undefined;
  const known = await findPortalContact(orgId, norm);
  if (known) return known;
  const domain = emailDomain(norm);
  if (!domain || isSharedMailDomain(domain)) return undefined;
  return withContactEmailLock(orgId, norm, async (tx) => {
    // Re-read under the lock (ON THIS CONNECTION — nested reads on the pool would hold a
    // second connection per request and can exhaust the pool under load): a racing
    // request may have inserted — or a racing deletion may have blocked — this address.
    if (await isPortalBlocked(orgId, norm, tx)) return undefined;
    const again = await findPortalContact(orgId, norm, tx);
    if (again) return again;
    const [client] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.orgId, orgId), sql`${domain} = ANY(${clients.portalEmailDomains})`))
      .limit(1);
    if (!client) return undefined;
    if (!underProvisionCap(client.id)) {
      console.warn("[help-center] self-registration cap reached", { orgId, clientId: client.id, domain });
      return undefined;
    }
    const localPart = norm.slice(0, norm.indexOf("@"));
    const [inserted] = await tx.insert(clientContacts).values({
      orgId, clientId: client.id,
      firstName: localPart, lastName: "",
      email: norm, portalRole: "member", billingAccess: false, isPrimary: false,
      source, lifecycleStage: "customer", portalPendingAt: new Date(),
    }).returning({ id: clientContacts.id, firstName: clientContacts.firstName, lastName: clientContacts.lastName, email: clientContacts.email, isPrimary: clientContacts.isPrimary, clientId: clientContacts.clientId, portalRole: clientContacts.portalRole, billingAccess: clientContacts.billingAccess, portalPendingAt: clientContacts.portalPendingAt });
    await tx.insert(psoContactActivities).values({ orgId, clientContactId: inserted.id, companyId: null, type: "contact_created", payload: { source }, actorId: null });
    return inserted;
  });
}

/** Creates a login link for the contact and returns the raw token (never stored). */
export async function issueLoginLink(orgId: string, contactId: string, requestedIp: string | null): Promise<{ token: string; expiresAt: Date; email: string }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  // Under the contact lock (same order as email changes and consumption): re-read the
  // CURRENT address, bind the link to it and hand it back — every caller mails the
  // address returned here, never one it looked up earlier, so a request that read the
  // contact just before an email change cannot deliver a valid link to the old mailbox.
  const bound = await db.transaction(async (tx) => {
    const [c] = await tx.select({ email: clientContacts.email, deleted: clientContacts.deletedAt }).from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.orgId, orgId))).for("update");
    if (!c || c.deleted || !c.email) return null;
    const email = c.email.trim().toLowerCase();
    await tx.insert(portalLoginLinks).values({ orgId, contactId, tokenHash: hashToken(token), expiresAt, requestedIp, email });
    return email;
  });
  if (!bound) throw new Error("Contact not found");
  return { token, expiresAt, email: bound };
}

/** Consumes a link (single use, unexpired) and opens a session. Returns the raw session token. */
export async function consumeLoginLink(orgSlug: string, token: string, userAgent: string | null): Promise<{ sessionToken: string; identity: PortalIdentity } | undefined> {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, orgSlug));
  if (!org) return undefined;
  const hash = hashToken(token);
  const [link] = await db
    .select()
    .from(portalLoginLinks)
    .where(and(eq(portalLoginLinks.tokenHash, hash), eq(portalLoginLinks.orgId, org.id), isNull(portalLoginLinks.consumedAt), gt(portalLoginLinks.expiresAt, new Date())));
  if (!link) return undefined;
  // Constant-time compare on the stored hash guards against a lucky index hit on a prefix.
  if (!timingSafeEqual(Buffer.from(link.tokenHash), Buffer.from(hash))) return undefined;

  const sessionToken = newToken();
  const session = await db.transaction(async (tx) => {
    // Lock the contact FIRST (same order as the pending sweep and revocation), then
    // consume the link and open the session in the same transaction: a sweep cannot
    // delete the contact between the two, a revocation cannot be raced by a link that
    // was already in flight, and a rollback leaves the link unconsumed.
    const [c] = await tx.select({ id: clientContacts.id, email: clientContacts.email, deleted: clientContacts.deletedAt }).from(clientContacts).where(eq(clientContacts.id, link.contactId)).for("update");
    if (!c || c.deleted) return undefined;
    // The link is only good for the mailbox it was sent to.
    if (link.email && (c.email || "").toLowerCase() !== link.email.toLowerCase()) return undefined;
    if (c.email) {
      const [blocked] = await tx.select({ id: portalBlockedEmails.id }).from(portalBlockedEmails)
        .where(and(eq(portalBlockedEmails.orgId, org.id), sql`lower(${portalBlockedEmails.email}) = ${c.email.toLowerCase()}`)).limit(1);
      if (blocked) return undefined;
    }
    const [consumed] = await tx
      .update(portalLoginLinks)
      .set({ consumedAt: new Date() })
      .where(and(eq(portalLoginLinks.id, link.id), isNull(portalLoginLinks.consumedAt)))
      .returning({ id: portalLoginLinks.id });
    if (!consumed) return undefined; // raced
    // Using the link proves the mailbox: a self-registered placeholder becomes a real contact.
    await tx.update(clientContacts).set({ portalPendingAt: null, updatedAt: new Date() })
      .where(and(eq(clientContacts.id, link.contactId), sql`${clientContacts.portalPendingAt} IS NOT NULL`));
    const [row] = await tx.insert(portalSessions).values({
      orgId: org.id, contactId: link.contactId, tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS), userAgent,
    }).returning();
    return row;
  });
  if (!session) return undefined;
  const identity = await loadIdentity(session.id);
  if (!identity) return undefined;
  return { sessionToken, identity };
}

async function loadIdentity(sessionId: string): Promise<PortalIdentity | undefined> {
  const [row] = await db
    .select({
      sessionId: portalSessions.id,
      orgId: orgs.id, orgSlug: orgs.slug, orgName: orgs.name, orgLogoUrl: orgs.logoUrl,
      contactId: clientContacts.id, firstName: clientContacts.firstName, lastName: clientContacts.lastName,
      email: clientContacts.email, isPrimary: clientContacts.isPrimary, contactDeleted: clientContacts.deletedAt,
      portalRole: clientContacts.portalRole, billingAccess: clientContacts.billingAccess,
      clientId: clients.id, clientName: clients.name, portalShowHours: clients.portalShowHours,
    })
    .from(portalSessions)
    .innerJoin(orgs, eq(portalSessions.orgId, orgs.id))
    .innerJoin(clientContacts, eq(portalSessions.contactId, clientContacts.id))
    .innerJoin(clients, eq(clientContacts.clientId, clients.id))
    .where(eq(portalSessions.id, sessionId));
  if (!row || row.contactDeleted) return undefined;
  return {
    sessionId: row.sessionId,
    orgId: row.orgId, orgSlug: row.orgSlug, orgName: row.orgName, orgLogoUrl: row.orgLogoUrl,
    contact: {
      id: row.contactId, firstName: row.firstName, lastName: row.lastName, email: row.email ?? "", isPrimary: row.isPrimary,
      portalRole: row.portalRole === "admin" ? "admin" : "member",
      billingAccess: row.billingAccess,
      needsName: row.lastName.trim() === "",
    },
    client: { id: row.clientId, name: row.clientName, portalShowHours: row.portalShowHours },
  };
}

export async function resolveSession(orgSlug: string, sessionToken: string): Promise<PortalIdentity | undefined> {
  const [row] = await db
    .select({ id: portalSessions.id, lastSeenAt: portalSessions.lastSeenAt })
    .from(portalSessions)
    .innerJoin(orgs, eq(portalSessions.orgId, orgs.id))
    .innerJoin(clientContacts, eq(portalSessions.contactId, clientContacts.id))
    .where(and(
      eq(portalSessions.tokenHash, hashToken(sessionToken)),
      eq(orgs.slug, orgSlug),
      isNull(portalSessions.revokedAt),
      gt(portalSessions.expiresAt, new Date()),
      // A blocked address is out even if a session somehow survived the revocation.
      sql`NOT EXISTS (SELECT 1 FROM ${portalBlockedEmails} WHERE ${portalBlockedEmails.orgId} = ${portalSessions.orgId} AND lower(${portalBlockedEmails.email}) = lower(${clientContacts.email}))`,
    ));
  if (!row) return undefined;
  if (Date.now() - new Date(row.lastSeenAt).getTime() > TOUCH_INTERVAL_MS) {
    await db.update(portalSessions).set({ lastSeenAt: new Date() }).where(eq(portalSessions.id, row.id));
  }
  return loadIdentity(row.id);
}

export async function revokeSession(sessionId: string) {
  await db.update(portalSessions).set({ revokedAt: new Date() }).where(eq(portalSessions.id, sessionId));
}

export async function revokeAllForContact(orgId: string, contactId: string) {
  await db.update(portalSessions).set({ revokedAt: new Date() })
    .where(and(eq(portalSessions.orgId, orgId), eq(portalSessions.contactId, contactId), isNull(portalSessions.revokedAt)));
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(res: Response, token: string) {
  const secure = process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", `${PORTAL_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`);
}

export function clearSessionCookie(res: Response) {
  const secure = process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", `${PORTAL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
}

/** Express middleware: requires a valid portal session for the org in the URL. */
export async function requirePortal(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = String(req.params.orgSlug || "");
    const token = readCookie(req, PORTAL_COOKIE);
    if (!slug || !token) return res.status(401).json({ message: "Please sign in to the portal" });
    const identity = await resolveSession(slug, token);
    if (!identity) return res.status(401).json({ message: "Your portal session has expired. Request a new sign-in link." });
    req.portal = identity;
    next();
  } catch (err) {
    console.error("[portal-auth] session check failed", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Firm-side deletion of a client contact. One transaction, under the same per-address
 * lock provisioning uses: sessions revoked, outstanding links voided, the row deleted,
 * and — when the address could self-register again through an approved domain — the
 * block written. A crash leaves either everything or nothing.
 */
export async function deleteContactWithPortalCleanup(input: { orgId: string; contactId: string; byUserId: string | null }): Promise<boolean> {
  const [c] = await db.select({ id: clientContacts.id, clientId: clientContacts.clientId, email: clientContacts.email }).from(clientContacts)
    .where(and(eq(clientContacts.id, input.contactId), eq(clientContacts.orgId, input.orgId)));
  if (!c) return false;
  const email = (c.email || "").trim().toLowerCase();
  const run = async (tx: Tx): Promise<boolean | "retry"> => {
    // Row lock, then re-read: the address we took the advisory lock on must still be
    // the contact's address, otherwise an email change slipped in — start over.
    const [locked] = await tx.select({ email: clientContacts.email, clientId: clientContacts.clientId }).from(clientContacts)
      .where(and(eq(clientContacts.id, c.id), eq(clientContacts.orgId, input.orgId))).for("update");
    if (!locked) return false;
    const current = (locked.email || "").trim().toLowerCase();
    if (current !== email) return "retry";
    await tx.update(portalSessions).set({ revokedAt: new Date() })
      .where(and(eq(portalSessions.contactId, c.id), isNull(portalSessions.revokedAt)));
    await tx.update(portalLoginLinks).set({ consumedAt: new Date() })
      .where(and(eq(portalLoginLinks.contactId, c.id), isNull(portalLoginLinks.consumedAt)));
    if (current && locked.clientId) {
      const [client] = await tx.select({ domains: clients.portalEmailDomains }).from(clients).where(eq(clients.id, locked.clientId));
      const d = emailDomain(current);
      if (d && client?.domains?.includes(d)) {
        await tx.insert(portalBlockedEmails).values({ orgId: input.orgId, clientId: locked.clientId, email: current, reason: "deleted", blockedByUserId: input.byUserId }).onConflictDoNothing();
      }
    }
    const gone = await tx.delete(clientContacts).where(and(eq(clientContacts.id, c.id), eq(clientContacts.orgId, input.orgId))).returning({ id: clientContacts.id });
    return gone.length > 0;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = email ? await withContactEmailLock(input.orgId, email, run) : await db.transaction(run);
    if (r !== "retry") return r;
    return deleteContactWithPortalCleanup(input); // address changed underneath us: re-resolve and try again
  }
  return false;
}

/**
 * Firm-side email change: credentials issued to the old mailbox must not authenticate
 * the contact at the new one. Voids outstanding links and revokes sessions in the same
 * transaction as the update, under the per-address lock of the NEW address so it cannot
 * race provisioning of that address.
 */
export async function changeContactEmail(input: { orgId: string; contactId: string; newEmail: string | null; patch: Record<string, unknown> }) {
  const norm = (input.newEmail || "").trim().toLowerCase() || null;
  const run = async (tx: Tx) => {
    const [cur] = await tx.select({ email: clientContacts.email }).from(clientContacts)
      .where(and(eq(clientContacts.id, input.contactId), eq(clientContacts.orgId, input.orgId))).for("update");
    if (!cur) return undefined;
    const current = (cur.email || "").trim().toLowerCase() || null;
    if (current !== norm) {
      // The address really changes: credentials issued to the old mailbox die with it.
      await tx.update(portalSessions).set({ revokedAt: new Date() })
        .where(and(eq(portalSessions.contactId, input.contactId), isNull(portalSessions.revokedAt)));
      await tx.update(portalLoginLinks).set({ consumedAt: new Date() })
        .where(and(eq(portalLoginLinks.contactId, input.contactId), isNull(portalLoginLinks.consumedAt)));
    }
    const [row] = await tx.update(clientContacts).set({ ...(input.patch as any), email: norm, updatedAt: new Date() })
      .where(and(eq(clientContacts.id, input.contactId), eq(clientContacts.orgId, input.orgId))).returning();
    return row;
  };
  return norm ? withContactEmailLock(input.orgId, norm, run) : db.transaction(run);
}

/** Placeholders whose link was never used are removed after this long. */
export const PENDING_CONTACT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Sweeps self-registered contacts that never used their sign-in link. Returns how many were removed. */
export async function sweepPendingPortalContacts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_CONTACT_TTL_MS);
  // Only rows nobody has touched: still pending, never edited by a firm user (updated_at
  // == created_at — every firm PATCH bumps it and clears pending anyway), not the
  // requester of any case and not the author of any message. Anything adopted stays.
  const eligible = and(
    sql`${clientContacts.portalPendingAt} IS NOT NULL`,
    sql`${clientContacts.portalPendingAt} < ${cutoff}`,
    isNull(clientContacts.deletedAt),
    sql`${clientContacts.updatedAt} = ${clientContacts.createdAt}`,
    sql`NOT EXISTS (SELECT 1 FROM ${supportCases} WHERE ${supportCases.requesterContactId} = ${clientContacts.id})`,
    sql`NOT EXISTS (SELECT 1 FROM ${supportCaseMessages} WHERE ${supportCaseMessages.authorContactId} = ${clientContacts.id})`,
    // Someone who just asked for a link keeps their placeholder until it expires.
    sql`NOT EXISTS (SELECT 1 FROM ${portalLoginLinks} WHERE ${portalLoginLinks.contactId} = ${clientContacts.id} AND ${portalLoginLinks.consumedAt} IS NULL AND ${portalLoginLinks.expiresAt} > now())`,
  )!;
  // Two statements on purpose (READ COMMITTED): first LOCK the candidates (skipping rows
  // someone else holds — a link being issued or consumed), then DELETE with the
  // eligibility re-evaluated in a statement whose snapshot is taken AFTER the locks, so a
  // link issued while we waited is seen and its contact kept.
  return db.transaction(async (tx) => {
    const locked = await tx.select({ id: clientContacts.id }).from(clientContacts).where(eligible).for("update", { skipLocked: true });
    if (locked.length === 0) return 0;
    const ids = locked.map(r => r.id);
    const gone = await tx.delete(clientContacts)
      .where(and(sql`${clientContacts.id} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`, eligible))
      .returning({ id: clientContacts.id });
    return gone.length;
  });
}

/** After requirePortal: the Customer Portal (money) is for contacts with billing access only. */
export function requireBilling(req: Request, res: Response, next: NextFunction) {
  if (!req.portal?.contact.billingAccess) {
    return res.status(403).json({ code: "NO_BILLING_ACCESS", message: "Billing isn't enabled for your account. Ask your account contact, or use the Help Center for support." });
  }
  next();
}

/** After requirePortal: Customer Admin only. */
export function requireCustomerAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.portal?.contact.portalRole !== "admin") {
    return res.status(403).json({ code: "NOT_CUSTOMER_ADMIN", message: "Only a customer admin can do that." });
  }
  next();
}

export function portalBaseUrl(): string {
  const candidate = (process.env.APP_BASE_URL || process.env.BASE_URL || "").trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(candidate)) return candidate;
  const port = process.env.PORT || "5000";
  return `http://localhost:${port}`;
}
