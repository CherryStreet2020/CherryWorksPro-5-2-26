/**
 * Email verification for workspace owners who signed up with a password.
 *
 * Signup issues a 24-hour single-use token (hash stored, raw value emailed).
 * The account is usable right away — the card at checkout is the stronger
 * signal — but until the address is proven, features that send mail on the
 * workspace's behalf (team invites, sending invoices and estimates) are held
 * back, and the app shows a banner with a resend button. Invited members and
 * anyone who completes a password reset are verified by that act: the
 * credential reached their inbox.
 */
import { createHash, randomBytes } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Stores a fresh token for the user and returns the raw value to email. */
export async function issueVerificationToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await db.update(users).set({ emailVerificationTokenHash: hashToken(raw), emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) }).where(eq(users.id, userId));
  return raw;
}

export type VerifyOutcome = { ok: true; userId: string; orgId: string; alreadyVerified: boolean } | { ok: false; reason: "invalid" | "expired" };

export async function verifyToken(raw: string): Promise<VerifyOutcome> {
  if (!raw || raw.length < 32 || raw.length > 128) return { ok: false, reason: "invalid" };
  const [user] = await db.select({ id: users.id, orgId: users.orgId, expiresAt: users.emailVerificationExpiresAt, verifiedAt: users.emailVerifiedAt })
    .from(users).where(eq(users.emailVerificationTokenHash, hashToken(raw)));
  if (!user) return { ok: false, reason: "invalid" };
  if (user.verifiedAt) {
    await db.update(users).set({ emailVerificationTokenHash: null, emailVerificationExpiresAt: null }).where(eq(users.id, user.id));
    return { ok: true, userId: user.id, orgId: user.orgId, alreadyVerified: true };
  }
  if (!user.expiresAt || user.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  await markVerified(user.id);
  return { ok: true, userId: user.id, orgId: user.orgId, alreadyVerified: false };
}

/** The address is proven (link clicked, emailed temp password used, reset completed). */
export async function markVerified(userId: string): Promise<void> {
  await db.update(users).set({ emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null })
    .where(and(eq(users.id, userId)));
}

export const LEGACY_BACKFILL_KEY = "legacy_email_verification_backfill_done";

/**
 * Accounts created before verification existed count as verified. Runs ONCE
 * per database (marker row in platform_settings): a later deliberate reset —
 * an admin changing a legacy account's address — must not be undone by the
 * next restart.
 */
export async function backfillLegacyVerified(cutoff = new Date("2026-09-08T00:00:00Z")): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const { platformSettings } = await import("@shared/schema");
  const [done] = await db.select({ key: platformSettings.key }).from(platformSettings).where(eq(platformSettings.key, LEGACY_BACKFILL_KEY));
  if (done) return 0;
  const result = await db.execute(sql`UPDATE users SET email_verified_at = COALESCE(created_at, now()) WHERE email_verified_at IS NULL AND created_at < ${cutoff}`);
  await db.insert(platformSettings).values({ key: LEGACY_BACKFILL_KEY, value: { at: new Date().toISOString(), cutoff: cutoff.toISOString() } }).onConflictDoNothing();
  return (result as any).rowCount ?? 0;
}

/**
 * Marker stored in the 64-char token-hash column while a temporary password
 * is outstanding: "temp:" + the first 59 hex chars of sha256(address). A raw
 * token's hash is 64 hex characters, so it can never equal a marker.
 */
export function tempCredentialMarker(email: string): string {
  return `temp:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 59)}`;
}

/** Record which address an emailed temporary password proves. */
export async function noteTempCredential(userId: string, email: string): Promise<void> {
  await db.update(users).set({ emailVerificationTokenHash: tempCredentialMarker(email), emailVerificationExpiresAt: null }).where(eq(users.id, userId));
}

/** True when the user's outstanding temporary password was emailed to their CURRENT address. */
export function tempCredentialProves(user: { email: string; emailVerificationTokenHash: string | null }): boolean {
  return !!user.emailVerificationTokenHash && user.emailVerificationTokenHash === tempCredentialMarker(user.email);
}

/** Route guard for features that send mail on the workspace's behalf. */
export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const [row] = await db.select({ verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, req.session.userId));
    if (!row) return res.status(401).json({ message: "Unauthorized" });
    if (!row.verifiedAt) {
      return res.status(403).json({ code: "EMAIL_UNVERIFIED", message: "Verify your email address first — check your inbox for the link, or resend it from the banner at the top of the app." });
    }
  } catch {
    return res.status(500).json({ message: "Verification check failed" });
  }
  next();
}

/** An address that changed is unproven again: clear the stamp and any outstanding token. */
export function unverifiedFields() {
  return { emailVerifiedAt: null as Date | null, emailVerificationTokenHash: null as string | null, emailVerificationExpiresAt: null as Date | null };
}
