/**
 * Marketing unsubscribe: the footer every campaign / sequence email carries,
 * the List-Unsubscribe headers (RFC 2369 + RFC 8058 one-click), and the
 * token lookup behind the public /unsubscribe/:token page.
 *
 * The token is marketing_prospects.unsubscribe_token (a random UUID set at
 * insert), so the link identifies one prospect without exposing its id or
 * email address.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { marketingProspects, orgs } from "@shared/schema";
import { storage } from "../storage";

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/** Absolute origin for links that must resolve from the recipient's mail client. */
function publicBaseUrl(): string {
  const base = (process.env.APP_BASE_URL || process.env.BASE_URL || "").trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(base) ? base : "https://cherryworkspro.com";
}

export function unsubscribePageUrl(token: string): string {
  return `${publicBaseUrl()}/unsubscribe/${encodeURIComponent(token)}`;
}

export function unsubscribeOneClickUrl(token: string): string {
  return `${publicBaseUrl()}/api/public/unsubscribe/${encodeURIComponent(token)}`;
}

/**
 * Headers Gmail / Yahoo / Outlook use to show their own "Unsubscribe" button.
 * Graph sendMail only accepts X- custom headers, so the Graph transport drops
 * these; the footer link covers that path.
 */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeOneClickUrl(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface FooterOrg {
  name?: string | null;
  address?: string | null;
  addressStreet?: string | null;
  addressSuite?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  addressCountry?: string | null;
}

/** The sender's postal address (CAN-SPAM), from the structured fields or the legacy free-text one. */
export function orgPostalAddress(org: FooterOrg | null | undefined): string | null {
  if (!org) return null;
  const cityLine = [org.addressCity, [org.addressState, org.addressZip].filter(Boolean).join(" ")]
    .filter((s) => s && String(s).trim())
    .join(", ");
  const parts = [org.addressStreet, org.addressSuite, cityLine, org.addressCountry]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.join(", ");
  const legacy = (org.address ?? "").replace(/\s*\n\s*/g, ", ").trim();
  return legacy || null;
}

export interface UnsubscribeFooterInput {
  token: string;
  org: FooterOrg | null | undefined;
}

export function unsubscribeFooterHtml({ token, org }: UnsubscribeFooterInput): string {
  const sender = escapeHtml((org?.name ?? "").trim() || "the sender");
  const address = orgPostalAddress(org);
  const url = escapeHtml(unsubscribePageUrl(token));
  return (
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e6e3dd;` +
    `font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8b8da3">` +
    `You are receiving this email from ${sender}. ` +
    `<a href="${url}" style="color:#8b8da3;text-decoration:underline">Unsubscribe</a>` +
    (address ? `<br>${escapeHtml(address)}` : "") +
    `</div>`
  );
}

export function unsubscribeFooterText({ token, org }: UnsubscribeFooterInput): string {
  const sender = (org?.name ?? "").trim() || "the sender";
  const address = orgPostalAddress(org);
  return (
    `\n\n--\nYou are receiving this email from ${sender}. ` +
    `Unsubscribe: ${unsubscribePageUrl(token)}` +
    (address ? `\n${address}` : "")
  );
}

/**
 * Append the footer before </body> when the body is a full document,
 * otherwise at the end.
 */
export function withUnsubscribeFooter(html: string, input: UnsubscribeFooterInput): string {
  const footer = unsubscribeFooterHtml(input);
  const idx = html.search(/<\/body\s*>/i);
  if (idx === -1) return html + footer;
  return html.slice(0, idx) + footer + html.slice(idx);
}

export interface UnsubscribeTarget {
  prospectId: string;
  orgId: string;
  brandId: string | null;
  orgName: string;
  alreadyUnsubscribed: boolean;
}

export async function findUnsubscribeTarget(token: string): Promise<UnsubscribeTarget | null> {
  if (!isUnsubscribeToken(token)) return null;
  const [row] = await db
    .select({
      prospectId: marketingProspects.id,
      orgId: marketingProspects.orgId,
      brandId: marketingProspects.brandId,
      unsubscribedAt: marketingProspects.unsubscribedAt,
      orgName: orgs.name,
    })
    .from(marketingProspects)
    .innerJoin(orgs, eq(orgs.id, marketingProspects.orgId))
    .where(eq(marketingProspects.unsubscribeToken, token));
  if (!row) return null;
  return {
    prospectId: row.prospectId,
    orgId: row.orgId,
    brandId: row.brandId,
    orgName: row.orgName,
    alreadyUnsubscribed: row.unsubscribedAt !== null,
  };
}

/**
 * Mark the token's prospect unsubscribed. Idempotent: a second call keeps the
 * first timestamp and logs nothing. Returns the target, or null for an
 * unknown token.
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeTarget | null> {
  const target = await findUnsubscribeTarget(token);
  if (!target) return null;
  const now = new Date();
  const updated = await db
    .update(marketingProspects)
    .set({ unsubscribedAt: now, updatedAt: now })
    .where(and(
      eq(marketingProspects.id, target.prospectId),
      isNull(marketingProspects.unsubscribedAt),
    ))
    .returning({ id: marketingProspects.id });
  if (updated.length > 0) {
    await storage
      .createActivity({
        orgId: target.orgId,
        brandId: target.brandId,
        prospectId: target.prospectId,
        type: "unsubscribed",
        payload: { source: "email_link" },
      } as any)
      .catch((err) => console.error("[marketing] unsubscribe activity failed:", err));
  }
  return { ...target, alreadyUnsubscribed: true };
}
