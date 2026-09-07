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

/** Accounts created before verification existed count as verified. Idempotent; runs at boot. */
export async function backfillLegacyVerified(cutoff = new Date("2026-09-08T00:00:00Z")): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const result = await db.execute(sql`UPDATE users SET email_verified_at = COALESCE(created_at, now()) WHERE email_verified_at IS NULL AND created_at < ${cutoff}`);
  return (result as any).rowCount ?? 0;
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
