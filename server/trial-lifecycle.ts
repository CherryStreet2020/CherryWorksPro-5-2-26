/**
 * Trial lifecycle for workspaces that started a trial but never entered a
 * card (no Stripe subscription). Stripe owns the calendar for card trials;
 * this owns the rest:
 *
 *   T-7d  reminder email to the workspace admins   (orgs.trial_reminder_7_sent_at)
 *   T-1d  reminder email                            (orgs.trial_reminder_1_sent_at)
 *   T+0   subscription_status → "trial_expired"    (orgs.trial_expired_at)
 *         + "your trial has ended" email. The data stays; the app shows the
 *         plan picker and the API answers 402 PLAN_INACTIVE outside billing.
 *
 * ENTERPRISE workspaces are comped by hand and never expire. A workspace
 * that later completes checkout is reactivated by the Stripe webhook
 * (checkout.session.completed sets subscription_status = trialing).
 */
import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db";
import { orgs, users, type Org } from "@shared/schema";
import { storage } from "./storage";
import { sendTrialEndingEmail, sendTrialEndedEmail } from "./email";
import { trustedBaseUrl } from "./lib/app-url";

export const TRIAL_EXPIRED_STATUS = "trial_expired";
const DAY = 24 * 60 * 60 * 1000;

export type TrialAction = "remind_7d" | "remind_1d" | "expire" | null;

/** Pure: what, if anything, the tick should do for this org right now. */
export function trialActionFor(org: Pick<Org, "planTier" | "subscriptionStatus" | "stripeSubscriptionId" | "trialEndsAt" | "trialReminder7SentAt" | "trialReminder1SentAt">, now = new Date()): TrialAction {
  if (org.planTier === "ENTERPRISE") return null;
  if (org.stripeSubscriptionId) return null;            // Stripe runs card trials
  if (org.subscriptionStatus !== "trialing") return null;
  if (!org.trialEndsAt) return null;
  const msLeft = org.trialEndsAt.getTime() - now.getTime();
  if (msLeft <= 0) return "expire";
  // Inside the last day only the 1-day reminder is ever sent: a 7-day
  // reminder that never went out is stale, not owed.
  if (msLeft <= 1 * DAY) return org.trialReminder1SentAt ? null : "remind_1d";
  if (msLeft <= 7 * DAY && !org.trialReminder7SentAt) return "remind_7d";
  return null;
}

/** Pure: is this org's plan inactive (trial ended without a card, or subscription gone)? */
export function planInactive(org: Pick<Org, "planTier" | "subscriptionStatus"> & Partial<Pick<Org, "stripeSubscriptionId" | "trialEndsAt">> | null | undefined, now = new Date()): boolean {
  if (!org) return false;
  if (org.planTier === "ENTERPRISE") return false; // comped by hand; never locked by automation
  if (org.subscriptionStatus === TRIAL_EXPIRED_STATUS || org.planTier === "EXPIRED") return true;
  // The deadline holds on the request path too, not only when the hourly
  // tick happens to run: a no-card trial past its end is over now.
  if (org.subscriptionStatus === "trialing" && !org.stripeSubscriptionId && org.trialEndsAt && org.trialEndsAt.getTime() <= now.getTime()) return true;
  return false;
}

async function adminRecipients(orgId: string): Promise<{ email: string; name: string }[]> {
  const rows = await db.select({ email: users.email, name: users.name }).from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, "ADMIN"), eq(users.isActive, true)));
  return rows.filter(r => !!r.email).map(r => ({ email: r.email, name: r.name || "" }));
}

function billingUrl(): string {
  let base = "http://localhost:5000";
  try { base = trustedBaseUrl(); } catch { /* unconfigured non-production: local link */ }
  return `${base}/settings/billing`;
}

/** Sends the "trial has ended" email; stamps trial_expired_at only when at least one admin got it. */
async function deliverEndedEmail(org: Org, recipients: { email: string; name: string }[], now: Date): Promise<void> {
  let delivered = 0;
  for (const r of recipients) {
    try { await sendTrialEndedEmail(r.email, r.name, org.name, billingUrl(), org); delivered++; }
    catch (err) { console.warn("[trial-lifecycle] ended email failed", org.slug, (err as Error).message); }
  }
  if (recipients.length === 0 || delivered > 0) {
    await db.update(orgs).set({ trialExpiredAt: now }).where(and(eq(orgs.id, org.id), isNull(orgs.trialExpiredAt)));
  }
}

export interface TrialTickResult { reminded7: number; reminded1: number; expired: number; errors: number }

export async function runTrialLifecycleTick(now = new Date()): Promise<TrialTickResult> {
  const result: TrialTickResult = { reminded7: 0, reminded1: 0, expired: 0, errors: 0 };
  const candidates = await db.select().from(orgs).where(and(
    eq(orgs.subscriptionStatus, "trialing"),
    isNull(orgs.stripeSubscriptionId),
    ne(orgs.planTier, "ENTERPRISE"),
    lt(orgs.trialEndsAt, new Date(now.getTime() + 7 * DAY)),
  ));
  for (const org of candidates) {
    const action = trialActionFor(org, now);
    if (!action) continue;
    try {
      const recipients = await adminRecipients(org.id);
      const daysLeft = Math.max(1, Math.ceil((org.trialEndsAt!.getTime() - now.getTime()) / DAY));
      // Every write is conditional on the state it transitions from, and the
      // side effects (audit row, emails) only follow a write that landed —
      // so two overlapping ticks, or two instances, send each email once.
      if (action === "expire") {
        // The status flips now; trial_expired_at is set only once the "ended"
        // email has gone out, so a delivery failure is retried by later ticks.
        const changed = await db.update(orgs).set({ subscriptionStatus: TRIAL_EXPIRED_STATUS })
          .where(and(eq(orgs.id, org.id), eq(orgs.subscriptionStatus, "trialing"), isNull(orgs.stripeSubscriptionId))).returning({ id: orgs.id });
        if (changed.length === 0) continue;
        resetPlanGateCache(org.id);
        await storage.createAuditLog({ orgId: org.id, userId: null, action: "TRIAL_EXPIRED", entityType: "org", entityId: org.id, details: { trialEndsAt: org.trialEndsAt, recipients: recipients.map(r => r.email) } });
        await deliverEndedEmail(org, recipients, now);
        result.expired++;
      } else {
        const stampCol = action === "remind_7d" ? orgs.trialReminder7SentAt : orgs.trialReminder1SentAt;
        const stamp = action === "remind_7d" ? { trialReminder7SentAt: now } : { trialReminder1SentAt: now };
        const changed = await db.update(orgs).set(stamp)
          .where(and(eq(orgs.id, org.id), isNull(stampCol), eq(orgs.subscriptionStatus, "trialing"))).returning({ id: orgs.id });
        if (changed.length === 0) continue; // another tick/instance holds the claim
        let delivered = 0;
        for (const r of recipients) {
          try { await sendTrialEndingEmail(r.email, r.name, org.name, daysLeft, billingUrl(), org); delivered++; }
          catch (err) { console.warn("[trial-lifecycle] reminder email failed", org.slug, (err as Error).message); }
        }
        if (recipients.length > 0 && delivered === 0) {
          // Nothing reached anyone (transient outage): release the claim so the next tick retries.
          const release = action === "remind_7d" ? { trialReminder7SentAt: null } : { trialReminder1SentAt: null };
          await db.update(orgs).set(release).where(eq(orgs.id, org.id));
          result.errors++;
          continue;
        }
        await storage.createAuditLog({ orgId: org.id, userId: null, action: "TRIAL_ENDING_SOON", entityType: "org", entityId: org.id, details: { daysRemaining: daysLeft, source: "trial-lifecycle", recipients: recipients.map(r => r.email), delivered } });
        if (action === "remind_7d") result.reminded7++; else result.reminded1++;
      }
    } catch (err) {
      result.errors++;
      console.error("[trial-lifecycle] org failed", org.slug, (err as Error).message);
    }
  }
  // Expired workspaces whose "ended" email never went out: retry delivery.
  const unmailed = await db.select().from(orgs).where(and(eq(orgs.subscriptionStatus, TRIAL_EXPIRED_STATUS), isNull(orgs.trialExpiredAt)));
  for (const org of unmailed) {
    try { await deliverEndedEmail(org, await adminRecipients(org.id), now); }
    catch (err) { result.errors++; console.error("[trial-lifecycle] ended-email retry failed", org.slug, (err as Error).message); }
  }
  if (result.reminded7 || result.reminded1 || result.expired || result.errors) {
    console.log(JSON.stringify({ ts: now.toISOString(), level: "info", event: "TRIAL_LIFECYCLE_TICK", ...result }));
  }
  return result;
}

let interval: NodeJS.Timeout | null = null;
export function startTrialLifecycleProcessor(): void {
  if (interval) return;
  // A rejected tick must never escape: server/index.ts exits the process on
  // an unhandled rejection, and a transient DB error is not worth the server.
  const safeTick = () => runTrialLifecycleTick().catch(err => console.error("[trial-lifecycle] tick failed:", (err as Error).message));
  interval = setInterval(() => { void safeTick(); }, 60 * 60 * 1000);
  setTimeout(() => { void safeTick(); }, 30 * 1000);
  console.log("[trial-lifecycle] processor started (60min interval, first pass in 30s)");
}
export function stopTrialLifecycleProcessor(): void {
  if (interval) { clearInterval(interval); interval = null; }
}

// ─── API gate ────────────────────────────────────────────────────────────
// Everything under /api answers 402 PLAN_INACTIVE for an inactive workspace,
// except what the plan picker itself needs.
// Lower-case: Express matches routes case-insensitively, so the gate must too.
const ALLOW_PREFIXES = [
  "/api/auth/", "/api/csrf-token", "/api/mfa/",            // sign-in and its completion
  "/api/billing/", "/api/entitlements",                      // the way out
  "/api/health", "/api/readyz", "/api/csp-report",
  "/api/webhooks/", "/api/platform/",
  "/api/portal/", "/api/public/", "/api/public-objects/",    // token-authenticated, other workspaces' documents
  "/api/notifications/unread-count", "/api/help/",
];
const orgCache = new Map<string, { at: number; inactive: boolean }>();
const ORG_CACHE_MS = 30 * 1000;
export function resetPlanGateCache(orgId?: string): void { if (orgId) orgCache.delete(orgId); else orgCache.clear(); }

export async function planGate(req: Request, res: Response, next: NextFunction) {
  const orgId = req.session?.orgId;
  const path = req.path.toLowerCase();
  if (!orgId || !path.startsWith("/api/")) return next();
  if (ALLOW_PREFIXES.some(p => path === p || path.startsWith(p))) return next();
  try {
    let entry = orgCache.get(orgId);
    if (!entry || Date.now() - entry.at > ORG_CACHE_MS) {
      const [org] = await db.select({ planTier: orgs.planTier, subscriptionStatus: orgs.subscriptionStatus, stripeSubscriptionId: orgs.stripeSubscriptionId, trialEndsAt: orgs.trialEndsAt }).from(orgs).where(eq(orgs.id, orgId));
      entry = { at: Date.now(), inactive: planInactive(org) };
      orgCache.set(orgId, entry);
    }
    if (entry.inactive) {
      return res.status(402).json({ code: "PLAN_INACTIVE", message: "Your trial has ended. Choose a plan to keep working — your data is safe." });
    }
  } catch (err) {
    console.warn("[trial-lifecycle] plan gate lookup failed; allowing", (err as Error).message);
  }
  next();
}

/** For tests and admin tooling: expire an org immediately. */
export async function expireOrgNow(orgId: string): Promise<void> {
  await db.update(orgs).set({ subscriptionStatus: TRIAL_EXPIRED_STATUS, trialEndsAt: sql`LEAST(trial_ends_at, now())` }).where(eq(orgs.id, orgId));
  resetPlanGateCache(orgId);
}
