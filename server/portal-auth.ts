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
import { clientContacts, clients, orgs, portalLoginLinks, portalSessions } from "@shared/schema";

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
  contact: { id: string; firstName: string; lastName: string; email: string; isPrimary: boolean };
  client: { id: string; name: string; portalShowHours: boolean };
}

declare module "express-serve-static-core" {
  interface Request {
    portal?: PortalIdentity;
  }
}

/** Contacts who can sign in: in this org, attached to a client, not deleted, with this email. */
export async function findPortalContact(orgId: string, email: string) {
  const norm = email.trim().toLowerCase();
  if (!norm) return undefined;
  const rows = await db
    .select({
      id: clientContacts.id, firstName: clientContacts.firstName, lastName: clientContacts.lastName,
      email: clientContacts.email, isPrimary: clientContacts.isPrimary, clientId: clientContacts.clientId,
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

/** Creates a login link for the contact and returns the raw token (never stored). */
export async function issueLoginLink(orgId: string, contactId: string, requestedIp: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await db.insert(portalLoginLinks).values({ orgId, contactId, tokenHash: hashToken(token), expiresAt, requestedIp });
  return { token, expiresAt };
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

  const [consumed] = await db
    .update(portalLoginLinks)
    .set({ consumedAt: new Date() })
    .where(and(eq(portalLoginLinks.id, link.id), isNull(portalLoginLinks.consumedAt)))
    .returning({ id: portalLoginLinks.id });
  if (!consumed) return undefined; // raced

  const sessionToken = newToken();
  const [session] = await db.insert(portalSessions).values({
    orgId: org.id, contactId: link.contactId, tokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS), userAgent,
  }).returning();
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
    contact: { id: row.contactId, firstName: row.firstName, lastName: row.lastName, email: row.email ?? "", isPrimary: row.isPrimary },
    client: { id: row.clientId, name: row.clientName, portalShowHours: row.portalShowHours },
  };
}

export async function resolveSession(orgSlug: string, sessionToken: string): Promise<PortalIdentity | undefined> {
  const [row] = await db
    .select({ id: portalSessions.id, lastSeenAt: portalSessions.lastSeenAt })
    .from(portalSessions)
    .innerJoin(orgs, eq(portalSessions.orgId, orgs.id))
    .where(and(
      eq(portalSessions.tokenHash, hashToken(sessionToken)),
      eq(orgs.slug, orgSlug),
      isNull(portalSessions.revokedAt),
      gt(portalSessions.expiresAt, new Date()),
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

export function portalBaseUrl(): string {
  const candidate = (process.env.APP_BASE_URL || process.env.BASE_URL || "").trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(candidate)) return candidate;
  const port = process.env.PORT || "5000";
  return `http://localhost:${port}`;
}
