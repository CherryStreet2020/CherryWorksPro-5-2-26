import type { Express } from "express";
import { storage } from "./storage";
import type { CreateStripePaymentResult } from "./storage";
import { db } from "./db";
import { orgs, orgEntitlements } from "@shared/schema";
import { users, teamMemberPayoutsV2 } from "@shared/schema";
import { stripeEvents } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { round2 } from "@shared/schema";
import { createAutoJournalEntry } from "./routes/middleware";
import {
  ADDON_FEATURES,
  RETIRED_ADDON_FEATURES,
  getAddonFeatureForPrice,
  isAddonPriceId,
  type AddonFeature,
} from "./stripe-addon-prices";
import { syncMarketingOsTierEntitlement } from "./services/marketing-os-tier";

/**
 * Sprint 2j — Inspect a Stripe event's items and partition into add-on
 * vs base price IDs. Works for both `customer.subscription.*` events
 * (items live at `event.data.object.items.data`) and
 * `checkout.session.completed` (we expand `line_items` lazily).
 *
 * For checkout.session.completed we may need to fetch line items from
 * Stripe (they aren't on the event by default). Caller must handle the
 * async path.
 */
export async function extractAddonPricesFromEvent(
  event: any,
): Promise<{ addonPriceIds: string[]; basePriceIds: string[]; subscriptionId: string | null }> {
  const obj = event?.data?.object;
  if (!obj) return { addonPriceIds: [], basePriceIds: [], subscriptionId: null };

  const priceIds: string[] = [];
  let subscriptionId: string | null = null;

  if (event.type?.startsWith("customer.subscription.")) {
    subscriptionId = obj.id || null;
    const items = obj.items?.data;
    if (Array.isArray(items)) {
      for (const item of items) {
        const pid = item?.price?.id;
        if (typeof pid === "string") priceIds.push(pid);
      }
    }
  } else if (event.type === "checkout.session.completed") {
    subscriptionId = typeof obj.subscription === "string" ? obj.subscription : null;
    // line_items is not included by default. Try inline first; fall back
    // to a Stripe SDK fetch.
    const inline = obj.line_items?.data;
    if (Array.isArray(inline) && inline.length > 0) {
      for (const li of inline) {
        const pid = li?.price?.id;
        if (typeof pid === "string") priceIds.push(pid);
      }
    } else if (obj.id && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const items = await stripe.checkout.sessions.listLineItems(obj.id, { limit: 100 });
        for (const li of items.data) {
          const pid = (li as any)?.price?.id;
          if (typeof pid === "string") priceIds.push(pid);
        }
      } catch (err) {
        console.warn(
          `[addon-webhook] could not fetch line_items for session ${obj.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  const addonPriceIds: string[] = [];
  const basePriceIds: string[] = [];
  for (const pid of priceIds) {
    if (isAddonPriceId(pid)) addonPriceIds.push(pid);
    else basePriceIds.push(pid);
  }
  return { addonPriceIds, basePriceIds, subscriptionId };
}

/**
 * Sprint 2j — Pure helper for add-on entitlement target state computation.
 * Exported so unit tests can exercise every event-type / status combo
 * without the rest of the webhook plumbing.
 */
export function computeAddonTargetState(
  eventType: string,
  status: string | null | undefined,
  existingGraceEndsAt: Date | null,
  now: Date = new Date(),
): { active: boolean; gracePeriodEndsAt: Date | null } | null {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  if (
    eventType === "checkout.session.completed" ||
    eventType === "customer.subscription.created"
  ) {
    return { active: true, gracePeriodEndsAt: null };
  }
  if (eventType === "customer.subscription.deleted") {
    return { active: false, gracePeriodEndsAt: null };
  }
  if (eventType === "customer.subscription.updated") {
    if (status === "active" || status === "trialing") {
      return { active: true, gracePeriodEndsAt: null };
    }
    if (status === "past_due") {
      // Never extend on repeat past_due: preserve any existing grace window.
      const grace = existingGraceEndsAt ?? new Date(now.getTime() + SEVEN_DAYS_MS);
      return { active: true, gracePeriodEndsAt: grace };
    }
    if (status === "canceled" || status === "incomplete_expired" || status === "unpaid") {
      return { active: false, gracePeriodEndsAt: null };
    }
    return null;
  }
  return null;
}

/**
 * Task #392 — Pure helper for the marketing_os grandfather decision.
 * Decoupled from Drizzle so unit tests can exercise every combo.
 *
 * `legacySubscriptionMatch` lets a null `existingGrandfather` still be
 * extended when the row's stored stripe_subscription_id matches the
 * event's sub id — i.e. cleanup/lazy-expire just cleared the field but
 * the same legacy subscription is still alive (delayed-renewal race).
 *
 * Never fabricates a window: if current_period_end is missing on a
 * non-terminal event, returns skip and the caller logs a warning.
 */
export function computeMarketingOsGrandfatherTarget(
  eventType: string,
  status: string | null | undefined,
  existingGrandfather: Date | null,
  currentPeriodEnd: Date | null,
  legacySubscriptionMatch: boolean = false,
): { action: "skip" } | { action: "deactivate" } | { action: "extend"; newGrandfather: Date } {
  if (!existingGrandfather && !legacySubscriptionMatch) return { action: "skip" };

  const isTerminal =
    eventType === "customer.subscription.deleted" ||
    status === "canceled" ||
    status === "incomplete_expired" ||
    status === "unpaid";
  if (isTerminal) return { action: "deactivate" };

  if (currentPeriodEnd === null) return { action: "skip" };

  // Forward-only; epoch-0 baseline when re-extending after a clear.
  const baseline = existingGrandfather ?? new Date(0);
  const next = currentPeriodEnd > baseline ? currentPeriodEnd : baseline;
  return { action: "extend", newGrandfather: next };
}

function isUniqueViolation(err: any): boolean {
  return err?.code === "23505" || /unique.*constraint|duplicate key/i.test(err?.message || "");
}

/**
 * Thrown inside the checkout transaction to roll it back when the under-lock
 * overpayment re-check (audit #20) rejects the payment. We must roll back the tx
 * — which has already inserted the PROCESSED `stripe_events` row — and then record
 * a terminal FAILED event in a fresh statement, since the FAILED row can't be
 * written inside the transaction we're rolling back.
 */
class CheckoutTxRollback extends Error {
  constructor(public readonly outcome: CreateStripePaymentResult) {
    super("checkout-tx-rollback");
    this.name = "CheckoutTxRollback";
  }
}

const RELEVANT_EVENTS = new Set([
  "checkout.session.completed",
  "charge.refunded",
  "payment_intent.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "account.updated",
  "transfer.created",
  "transfer.failed",
  "customer.subscription.trial_will_end",
]);

const PLAN_TIER_MAP: Record<string, { tier: string; maxTeamMembers: number }> = {
  cherryworks_starter_monthly: { tier: "STARTER", maxTeamMembers: 999999 },
  cherryworks_starter_annual: { tier: "STARTER", maxTeamMembers: 999999 },
  cherryworks_professional_monthly: { tier: "PROFESSIONAL", maxTeamMembers: 999999 },
  cherryworks_professional_annual: { tier: "PROFESSIONAL", maxTeamMembers: 999999 },
  cherryworks_business_monthly: { tier: "BUSINESS", maxTeamMembers: 999999 },
  cherryworks_business_annual: { tier: "BUSINESS", maxTeamMembers: 999999 },
};

async function resolveEventOrgId(event: any): Promise<string | null> {
  const obj = event.data?.object;
  if (!obj) return null;

  if (obj.metadata?.orgId) return obj.metadata.orgId;

  const customerId = obj.customer;
  if (customerId) {
    const org = await storage.getOrgByStripeCustomerId(customerId);
    if (org) return org.id;
  }

  if (obj.metadata?.publicToken) {
    const invoice = await storage.getInvoiceByPublicToken(obj.metadata.publicToken);
    if (invoice) return invoice.orgId;
  }

  return null;
}

export function registerStripeWebhook(app: Express): void {
  app.post("/api/webhooks/stripe", async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(503).json({ message: "Webhook not configured" });
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      return res.status(400).json({ message: "Missing stripe-signature header" });
    }

    let event: any;
    try {
      const Stripe = (await import("stripe")).default;
      if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const rawBody = (req as any).rawBody;
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch {
      return res.status(400).json({ message: "Invalid signature" });
    }

    if (!event.id || !event.type) {
      console.error("[stripe] Missing expected field: event.id or event.type");
      return res.status(400).json({ message: "Missing event fields" });
    }
    const stripeEventId = event.id as string;
    const eventType = event.type as string;
    const livemode = !!event.livemode;
    const created = event.created as number;

    const resolvedOrgId = await resolveEventOrgId(event);

    if (resolvedOrgId) {
      const existing = await storage.getStripeEventByEventId(stripeEventId, resolvedOrgId);
      if (existing) {
        return res.json({ received: true, duplicate: true });
      }
    }

    if (!RELEVANT_EVENTS.has(eventType)) {
      if (resolvedOrgId) {
        await storage.createStripeEvent({
          orgId: resolvedOrgId,
          stripeEventId,
          type: eventType,
          livemode,
          created,
          status: "IGNORED",
          failureCode: null,
          failureDetail: null,
        });
      } else {
        console.warn(`[stripe-webhook] Ignoring event ${stripeEventId} (${eventType}) — no orgId resolved`);
      }
      return res.json({ received: true });
    }

    // ─── Sprint 2j — Add-on routing ───────────────────────────────
    // Subscription-shaped events whose items include any add-on price ID
    // route to the add-on handler. Mixed (base + add-on) events run the
    // add-on handler FIRST and then fall through to the base dispatch so
    // both halves of the subscription are reflected. Add-on-only events
    // short-circuit and never touch `orgs.planTier` / `subscriptionStatus`.
    let addonRouted = false;
    let addonContext: Awaited<ReturnType<typeof extractAddonPricesFromEvent>> | null;
    if (
      eventType === "checkout.session.completed" ||
      eventType === "customer.subscription.created" ||
      eventType === "customer.subscription.updated" ||
      eventType === "customer.subscription.deleted"
    ) {
      try {
        addonContext = await extractAddonPricesFromEvent(event);
        // Sprint 2j safety net: if the dispatcher couldn't read line items
        // (e.g. transient Stripe API failure on a checkout.session.completed
        // event), but the session was created with metadata.kind === "addon",
        // refuse to fall through to the base-plan handler. Better to skip
        // and let the subsequent customer.subscription.created event finish
        // the flip than to corrupt orgs.planTier.
        const obj = event.data?.object;
        const metaKind = obj?.metadata?.kind;
        const metaFeature = obj?.metadata?.feature;
        const sessionLooksAddon =
          eventType === "checkout.session.completed" &&
          (metaKind === "addon" ||
            (typeof metaFeature === "string" &&
              ((ADDON_FEATURES as readonly string[]).includes(metaFeature) ||
                (RETIRED_ADDON_FEATURES as readonly string[]).includes(
                  metaFeature,
                ))));
        if (addonContext.addonPriceIds.length > 0) {
          // When the event is mixed (base + add-on), the base handler will
          // also try to write `stripe_events`. Tell the add-on handler to
          // skip that write so the unique constraint isn't violated.
          const isMixed = addonContext.basePriceIds.length > 0;
          await handleAddonSubscriptionEvent(
            event,
            stripeEventId,
            eventType,
            livemode,
            created,
            addonContext.addonPriceIds,
            addonContext.subscriptionId,
            resolvedOrgId,
            isMixed,
          );
          addonRouted = true;
          if (!isMixed) {
            return res.json({ received: true, routed: "addon" });
          }
        } else if (sessionLooksAddon) {
          console.warn(
            `[addon-webhook] checkout.session metadata indicates add-on (${metaFeature ?? metaKind}) but no add-on price IDs were resolved; skipping base handler to protect planTier (event ${stripeEventId})`,
          );
          return res.json({ received: true, routed: "addon-skip" });
        }
      } catch (addonErr: any) {
        console.error("[addon-webhook] handler failed:", addonErr?.message ?? addonErr);
        // Fall through to base dispatch so we don't lose base-plan processing.
      }
    }

    try {
      if (eventType === "checkout.session.completed") {
        const session = event.data?.object;
        if (session?.mode === "subscription" && session?.metadata?.orgId && session?.payment_method_collection === "always") {
          try {
            const Stripe = (await import("stripe")).default;
            if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            if (!session.customer) {
              console.error("[stripe] Missing expected field: session.customer");
              return res.json({ received: true });
            }
            const setupIntents = await stripe.setupIntents.list({ customer: session.customer as string, limit: 1 });
            const si = setupIntents.data[0];
            if (si?.payment_method) {
              const pm = await stripe.paymentMethods.retrieve(si.payment_method as string);
              const fingerprint = pm.card?.fingerprint;
              if (fingerprint) {
                const currentOrgId = session.metadata.orgId;
                const currentOrg = await db.select({ id: orgs.id, stripeCustomerId: orgs.stripeCustomerId, subscriptionStatus: orgs.subscriptionStatus }).from(orgs).where(eq(orgs.id, currentOrgId)).limit(1);
                if (currentOrg.length > 0 && currentOrg[0].stripeCustomerId) {
                  try {
                    const existingPMs = await stripe.paymentMethods.list({ customer: currentOrg[0].stripeCustomerId, type: "card", limit: 20 });
                    const duplicateCount = existingPMs.data.filter(opm => opm.card?.fingerprint === fingerprint && opm.id !== (si.payment_method as string)).length;
                    if (duplicateCount > 0 && (currentOrg[0].subscriptionStatus === "canceled" || currentOrg[0].subscriptionStatus === "past_due")) {
                      console.warn(`[trial-abuse] DUPLICATE CARD DETECTED within org ${currentOrgId}: card fingerprint reuse after cancellation`);
                      await storage.createAuditLog({
                        orgId: currentOrgId,
                        userId: null,
                        action: "TRIAL_ABUSE_CARD_REUSE",
                        entityType: "org",
                        entityId: currentOrgId,
                        details: { blocked: true },
                      });
                      await storage.updateOrg(currentOrgId, {
                        subscriptionStatus: "canceled",
                        planTier: "EXPIRED",
                      });
                      await storage.createStripeEvent({
                        orgId: currentOrgId,
                        stripeEventId,
                        type: eventType,
                        livemode,
                        created,
                        status: "FAILED",
                        failureCode: "TRIAL_ABUSE_BLOCKED",
                        failureDetail: "Duplicate card fingerprint detected within same org",
                      });
                      return res.status(200).json({ received: true, blocked: true, reason: "trial_abuse" });
                    }
                  } catch { /* PM list may fail */ }
                }
              }
            }
          } catch (fpErr) {
            console.error("[trial-abuse] Card fingerprint check failed:", (fpErr as Error).message);
          }
        }

        if (session?.mode === "subscription" && session?.metadata?.orgId) {
          return await handleSubscriptionCheckout(res, event, session, stripeEventId, eventType, livemode, created);
        }
        return await handleInvoiceCheckoutCompleted(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated") {
        return await handleSubscriptionUpdated(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "customer.subscription.deleted") {
        return await handleSubscriptionDeleted(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "customer.subscription.trial_will_end") {
        return await handleSubscriptionTrialWillEnd(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "invoice.payment_succeeded") {
        return await handleInvoicePaymentSucceeded(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "invoice.payment_failed") {
        return await handleInvoicePaymentFailed(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "charge.refunded") {
        return await handleChargeRefunded(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "payment_intent.payment_failed") {
        if (resolvedOrgId) {
          await storage.createStripeEvent({
            orgId: resolvedOrgId,
            stripeEventId,
            type: eventType,
            livemode,
            created,
            status: "IGNORED",
            failureCode: null,
            failureDetail: null,
          });
        } else {
          console.warn(`[stripe-webhook] payment_intent.payment_failed ${stripeEventId} — no orgId resolved, skipping event log`);
        }
        return res.json({ received: true });
      }

      if (eventType === "account.updated") {
        return await handleConnectAccountUpdated(res, event, stripeEventId, eventType, livemode, created);
      }

      if (eventType === "transfer.created" || eventType === "transfer.failed") {
        return await handleTransferEvent(res, event, stripeEventId, eventType, livemode, created);
      }
    } catch (err: any) {
      console.error(`[stripe-webhook] Error processing ${eventType}:`, err.message);
      if (resolvedOrgId) {
        try {
          await storage.createStripeEvent({
            orgId: resolvedOrgId,
            stripeEventId,
            type: eventType,
            livemode,
            created,
            status: "FAILED",
            failureCode: "HANDLER_ERROR",
            failureDetail: err.message,
          });
        } catch {}
      }
      return res.status(200).json({ received: false, error: "Processing failed" });
    }

    return res.json({ received: true });
  });
}

async function handleSubscriptionCheckout(
  res: any, event: any, session: any,
  stripeEventId: string, eventType: string, livemode: boolean, created: number,
) {
  const orgId = session.metadata.orgId;

  const existingEvent = await storage.getStripeEventByEventId(stripeEventId, orgId);
  if (existingEvent) {
    return res.json({ received: true, duplicate: true });
  }
  const planTier = session.metadata.planTier || "PROFESSIONAL";
  const subscriptionId = session.subscription;
  const customerId = session.customer;

  const planLimits: Record<string, number> = { STARTER: 999999, PROFESSIONAL: 999999, BUSINESS: 999999, ENTERPRISE: 999999 };

  try {
    await storage.updateOrg(orgId, {
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      planTier: planTier,
      subscriptionStatus: "trialing",
      maxTeamMembers: planLimits[planTier] || 999999,
    });

    // Task #392 — Sync tier-derived marketing_os immediately. A BUSINESS
    // checkout must light up the entitlement row in lockstep with the org
    // update so admin tooling and the JSON endpoint agree without waiting
    // for the read-path overlay to backfill.
    await syncMarketingOsTierEntitlement(orgId, planTier, "trialing");

    await storage.createStripeEvent({
      orgId,
      stripeEventId,
      type: eventType,
      livemode,
      created,
      status: "PROCESSED",
      failureCode: null,
      failureDetail: null,
    });

    await storage.createAuditLog({
      orgId,
      userId: null,
      action: "SUBSCRIPTION_STARTED",
      entityType: "org",
      entityId: orgId,
      details: { planTier, subscriptionId, trial: true },
    });
  } catch (err: any) {
    console.error("[stripe] handleSubscriptionCheckout partial failure:", err.message);
    try {
      await storage.createStripeEvent({
        orgId,
        stripeEventId,
        type: eventType,
        livemode,
        created,
        status: "FAILED",
        failureCode: "PARTIAL_STATE",
        failureDetail: err.message,
      });
    } catch {}
    return res.status(200).json({ error: "Subscription checkout processing failed" });
  }

  return res.json({ received: true });
}

async function handleSubscriptionUpdated(
  res: any, event: any,
  stripeEventId: string, eventType: string, livemode: boolean, created: number,
) {
  const subscription = event.data?.object;
  const customerId = subscription?.customer;

  // Sprint 2j — belt-and-suspenders guard. If the subscription items are
  // entirely add-on prices, the dispatcher already routed to the add-on
  // handler; this base handler MUST NOT touch `orgs.planTier` etc.
  try {
    const items = subscription?.items?.data;
    if (Array.isArray(items) && items.length > 0) {
      const allAddon = items.every((it: any) => {
        const pid = it?.price?.id;
        return typeof pid === "string" && isAddonPriceId(pid);
      });
      if (allAddon) {
        return res.json({ received: true, routed: "addon-guard" });
      }
    }
  } catch { /* best-effort guard; fall through to normal handling */ }

  if (!customerId) {
    console.warn(`[stripe-webhook] handleSubscriptionUpdated: no customer ID on event ${stripeEventId}`);
    return res.json({ received: true });
  }

  const org = await storage.getOrgByStripeCustomerId(customerId);
  if (!org) {
    console.warn(`[stripe-webhook] handleSubscriptionUpdated: no org for customer ${customerId}, event ${stripeEventId}`);
    return res.json({ received: true });
  }

  const status = subscription.status;
  const updates: Record<string, unknown> = {
    subscriptionStatus: status,
    stripeSubscriptionId: subscription.id,
  };

  const items = subscription.items?.data;
  if (items && items.length > 0) {
    const lookupKey = items[0].price?.lookup_key;
    if (lookupKey && PLAN_TIER_MAP[lookupKey]) {
      updates.planTier = PLAN_TIER_MAP[lookupKey].tier;
      updates.maxTeamMembers = PLAN_TIER_MAP[lookupKey].maxTeamMembers;
    }
  }

  if (status === "active" && org.planTier === "TRIAL") {
    if (!updates.planTier) {
      updates.planTier = "PROFESSIONAL";
    }
  }

  await storage.updateOrg(org.id, updates);

  // Task #392 — Re-derive marketing_os from the new tier+status. Tier
  // upgrades (PROFESSIONAL→BUSINESS) light it up; downgrades flip the
  // non-grandfathered active row off; grandfathered rows are untouched.
  await syncMarketingOsTierEntitlement(
    org.id,
    (updates.planTier as string | undefined) ?? org.planTier,
    status,
  );

  await storage.createStripeEvent({
    orgId: org.id, stripeEventId, type: eventType, livemode, created,
    status: "PROCESSED", failureCode: null, failureDetail: null,
  });

  await storage.createAuditLog({
    orgId: org.id,
    userId: null,
    action: "SUBSCRIPTION_UPDATED",
    entityType: "org",
    entityId: org.id,
    details: { status, planTier: updates.planTier || org.planTier },
  });

  return res.json({ received: true });
}

async function handleSubscriptionDeleted(
  res: any, event: any,
  stripeEventId: string, eventType: string, livemode: boolean, created: number,
) {
  const subscription = event.data?.object;
  const customerId = subscription?.customer;

  // Sprint 2j — guard: add-on-only sub deletion should NOT zero out planTier.
  try {
    const items = subscription?.items?.data;
    if (Array.isArray(items) && items.length > 0) {
      const allAddon = items.every((it: any) => {
        const pid = it?.price?.id;
        return typeof pid === "string" && isAddonPriceId(pid);
      });
      if (allAddon) {
        return res.json({ received: true, routed: "addon-guard" });
      }
    }
  } catch { /* best-effort guard */ }

  const org = customerId ? await storage.getOrgByStripeCustomerId(customerId) : null;

  if (org) {
    await storage.updateOrg(org.id, {
      planTier: "EXPIRED",
      subscriptionStatus: "canceled",
      stripeSubscriptionId: null,
    });

    // Task #392 — Final cancellation flips marketing_os off (unless a
    // grandfather row is still in-window, which sync intentionally leaves
    // alone so the legacy holder keeps access until grandfather_expires_at).
    await syncMarketingOsTierEntitlement(org.id, "EXPIRED", "canceled");

    await storage.createAuditLog({
      orgId: org.id,
      userId: null,
      action: "SUBSCRIPTION_CANCELED",
      entityType: "org",
      entityId: org.id,
      details: { reason: subscription.cancellation_details?.reason || "unknown" },
    });
  }

  if (org) {
    await storage.createStripeEvent({
      orgId: org.id, stripeEventId, type: eventType, livemode, created,
      status: "PROCESSED", failureCode: null, failureDetail: null,
    });
  } else {
    console.warn(`[stripe-webhook] handleSubscriptionDeleted: no org found, event ${stripeEventId}`);
  }

  return res.json({ received: true });
}

/**
 * Sprint 2j — Add-on subscription event handler. Upserts `org_entitlements`
 * rows for any add-on price IDs in the event. Strictly excludes any write
 * to `orgs.planTier` / `subscriptionStatus` / `stripeSubscriptionId` —
 * those belong to the base-plan handlers. Idempotent via `stripe_events`.
 */
async function handleAddonSubscriptionEvent(
  event: any,
  stripeEventId: string,
  eventType: string,
  livemode: boolean,
  created: number,
  addonPriceIds: string[],
  subscriptionId: string | null,
  resolvedOrgId: string | null,
  skipStripeEventInsert: boolean = false,
): Promise<void> {
  const obj = event.data?.object;
  const customerId = obj?.customer;

  // Org resolution: prefer the dispatcher's resolution (which can use
  // session.metadata.orgId), then fall back to customer→org lookup.
  let org = null as Awaited<ReturnType<typeof storage.getOrgByStripeCustomerId>> | null;
  if (resolvedOrgId) {
    org = await storage.getOrg(resolvedOrgId);
  }
  if (!org && customerId) {
    org = (await storage.getOrgByStripeCustomerId(customerId)) ?? null;
  }
  if (!org) {
    console.warn(`[addon-webhook] no org for customer ${customerId ?? "(none)"} event ${stripeEventId}`);
    return;
  }

  const status =
    eventType.startsWith("customer.subscription.") ? obj?.status : null;
  const subId = subscriptionId ?? (typeof obj?.subscription === "string" ? obj.subscription : obj?.id ?? null);

  // Resolve unique features (a sub may carry the same add-on twice in
  // theory; dedupe before iterating).
  const features = Array.from(
    new Set(
      addonPriceIds
        .map((pid) => getAddonFeatureForPrice(pid))
        .filter((f): f is AddonFeature => f !== null),
    ),
  );
  if (features.length === 0) {
    console.warn(`[addon-webhook] no recognized add-on features in event ${stripeEventId}`);
    return;
  }

  const now = new Date();
  for (const feature of features) {
    // Read existing row for past_due grace-window preservation.
    // `stripeSubscriptionId` is also pulled so the marketing_os branch can
    // detect the delayed-renewal-after-cleanup race (Task #392).
    const existingRows = await db
      .select({
        active: orgEntitlements.active,
        gracePeriodEndsAt: orgEntitlements.gracePeriodEndsAt,
        grandfatherExpiresAt: orgEntitlements.grandfatherExpiresAt,
        stripeSubscriptionId: orgEntitlements.stripeSubscriptionId,
      })
      .from(orgEntitlements)
      .where(
        and(
          eq(orgEntitlements.orgId, org.id),
          eq(orgEntitlements.feature, feature),
        ),
      )
      .limit(1);
    const existingGrace =
      existingRows[0]?.gracePeriodEndsAt instanceof Date
        ? existingRows[0].gracePeriodEndsAt
        : null;
    const existingGrandfather =
      existingRows[0]?.grandfatherExpiresAt instanceof Date
        ? existingRows[0].grandfatherExpiresAt
        : null;
    const existingStripeSubId =
      typeof existingRows[0]?.stripeSubscriptionId === "string" &&
      existingRows[0].stripeSubscriptionId.length > 0
        ? existingRows[0].stripeSubscriptionId
        : null;

    // ────────────────────────────────────────────────────────────────────
    // Task #392 — marketing_os is no longer a purchasable add-on. The legacy
    // Stripe SKU is preserved (not archived) so existing subscribers keep
    // billing through Stripe; the entitlement, however, is owned by the
    // tier-derivation logic. Inside this handler we therefore:
    //   • NEVER grant a fresh marketing_os row from add-on events.
    //   • Only EXTEND the grandfather window when an existing grandfather
    //     row sees a renewal (current_period_end on the sub object), so
    //     legacy holders keep paying access through their Stripe period.
    //   • On terminal cancellation, deactivate the grandfather hold.
    //   • Tier-derived rows (grandfather_expires_at IS NULL on a non-legacy
    //     org) are left strictly alone — that's the base handler's job.
    // ────────────────────────────────────────────────────────────────────
    if (feature === "marketing_os") {
      // Parse Stripe's `current_period_end` (Unix epoch seconds) once.
      // Missing / NaN / non-number → null; the pure helper treats that as
      // "no authoritative period boundary" and refuses to extend. We
      // deliberately do NOT fabricate a fallback window here (Task #392
      // post-review fix).
      const cpeRaw = obj?.current_period_end;
      const currentPeriodEnd: Date | null =
        typeof cpeRaw === "number" && Number.isFinite(cpeRaw)
          ? new Date(cpeRaw * 1000)
          : null;

      // Legacy subscription match → lets the helper re-extend a window
      // that cleanup/lazy-expire just cleared (Task #392 race fix).
      const legacySubscriptionMatch =
        existingStripeSubId !== null &&
        typeof subId === "string" &&
        subId.length > 0 &&
        existingStripeSubId === subId;

      const decision = computeMarketingOsGrandfatherTarget(
        eventType,
        status,
        existingGrandfather,
        currentPeriodEnd,
        legacySubscriptionMatch,
      );

      if (decision.action === "skip") {
        if (!existingGrandfather && !legacySubscriptionMatch) {
          console.log(
            `[addon-webhook] marketing_os ${eventType}/${status} ignored for org ${org.id}: tier-derived (no grandfather row)`,
          );
        } else {
          // Legacy row but no current_period_end → preserve and warn.
          console.warn(
            `[addon-webhook] marketing_os ${eventType}/${status} for org ${org.id}: existing grandfather preserved (no current_period_end on event ${stripeEventId})`,
          );
        }
        continue;
      }

      if (decision.action === "deactivate") {
        // Terminal cancellation: flip active off AND clear the grandfather
        // deadline so the UI never shows a contradictory "current access
        // ends <date>" notice for an already-canceled hold.
        await db
          .update(orgEntitlements)
          .set({
            active: false,
            grandfatherExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(orgEntitlements.orgId, org.id),
              eq(orgEntitlements.feature, "marketing_os"),
            ),
          );
        await storage.createAuditLog({
          orgId: org.id,
          userId: null,
          action: "ENTITLEMENT_FLIPPED",
          entityType: "org_entitlements",
          entityId: org.id,
          details: {
            feature: "marketing_os",
            active: false,
            reason: `grandfather-canceled:${eventType}`,
            stripeSubscriptionId: subId,
          },
        });
        continue;
      }

      // decision.action === "extend"
      await db
        .update(orgEntitlements)
        .set({
          // Keep active=true while the grandfather window is in-force; the
          // lazy-expire / cleanup job catches expiry. We do not touch
          // gracePeriodEndsAt here — grace is for paid add-ons, not
          // grandfather holds.
          active: true,
          grandfatherExpiresAt: decision.newGrandfather,
          stripeSubscriptionId: subId,
          updatedAt: now,
        })
        .where(
          and(
            eq(orgEntitlements.orgId, org.id),
            eq(orgEntitlements.feature, "marketing_os"),
          ),
        );

      await storage.createAuditLog({
        orgId: org.id,
        userId: null,
        action: "ENTITLEMENT_FLIPPED",
        entityType: "org_entitlements",
        entityId: org.id,
        details: {
          feature: "marketing_os",
          active: true,
          reason: `grandfather-extended:${eventType}`,
          grandfatherExpiresAt: decision.newGrandfather.toISOString(),
          stripeSubscriptionId: subId,
        },
      });
      continue;
    }

    const target = computeAddonTargetState(eventType, status, existingGrace, now);
    if (!target) {
      console.warn(
        `[addon-webhook] no target state for ${eventType}/${status} on ${feature} (event ${stripeEventId})`,
      );
      continue;
    }

    const insertVals: any = {
      orgId: org.id,
      feature,
      active: target.active,
      gracePeriodEndsAt: target.gracePeriodEndsAt,
      activatedAt: target.active ? now : null,
      stripeSubscriptionId: subId,
      updatedAt: now,
    };

    await db
      .insert(orgEntitlements)
      .values(insertVals)
      .onConflictDoUpdate({
        target: [orgEntitlements.orgId, orgEntitlements.feature],
        set: {
          active: target.active,
          gracePeriodEndsAt: target.gracePeriodEndsAt,
          activatedAt: target.active
            ? sql`COALESCE(${orgEntitlements.activatedAt}, ${now})`
            : orgEntitlements.activatedAt,
          stripeSubscriptionId: subId,
          updatedAt: now,
        },
      });

    await storage.createAuditLog({
      orgId: org.id,
      userId: null,
      action: "ENTITLEMENT_FLIPPED",
      entityType: "org_entitlements",
      entityId: org.id,
      details: {
        feature,
        active: target.active,
        stripeSubscriptionId: subId,
        reason: eventType,
        gracePeriodEndsAt: target.gracePeriodEndsAt
          ? target.gracePeriodEndsAt.toISOString()
          : null,
      },
    });
  }

  if (!skipStripeEventInsert) {
    try {
      await storage.createStripeEvent({
        orgId: org.id,
        stripeEventId,
        type: eventType,
        livemode,
        created,
        status: "PROCESSED",
        failureCode: null,
        failureDetail: null,
      });
    } catch (err: any) {
      if (!isUniqueViolation(err)) {
        console.error(`[addon-webhook] createStripeEvent failed: ${err?.message ?? err}`);
      }
    }
  }
}

async function handleSubscriptionTrialWillEnd(
  res: any, event: any,
  stripeEventId: string, eventType: string, livemode: boolean, created: number,
) {
  const subscription = event.data?.object;
  const customerId = subscription?.customer;

  const org = customerId ? await storage.getOrgByStripeCustomerId(customerId) : null;

  if (org) {
    const adminUsers = await db.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.orgId, org.id), eq(users.role, "ADMIN"))).limit(1);
    const adminEmail = adminUsers[0]?.email || "unknown";

    await storage.createAuditLog({
      orgId: org.id,
      userId: null,
      action: "TRIAL_ENDING_SOON",
      entityType: "org",
      entityId: org.id,
      details: { daysRemaining: 3, subscriptionId: subscription?.id },
    });

    console.info(`[stripe-webhook] Trial ending soon for org ${org.id} (admin: ${adminEmail}), subscription ${subscription?.id}`);

    await storage.createStripeEvent({
      orgId: org.id, stripeEventId, type: eventType, livemode, created,
      status: "PROCESSED", failureCode: null, failureDetail: null,
    });
  } else {
    console.warn(`[stripe-webhook] handleSubscriptionTrialWillEnd: no org found, event ${stripeEventId}`);
  }

  return res.json({ received: true });
}

async function handleInvoicePaymentSucceeded(
  res: any, event: any,
  stripeEventId: string, eventType: string, livemode: boolean, created: number,
) {
  const invoice = event.data?.object;
  const customerId = invoice?.customer;
  const subscriptionId = invoice?.subscription;

  const resolvedOrg = customerId ? await storage.getOrgByStripeCustomerId(customerId) : null;

  if (!subscriptionId) {
    if (resolvedOrg) {
      await storage.createStripeEvent({
        orgId: resolvedOrg.id, stripeEventId, type: eventType, livemode, created,
        status: "IGNORED", failureCode: null, failureDetail: "Not a subscription invoice",
      });
    } else {
      console.warn(`[stripe-webhook] handleInvoicePaymentSucceeded: non-subscription invoice, no org, event ${stripeEventId}`);
    }
    return res.json({ received: true });
  }

  if (resolvedOrg) {
    await storage.updateOrg(resolvedOrg.id, {
      subscriptionStatus: "active",
    });

    // Task #392 — Recovery from past_due → active should re-grant
    // marketing_os if the org is on a tier that auto-grants it.
    await syncMarketingOsTierEntitlement(
      resolvedOrg.id,
      resolvedOrg.planTier,
      "active",
    );

    await storage.createAuditLog({
      orgId: resolvedOrg.id,
      userId: null,
      action: "SUBSCRIPTION_PAYMENT_SUCCEEDED",
      entityType: "org",
      entityId: resolvedOrg.id,
      details: { amountPaid: invoice.amount_paid, invoiceId: invoice.id },
    });

    await storage.createStripeEvent({
      orgId: resolvedOrg.id, stripeEventId, type: eventType, livemode, created,
      status: "PROCESSED", failureCode: null, failureDetail: null,
    });
  } else {
    console.warn(`[stripe-webhook] handleInvoicePaymentSucceeded: no org for customer ${customerId}, event ${stripeEventId}`);
  }

  return res.json({ received: true });
}

async function handleInvoicePaymentFailed(
  res: any, event: any,
  stripeEventId: string, eventType: string, livemode: boolean, created: number,
) {
  const invoice = event.data?.object;
  const customerId = invoice?.customer;
  const subscriptionId = invoice?.subscription;

  const resolvedOrg = customerId ? await storage.getOrgByStripeCustomerId(customerId) : null;

  if (!subscriptionId) {
    if (resolvedOrg) {
      await storage.createStripeEvent({
        orgId: resolvedOrg.id, stripeEventId, type: eventType, livemode, created,
        status: "IGNORED", failureCode: null, failureDetail: "Not a subscription invoice",
      });
    } else {
      console.warn(`[stripe-webhook] handleInvoicePaymentFailed: non-subscription invoice, no org, event ${stripeEventId}`);
    }
    return res.json({ received: true });
  }

  if (resolvedOrg) {
    await storage.updateOrg(resolvedOrg.id, {
      subscriptionStatus: "past_due",
    });

    // Task #392 — past_due is in MARKETING_OS_HEALTHY_STATUSES, so the
    // sync is a no-op for active grants but defensively keeps the row
    // shape current if a previous downgrade had flipped it off.
    await syncMarketingOsTierEntitlement(
      resolvedOrg.id,
      resolvedOrg.planTier,
      "past_due",
    );

    await storage.createAuditLog({
      orgId: resolvedOrg.id,
      userId: null,
      action: "SUBSCRIPTION_PAYMENT_FAILED",
      entityType: "org",
      entityId: resolvedOrg.id,
      details: { attemptCount: invoice.attempt_count, nextAttempt: invoice.next_payment_attempt },
    });

    await storage.createStripeEvent({
      orgId: resolvedOrg.id, stripeEventId, type: eventType, livemode, created,
      status: "PROCESSED", failureCode: null, failureDetail: null,
    });
  } else {
    console.warn(`[stripe-webhook] handleInvoicePaymentFailed: no org for customer ${customerId}, event ${stripeEventId}`);
  }

  return res.json({ received: true });
}

async function handleInvoiceCheckoutCompleted(
  res: any,
  event: any,
  stripeEventId: string,
  eventType: string,
  livemode: boolean,
  created: number,
) {
  const session = event.data?.object;
  const publicToken = session?.metadata?.publicToken;

  if (!publicToken) {
    const fallbackOrgId = session?.customer ? (await storage.getOrgByStripeCustomerId(session.customer))?.id : null;
    if (fallbackOrgId) {
      await storage.createStripeEvent({
        orgId: fallbackOrgId,
        stripeEventId,
        type: eventType,
        livemode,
        created,
        status: "FAILED",
        failureCode: "MISSING_METADATA",
        failureDetail: "publicToken not found in session metadata",
      });
    } else {
      console.warn(`[stripe-webhook] handleInvoiceCheckoutCompleted: missing publicToken, no org resolvable, event ${stripeEventId}`);
    }
    return res.json({ received: true });
  }

  const invoice = await storage.getInvoiceByPublicToken(publicToken);
  if (!invoice) {
    const fallbackOrgId = session?.customer ? (await storage.getOrgByStripeCustomerId(session.customer))?.id : null;
    if (fallbackOrgId) {
      await storage.createStripeEvent({
        orgId: fallbackOrgId,
        stripeEventId,
        type: eventType,
        livemode,
        created,
        status: "FAILED",
        failureCode: "INVOICE_NOT_FOUND",
        failureDetail: "No invoice found for publicToken",
      });
    } else {
      console.warn(`[stripe-webhook] handleInvoiceCheckoutCompleted: invoice not found, no org resolvable, event ${stripeEventId}`);
    }
    return res.json({ received: true });
  }

  const providerRef = session.payment_intent || session.id;

  const existingPayment = await storage.getPaymentByProviderRef("STRIPE", providerRef, invoice.orgId);
  if (existingPayment) {
    await storage.createStripeEvent({
      orgId: invoice.orgId,
      stripeEventId,
      type: eventType,
      livemode,
      created,
      status: "PROCESSED",
      failureCode: null,
      failureDetail: null,
    });
    return res.json({ received: true, duplicate: true });
  }

  const sessionCurrency = (session.currency || "").toUpperCase();
  const invoiceCurrency = (invoice.currency || "USD").toUpperCase();
  if (sessionCurrency && invoiceCurrency && sessionCurrency !== invoiceCurrency) {
    console.warn(`[stripe-webhook] Currency mismatch: session ${sessionCurrency} vs invoice ${invoiceCurrency}, event ${stripeEventId} — skipping auto-reconciliation`);
    await storage.createStripeEvent({
      orgId: invoice.orgId,
      stripeEventId,
      type: eventType,
      livemode,
      created,
      status: "FAILED",
      failureCode: "CURRENCY_MISMATCH",
      failureDetail: `Session currency ${sessionCurrency} does not match invoice currency ${invoiceCurrency}`,
    });
    await storage.createAuditLog({
      orgId: invoice.orgId,
      userId: null,
      action: "STRIPE_EVENT_FAILED",
      entityType: "stripe_event",
      entityId: stripeEventId,
      details: { failureCode: "CURRENCY_MISMATCH", sessionCurrency, invoiceCurrency },
    });
    return res.json({ received: true });
  }

  const amountCents = session.amount_total ?? 0;
  const amount = round2(amountCents / 100);

  const invoiceTotal = Number(invoice.total);
  const currentPaid = Number(invoice.paidAmount);
  const newPaid = round2(currentPaid + amount);

  if (newPaid > invoiceTotal) {
    await storage.createStripeEvent({
      orgId: invoice.orgId,
      stripeEventId,
      type: eventType,
      livemode,
      created,
      status: "FAILED",
      failureCode: "OVERPAYMENT",
      failureDetail: `Payment of ${amount} would exceed total ${invoiceTotal} (current paid: ${currentPaid})`,
    });
    await storage.createAuditLog({
      orgId: invoice.orgId,
      userId: null,
      action: "STRIPE_EVENT_FAILED",
      entityType: "stripe_event",
      entityId: stripeEventId,
      details: { failureCode: "OVERPAYMENT", amount, invoiceTotal, currentPaid },
    });
    return res.json({ received: true });
  }

  const todayStr = new Date().toISOString().split("T")[0];
  let paymentMethodLabel = "STRIPE";
  try {
    if (session.payment_intent) {
      const Stripe = (await import("stripe")).default;
      if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
      if (pi.payment_method && typeof pi.payment_method === "string") {
        const pm = await stripe.paymentMethods.retrieve(pi.payment_method);
        if (pm.type === "us_bank_account") {
          paymentMethodLabel = "BANK_TRANSFER";
        } else if (pm.type === "card") {
          paymentMethodLabel = "STRIPE";
        }
      }
    }
  } catch { /* fallback to STRIPE */ }

  // Coverage note (audit #20): the under-lock OVERPAYMENT branch below is reachable
  // only under a genuine concurrent commit (the recheck reads the same paid_amount
  // the pre-tx guard read, so they diverge only when another payment commits in the
  // gap) — it is proven at the storage layer by the concurrent test in
  // tests/integration/stripe-payment-overpayment-recheck.test.ts. The deterministic
  // sequential overpayment is caught by the pre-tx guard above. A webhook-level
  // integration test is blocked on the pool-starvation fixme in e2e/stripe-webhook.spec.ts.
  try {
    const stripePayment = await db.transaction(async (tx) => {
      await tx.insert(stripeEvents).values({
        orgId: invoice.orgId,
        stripeEventId,
        type: eventType,
        livemode,
        created,
        status: "PROCESSED",
        failureCode: null,
        failureDetail: null,
      });

      // Run createStripePayment on THIS transaction (audit #8/#14, #20): the
      // invoice FOR UPDATE lock, the overpayment re-check, the payment insert and
      // the paid-status recompute all execute on the same connection as the
      // stripe_events insert above — one atomic unit. The under-lock re-check is
      // the authoritative backstop for the overpayment race that the pre-tx guard
      // (read of an UNLOCKED paidAmount, above) cannot close.
      const result = await storage.createStripePayment({
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        amount: round2(amount).toFixed(2),
        date: todayStr,
        method: paymentMethodLabel,
        provider: "STRIPE",
        providerRef,
        notes: `Stripe checkout ${session.id}${paymentMethodLabel === "BANK_TRANSFER" ? " (ACH bank transfer)" : ""}`,
      }, tx);

      if (result.status !== "OK") {
        // Roll the whole tx back (drops the PROCESSED stripe_events row) and carry
        // the outcome out so we can record a terminal FAILED event below — outside
        // this doomed transaction.
        throw new CheckoutTxRollback(result);
      }

      return result.payment;
    });

    const periodClosed = await storage.isDateInClosedPeriod(invoice.orgId, todayStr);
    if (periodClosed) {
      console.warn(`[stripe-webhook] GL auto-post skipped: period closed for date ${todayStr}, event ${stripeEventId}`);
      try {
        await storage.updatePayment(stripePayment.id, invoice.orgId, {
          notes: `${stripePayment.notes || ""} | GL auto-post skipped: period closed`.trim(),
        });
      } catch {}
    } else {
      try {
        const pmtAmt = round2(amount).toFixed(2);
        await createAutoJournalEntry(invoice.orgId, todayStr, `Stripe Payment on Invoice ${invoice.number}`, "PAYMENT", stripePayment.id, [
          { accountNumber: "1000", debit: pmtAmt, credit: "0.00", memo: "Cash received (Stripe)" },
          { accountNumber: "1200", debit: "0.00", credit: pmtAmt, memo: "Accounts Receivable reduced" },
        ], null);
      } catch (glErr) {
        console.error("[stripe-webhook] GL auto-post failed:", glErr);
      }
    }

    await storage.createAuditLog({
      orgId: invoice.orgId,
      userId: null,
      action: "STRIPE_PAYMENT_APPLIED",
      entityType: "invoice",
      entityId: invoice.id,
      details: { amount, providerRef },
    });
  } catch (txErr: any) {
    if (txErr instanceof CheckoutTxRollback) {
      // The transaction rolled back, so no payment and no PROCESSED event row
      // persisted. Record a terminal FAILED event + audit and return 200 — a 500
      // would make Stripe redeliver this deterministically-failing event for up to
      // 3 days.
      const outcome = txErr.outcome;
      if (outcome.status === "OVERPAYMENT") {
        await storage.createStripeEvent({
          orgId: invoice.orgId,
          stripeEventId,
          type: eventType,
          livemode,
          created,
          status: "FAILED",
          failureCode: "OVERPAYMENT",
          failureDetail: `Payment of ${outcome.attempted} would exceed total ${outcome.invoiceTotal} (paid under lock: ${outcome.currentPaid})`,
        });
        await storage.createAuditLog({
          orgId: invoice.orgId,
          userId: null,
          action: "STRIPE_EVENT_FAILED",
          entityType: "stripe_event",
          entityId: stripeEventId,
          details: { failureCode: "OVERPAYMENT", amount: outcome.attempted, invoiceTotal: outcome.invoiceTotal, currentPaid: outcome.currentPaid, race: true },
        });
      } else {
        // INVOICE_NOT_FOUND: the invoice was deleted between the unlocked read and
        // the locked re-read. Nothing actionable; record and ack.
        await storage.createStripeEvent({
          orgId: invoice.orgId,
          stripeEventId,
          type: eventType,
          livemode,
          created,
          status: "FAILED",
          failureCode: "INVOICE_NOT_FOUND",
          failureDetail: "Invoice not found under lock (deleted mid-flight)",
        });
      }
      return res.json({ received: true });
    }
    if (isUniqueViolation(txErr)) {
      return res.json({ received: true, duplicate: true });
    }
    throw txErr;
  }

  return res.json({ received: true });
}

async function handleChargeRefunded(
  res: any,
  event: any,
  stripeEventId: string,
  eventType: string,
  livemode: boolean,
  created: number,
) {
  const charge = event.data?.object;
  const publicToken = charge?.metadata?.publicToken;

  if (!publicToken) {
    const fallbackOrgId = charge?.customer ? (await storage.getOrgByStripeCustomerId(charge.customer))?.id : null;
    if (fallbackOrgId) {
      await storage.createStripeEvent({
        orgId: fallbackOrgId,
        stripeEventId,
        type: eventType,
        livemode,
        created,
        status: "FAILED",
        failureCode: "MISSING_METADATA",
        failureDetail: "publicToken not found in charge metadata",
      });
    } else {
      console.warn(`[stripe-webhook] handleChargeRefunded: missing publicToken, no org resolvable, event ${stripeEventId}`);
    }
    return res.json({ received: true });
  }

  const invoice = await storage.getInvoiceByPublicToken(publicToken);
  if (!invoice) {
    const fallbackOrgId = charge?.customer ? (await storage.getOrgByStripeCustomerId(charge.customer))?.id : null;
    if (fallbackOrgId) {
      await storage.createStripeEvent({
        orgId: fallbackOrgId,
        stripeEventId,
        type: eventType,
        livemode,
        created,
        status: "FAILED",
        failureCode: "INVOICE_NOT_FOUND",
        failureDetail: "No invoice found for publicToken",
      });
    } else {
      console.warn(`[stripe-webhook] handleChargeRefunded: invoice not found, no org resolvable, event ${stripeEventId}`);
    }
    return res.json({ received: true });
  }

  const refunds: any[] = charge.refunds?.data || [];
  const latestRefund = refunds.length > 0
    ? refunds.reduce((latest: any, r: any) => (r.created > latest.created ? r : latest), refunds[0])
    : null;

  const refundAmountCents = latestRefund?.amount ?? charge.amount_refunded ?? 0;
  const refundAmount = round2(refundAmountCents / 100);
  const originalAmountCents = charge.amount ?? 0;
  const originalAmount = round2(originalAmountCents / 100);

  if (refundAmount <= 0 || refundAmount > originalAmount) {
    await storage.createStripeEvent({
      orgId: invoice.orgId,
      stripeEventId,
      type: eventType,
      livemode,
      created,
      status: "FAILED",
      failureCode: "INVALID_REFUND_AMOUNT",
      failureDetail: `Refund amount ${refundAmount} exceeds original payment ${originalAmount}`,
    });
    console.warn(`[stripe-webhook] handleChargeRefunded: refund ${refundAmount} exceeds original ${originalAmount}, event ${stripeEventId}`);
    return res.json({ received: true });
  }

  const refundId = latestRefund?.id || stripeEventId;
  const providerRef = `refund_${charge.id}_${refundId}`;

  const existingRefund = await storage.getPaymentByProviderRef("STRIPE", providerRef, invoice.orgId);
  if (existingRefund) {
    await storage.createStripeEvent({
      orgId: invoice.orgId,
      stripeEventId,
      type: eventType,
      livemode,
      created,
      status: "PROCESSED",
      failureCode: null,
      failureDetail: null,
    });
    return res.json({ received: true, duplicate: true });
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const refundResult = await storage.createRefundPaymentAtomic(
    {
      orgId: invoice.orgId,
      invoiceId: invoice.id,
      amount: round2(-refundAmount).toFixed(2),
      date: todayStr,
      method: "Stripe Refund",
      provider: "STRIPE",
      providerRef,
      notes: `Stripe refund on charge ${charge.id}`,
    },
    invoice.id,
    invoice.orgId,
    refundAmount,
  );

  if (!refundResult.success) {
    await storage.createStripeEvent({
      orgId: invoice.orgId,
      stripeEventId,
      type: eventType,
      livemode,
      created,
      status: "FAILED",
      failureCode: refundResult.reason || "REFUND_FAILED",
      failureDetail: `Atomic refund check failed: ${refundResult.reason}`,
    });
    await storage.createAuditLog({
      orgId: invoice.orgId,
      userId: null,
      action: "STRIPE_EVENT_FAILED",
      entityType: "stripe_event",
      entityId: stripeEventId,
      details: { failureCode: refundResult.reason, refundAmount },
    });
    console.warn(`[stripe-webhook] handleChargeRefunded: atomic refund rejected (${refundResult.reason}), event ${stripeEventId}`);
    return res.json({ received: true });
  }

  await storage.recomputeInvoicePaidStatus(invoice.id, invoice.orgId);

  await storage.createStripeEvent({
    orgId: invoice.orgId,
    stripeEventId,
    type: eventType,
    livemode,
    created,
    status: "PROCESSED",
    failureCode: null,
    failureDetail: null,
  });

  await storage.createAuditLog({
    orgId: invoice.orgId,
    userId: null,
    action: "STRIPE_REFUND_APPLIED",
    entityType: "invoice",
    entityId: invoice.id,
    details: { amount: refundAmount, providerRef },
  });

  return res.json({ received: true });
}

async function handleConnectAccountUpdated(
  res: any,
  event: any,
  stripeEventId: string,
  eventType: string,
  livemode: boolean,
  created: number,
) {
  const account = event.data?.object;
  if (!account?.id) {
    return res.json({ received: true });
  }

  const stripeAccountId = account.id as string;
  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const detailsSubmitted = !!account.details_submitted;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.stripeConnectAccountId, stripeAccountId))
    .limit(1);

  if (!user) {
    console.warn(`[stripe-webhook] handleConnectAccountUpdated: no user for Connect account ${stripeAccountId}, event ${stripeEventId}`);
    return res.json({ received: true });
  }

  const disabledReason = account.requirements?.disabled_reason;
  let newStatus: typeof user.stripeConnectStatus;
  if (disabledReason || (!chargesEnabled && detailsSubmitted && user.stripeConnectStatus === "ACTIVE")) {
    newStatus = "SUSPENDED";
  } else if (chargesEnabled && payoutsEnabled) {
    newStatus = "ACTIVE";
  } else if (detailsSubmitted) {
    newStatus = "ONBOARDING_COMPLETE";
  } else {
    newStatus = "ONBOARDING_STARTED";
  }

  if (newStatus !== user.stripeConnectStatus) {
    await storage.updateUser(user.id, user.orgId, { stripeConnectStatus: newStatus });
    await storage.createAuditLog({
      orgId: user.orgId,
      userId: null,
      action: "STRIPE_CONNECT_STATUS_UPDATED",
      entityType: "user",
      entityId: user.id,
      details: { previousStatus: user.stripeConnectStatus, newStatus, stripeAccountId },
    });
  }

  await storage.createStripeEvent({
    orgId: user.orgId,
    stripeEventId,
    type: eventType,
    livemode,
    created,
    status: "PROCESSED",
    failureCode: null,
    failureDetail: null,
  });

  return res.json({ received: true });
}

async function handleTransferEvent(
  res: any,
  event: any,
  stripeEventId: string,
  eventType: string,
  livemode: boolean,
  created: number,
) {
  const transfer = event.data?.object;
  if (!transfer?.id) {
    return res.json({ received: true });
  }

  const transferId = transfer.id as string;
  const isFailed = eventType === "transfer.failed";

  const [payout] = await db
    .select()
    .from(teamMemberPayoutsV2)
    .where(eq(teamMemberPayoutsV2.stripeTransferId, transferId))
    .limit(1);

  if (!payout) {
    console.warn(`[stripe-webhook] handleTransferEvent: no payout found for transfer event ${stripeEventId}`);
    return res.json({ received: true });
  }

  const [ownerOrg] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, payout.orgId)).limit(1);
  if (!ownerOrg) {
    console.warn(`[stripe-webhook] handleTransferEvent: payout org not found for event ${stripeEventId}`);
    return res.json({ received: true });
  }

  const newTransferStatus = isFailed ? "failed" : "paid";
  const newPayoutStatus = isFailed ? "VOID" : "COMPLETED";

  await storage.updateTeamMemberPayout(payout.id, payout.orgId, {
    stripeTransferStatus: newTransferStatus,
    status: newPayoutStatus,
  });

  await storage.createAuditLog({
    orgId: payout.orgId,
    userId: null,
    action: isFailed ? "STRIPE_CONNECT_TRANSFER_FAILED" : "STRIPE_CONNECT_TRANSFER_COMPLETED",
    entityType: "payout",
    entityId: payout.id,
    details: { transferId, status: newTransferStatus },
  });

  await storage.createStripeEvent({
    orgId: payout.orgId,
    stripeEventId,
    type: eventType,
    livemode,
    created,
    status: "PROCESSED",
    failureCode: null,
    failureDetail: null,
  });

  return res.json({ received: true });
}
