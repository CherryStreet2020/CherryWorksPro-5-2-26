/**
 * Sprint 2j — POST /api/entitlements/:feature/checkout
 *
 * Authenticated session creates a Stripe subscription Checkout for one of
 * the three paid add-ons (marketing_os, multi_brand, hubspot_bridge). The
 * resulting webhook flips `org_entitlements.<feature>.active = true`. PSO
 * core is base-tier and is intentionally NOT purchasable here.
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { users } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth, sanitizeErrorMessage } from "./middleware";
import {
  ADDON_FEATURES,
  getAddonPriceId,
  isFeatureAvailable,
  type AddonFeature,
} from "../stripe-addon-prices";

function isAddonFeature(value: string): value is AddonFeature {
  return (ADDON_FEATURES as string[]).includes(value);
}

function appBaseUrl(req: Request): string {
  const fromEnv = process.env.APP_BASE_URL || process.env.BASE_URL;
  const raw = fromEnv && fromEnv.length > 0
    ? fromEnv
    : `${req.protocol}://${req.get("host")}`;
  return raw.replace(/\/$/, "");
}

export function registerEntitlementCheckoutRoutes(app: Express): void {
  app.post(
    "/api/entitlements/:feature/checkout",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const featureParam = req.params.feature;
        if (typeof featureParam !== "string") {
          return res.status(400).json({ error: "Unknown feature" });
        }

        // Task #392 — marketing_os is no longer a purchasable add-on. The
        // entitlement is now derived from the org's base plan tier
        // (BUSINESS or ENTERPRISE). The legacy Stripe SKU is preserved so
        // grandfathered subscriptions keep billing through Stripe, but
        // *new* checkout attempts must hard-stop here. We check this
        // BEFORE the `isAddonFeature` gate because marketing_os was
        // removed from `ADDON_FEATURES` (now lives in
        // `RETIRED_ADDON_FEATURES`); without this early-return a POST for
        // marketing_os would 400 with a generic "Unknown feature" instead
        // of the actionable 410 + upgradePath the client helper expects.
        if (featureParam === "marketing_os") {
          return res.status(410).json({
            error:
              "Marketing OS is no longer a standalone add-on. It's included with the Business and Enterprise plans.",
            upgradePath: "/settings/billing",
            code: "MARKETING_OS_TIER_DERIVED",
          });
        }

        if (!isAddonFeature(featureParam)) {
          return res.status(400).json({ error: "Unknown feature" });
        }
        const feature: AddonFeature = featureParam;

        if (!isFeatureAvailable(feature)) {
          return res
            .status(400)
            .json({ error: "Add-on not available in this environment" });
        }

        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return res.status(503).json({ error: "Stripe not configured" });
        }

        const orgId = req.session.orgId!;
        const userId = req.session.userId!;
        const org = await storage.getOrg(orgId);
        if (!org) {
          return res.status(500).json({ error: "Org not found" });
        }

        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(stripeKey);

        // Ensure a Stripe Customer exists for this org.
        let stripeCustomerId = org.stripeCustomerId ?? null;
        if (!stripeCustomerId) {
          // Find the requesting user's email (or fall back to org name).
          const me = await storage.getUserById(userId);
          const adminRow = await db
            .select({ email: users.email })
            .from(users)
            .where(and(eq(users.orgId, orgId), eq(users.role, "ADMIN")))
            .limit(1);
          const customerEmail = me?.email ?? adminRow[0]?.email ?? undefined;
          const customer = await stripe.customers.create({
            email: customerEmail,
            name: org.name,
            metadata: { orgId: org.id },
          });
          stripeCustomerId = customer.id;
          await storage.updateOrg(org.id, { stripeCustomerId });
        }

        const priceId = getAddonPriceId(feature);
        if (!priceId) {
          return res
            .status(400)
            .json({ error: "Add-on not available in this environment" });
        }

        const base = appBaseUrl(req);
        const session = await stripe.checkout.sessions.create(
          {
            mode: "subscription",
            line_items: [{ price: priceId, quantity: 1 }],
            customer: stripeCustomerId,
            success_url: `${base}/settings/billing?addon=${feature}&status=success`,
            cancel_url: `${base}/settings/billing?addon=${feature}&status=cancel`,
            metadata: { orgId: org.id, feature, kind: "addon" },
            subscription_data: {
              metadata: { orgId: org.id, feature, kind: "addon" },
            },
          },
          {
            idempotencyKey: `addon-checkout-${org.id}-${feature}-${Date.now()}`,
          },
        );

        await storage.createAuditLog({
          orgId: org.id,
          userId,
          action: "ADDON_CHECKOUT_INITIATED",
          entityType: "org",
          entityId: org.id,
          details: { feature, sessionId: session.id },
        });

        return res.json({ url: session.url, sessionId: session.id });
      } catch (err: any) {
        console.error("[addon-checkout] failed:", err?.message ?? err);
        return res.status(500).json({ error: sanitizeErrorMessage(err) });
      }
    },
  );
}
