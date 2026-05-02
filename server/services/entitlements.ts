/**
 * Sprint 2i.2 — EntitlementService + requireFeature middleware.
 *
 * Single source of truth for "does this org have this feature?". Every
 * marketing API route is wrapped with `requireFeature('marketing_os')` so
 * non-entitled orgs see a generic 404 — never 403, never any "you don't
 * have access" hint. This is what makes Marketing OS truly invisible to
 * PSO-only tenants.
 *
 * Per-request cache: regardless of how many `hasFeature` calls happen on a
 * single request, AT MOST ONE entitlement DB query fires. The cache is
 * scoped to the request via AsyncLocalStorage so the public API stays
 * `(orgId, feature)` without threading `req` everywhere.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { and, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  orgEntitlements,
  orgs,
  ORG_ENTITLEMENT_FEATURES,
  type OrgEntitlementFeature,
} from "@shared/schema";
import { storage } from "../storage";
import { marketingOsActiveFromTier } from "./marketing-os-tier";

export type EntitlementMap = Record<OrgEntitlementFeature, boolean>;

type RequestStore = { cache: Map<string, Promise<EntitlementMap>> };
const requestStorage = new AsyncLocalStorage<RequestStore>();

const DEBUG_QUERY_COUNT = process.env.ENTITLEMENT_DEBUG_QUERY_COUNT === "true";

function emptyMap(): EntitlementMap {
  return ORG_ENTITLEMENT_FEATURES.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as EntitlementMap);
}

/**
 * Sprint 2j — Lazy-flip an expired-grace row before returning. Fire-and-forget
 * so the read response isn't delayed. The WHERE-clause double-checks the
 * expired condition to guard against a concurrent webhook flipping the row
 * back to active in the same window (lost-update protection).
 */
function lazyExpire(orgId: string, feature: OrgEntitlementFeature): void {
  void db
    .update(orgEntitlements)
    .set({ active: false, gracePeriodEndsAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(orgEntitlements.orgId, orgId),
        eq(orgEntitlements.feature, feature),
        eq(orgEntitlements.active, true),
        isNotNull(orgEntitlements.gracePeriodEndsAt),
        lt(orgEntitlements.gracePeriodEndsAt, new Date()),
      ),
    )
    .then(() => {
      console.log(`[entitlements] lazy-expired ${feature} for org ${orgId}`);
    })
    .catch((err) => {
      console.error(
        `[entitlements] lazy-expire failed for org=${orgId} feature=${feature}:`,
        (err as Error).message,
      );
    });
}

/**
 * Task #392 — Lazy-flip an expired-grandfather marketing_os row. Mirrors
 * `lazyExpire` for the grace window. Fire-and-forget; the WHERE clause
 * re-checks the expired condition to protect against a concurrent
 * webhook extending the grandfather window in the same instant.
 */
function lazyExpireGrandfather(orgId: string): void {
  void db
    .update(orgEntitlements)
    // Clear grandfather_expires_at alongside the active flip so the
    // settings UI never shows a "current access ends <date>" notice for
    // a window that has already elapsed (mirrors the terminal-cancel path
    // in handleAddonSubscriptionEvent — Task #392 post-review fix).
    .set({
      active: false,
      grandfatherExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orgEntitlements.orgId, orgId),
        eq(orgEntitlements.feature, "marketing_os"),
        eq(orgEntitlements.active, true),
        isNotNull(orgEntitlements.grandfatherExpiresAt),
        lt(orgEntitlements.grandfatherExpiresAt, new Date()),
      ),
    )
    .then(() => {
      console.log(
        `[entitlements] lazy-expired grandfathered marketing_os for org ${orgId}`,
      );
    })
    .catch((err) => {
      console.error(
        `[entitlements] grandfather lazy-expire failed for org=${orgId}:`,
        (err as Error).message,
      );
    });
}

/**
 * Task #392 — Fetch the org's tier-derived inputs once per call. The
 * orgs table is the source of truth for plan_tier / subscription_status.
 * Returns null when the org row is missing (the caller treats that as
 * "no tier-derived grants").
 */
async function loadTierInputs(
  orgId: string,
): Promise<{ planTier: string; subscriptionStatus: string } | null> {
  const row = await db
    .select({
      planTier: orgs.planTier,
      subscriptionStatus: orgs.subscriptionStatus,
    })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (row.length === 0) return null;
  return {
    planTier: row[0].planTier ?? "",
    subscriptionStatus: row[0].subscriptionStatus ?? "",
  };
}

async function fetchEntitlementMap(orgId: string): Promise<EntitlementMap> {
  if (DEBUG_QUERY_COUNT) {
    console.log(`[entitlements] DB query for org=${orgId}`);
  }
  // Task #392 — load entitlement rows + the org's tier inputs in parallel
  // so the marketing_os overlay below can OR in the tier-derived branch
  // without a serialized second round trip.
  const [rows, tierInputs] = await Promise.all([
    db
      .select({
        feature: orgEntitlements.feature,
        active: orgEntitlements.active,
        gracePeriodEndsAt: orgEntitlements.gracePeriodEndsAt,
        grandfatherExpiresAt: orgEntitlements.grandfatherExpiresAt,
      })
      .from(orgEntitlements)
      .where(eq(orgEntitlements.orgId, orgId)),
    loadTierInputs(orgId),
  ]);
  const map = emptyMap();
  const now = Date.now();
  for (const row of rows) {
    const feature = row.feature as OrgEntitlementFeature;
    const graceEnds =
      row.gracePeriodEndsAt instanceof Date
        ? row.gracePeriodEndsAt.getTime()
        : null;
    const inGrace = graceEnds !== null && graceEnds > now;
    const graceExpired = graceEnds !== null && graceEnds <= now;
    // Task #392 — A grandfathered marketing_os row's authority over the
    // active flag is its `grandfather_expires_at`, NOT the grace window.
    // The webhook seeds `gracePeriodEndsAt` for past_due tier-derived
    // rows, so a legacy add-on holder on Starter/Professional could end
    // up with BOTH (a future grandfather AND an elapsed grace) — without
    // this guard the elapsed grace would lazy-expire the row and revoke
    // access before the renewal date the customer was promised.
    const isMarketing = feature === "marketing_os";
    const grandEnds =
      isMarketing && row.grandfatherExpiresAt instanceof Date
        ? row.grandfatherExpiresAt.getTime()
        : null;
    const grandfatherActive = grandEnds !== null && grandEnds > now;
    if (row.active && graceExpired && !grandfatherActive) {
      // Expired grace on an active row → effective inactive + persist flip.
      lazyExpire(orgId, feature);
      continue;
    }
    if (isMarketing && row.active && grandEnds !== null && grandEnds <= now) {
      // Grandfather lazy-expire mirrors grace lazy-expire: an active row
      // whose grandfather window has elapsed counts as inactive AND we
      // persist the flip so admin tooling agrees with the read view.
      lazyExpireGrandfather(orgId);
      continue;
    }
    if (row.active || inGrace || grandfatherActive) {
      map[feature] = true;
    }
  }
  // Task #392 — Tier-derived overlay for marketing_os. Always OR'd in
  // last so a healthy BUSINESS/ENTERPRISE org sees marketing_os = true
  // even if no row exists yet (the webhook hook lags the read path on
  // first sub.created). For `past_due` we pass the persisted
  // gracePeriodEndsAt from the row so the bounded 7-day grace is
  // enforced; if the row doesn't exist yet (race with webhook), the
  // predicate treats past_due as inactive — the upcoming write hook
  // will seed grace and the next read picks it up.
  if (tierInputs) {
    const marketingRow = rows.find((r) => r.feature === "marketing_os");
    if (
      marketingOsActiveFromTier(
        tierInputs.planTier,
        tierInputs.subscriptionStatus,
        marketingRow?.gracePeriodEndsAt ?? null,
      )
    ) {
      map["marketing_os"] = true;
    }
  }
  return map;
}

/**
 * Express middleware: opens a per-request cache scope. Mount once,
 * globally, before any route that may read entitlements.
 */
export const entitlementContextMiddleware: RequestHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  requestStorage.run({ cache: new Map() }, () => next());
};

export const EntitlementService = {
  /**
   * Resolve all entitlements for `orgId`. The first call within a request
   * fires a single DB query and caches the resulting promise. Every
   * subsequent call within the same request awaits that same promise — no
   * extra queries, no duplicate work. Outside a request scope (e.g. unit
   * tests, scripts) it falls back to a one-shot fetch.
   */
  async getMap(orgId: string): Promise<EntitlementMap> {
    const store = requestStorage.getStore();
    if (!store) {
      return fetchEntitlementMap(orgId);
    }
    const cached = store.cache.get(orgId);
    if (cached) return cached;
    const p = fetchEntitlementMap(orgId);
    store.cache.set(orgId, p);
    return p;
  },

  async hasFeature(orgId: string, feature: OrgEntitlementFeature): Promise<boolean> {
    const map = await EntitlementService.getMap(orgId);
    return map[feature] === true;
  },
};

/**
 * Stealth-404 middleware. For non-entitled orgs we return a generic
 * 404 — never 403, never a hint that the feature exists.
 */
export function requireFeature(feature: OrgEntitlementFeature): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = req.session?.orgId;
    if (!orgId || !req.session?.userId) {
      // No session → indistinguishable from "feature doesn't exist" to
      // unauthenticated callers per the stealth-404 contract.
      return res.status(404).json({ message: "Not found" });
    }
    try {
      const ok = await EntitlementService.hasFeature(orgId, feature);
      if (!ok) return res.status(404).json({ message: "Not found" });
      return next();
    } catch (err) {
      // Fail closed: treat lookup errors as not-entitled rather than
      // leaking the feature's existence via a 500.
      console.error(
        `[entitlements] lookup failed for org=${orgId} feature=${feature}:`,
        (err as Error).message,
      );
      return res.status(404).json({ message: "Not found" });
    }
  };
}

export type EntitlementDetail = {
  active: boolean;
  gracePeriodEndsAt: string | null;
  // Task #392 — Non-null only when the row is a legacy marketing_os
  // grandfather hold. The Settings → Billing surface uses this to render
  // the "current access ends <date>" notice for grandfathered orgs.
  grandfatherExpiresAt: string | null;
  // Task #392 — Whether the boolean above is currently being honored
  // because the org's plan_tier auto-grants this feature (vs. via a
  // persisted entitlement row). Surfaced so the admin UI can render the
  // "Included with Business plan" copy instead of the legacy add-on CTA.
  tierDerived: boolean;
};
export type EntitlementDetailsMap = Record<OrgEntitlementFeature, EntitlementDetail>;

function emptyDetailsMap(): EntitlementDetailsMap {
  return ORG_ENTITLEMENT_FEATURES.reduce((acc, key) => {
    acc[key] = {
      active: false,
      gracePeriodEndsAt: null,
      grandfatherExpiresAt: null,
      tierDerived: false,
    };
    return acc;
  }, {} as EntitlementDetailsMap);
}

async function fetchEntitlementDetails(orgId: string): Promise<EntitlementDetailsMap> {
  const [rows, tierInputs] = await Promise.all([
    db
      .select({
        feature: orgEntitlements.feature,
        active: orgEntitlements.active,
        gracePeriodEndsAt: orgEntitlements.gracePeriodEndsAt,
        grandfatherExpiresAt: orgEntitlements.grandfatherExpiresAt,
      })
      .from(orgEntitlements)
      .where(eq(orgEntitlements.orgId, orgId)),
    loadTierInputs(orgId),
  ]);
  const map = emptyDetailsMap();
  const now = Date.now();
  for (const row of rows) {
    const feature = row.feature as OrgEntitlementFeature;
    if (!ORG_ENTITLEMENT_FEATURES.includes(feature)) continue;
    const graceEnds =
      row.gracePeriodEndsAt instanceof Date
        ? row.gracePeriodEndsAt.getTime()
        : null;
    // Task #392 — see fetchEntitlementMap for the rationale: grandfather
    // window outranks the grace flip for marketing_os so a tier-derived
    // past_due that elapsed alongside a still-future grandfather can't
    // revoke a legacy add-on holder's promised access early.
    const isMarketing = feature === "marketing_os";
    const grandEnds =
      isMarketing && row.grandfatherExpiresAt instanceof Date
        ? row.grandfatherExpiresAt.getTime()
        : null;
    const grandfatherActive = grandEnds !== null && grandEnds > now;
    if (row.active && graceEnds !== null && graceEnds <= now && !grandfatherActive) {
      // Expired grace → reflect post-flip state in the response and trigger
      // the persist UPDATE so the next read sees the row as inactive.
      lazyExpire(orgId, feature);
      map[feature] = {
        active: false,
        gracePeriodEndsAt: null,
        grandfatherExpiresAt: null,
        tierDerived: false,
      };
      continue;
    }
    if (isMarketing && row.active && grandEnds !== null && grandEnds <= now) {
      // Expired grandfather → mirror lazy-expire pattern.
      lazyExpireGrandfather(orgId);
      map[feature] = {
        active: false,
        gracePeriodEndsAt: null,
        grandfatherExpiresAt: null,
        tierDerived: false,
      };
      continue;
    }
    map[feature] = {
      active: row.active === true,
      gracePeriodEndsAt:
        row.gracePeriodEndsAt instanceof Date
          ? row.gracePeriodEndsAt.toISOString()
          : null,
      grandfatherExpiresAt:
        row.grandfatherExpiresAt instanceof Date
          ? row.grandfatherExpiresAt.toISOString()
          : null,
      tierDerived: false,
    };
  }
  // Task #392 — overlay tier-derived marketing_os on top of the row state.
  // When the tier grants it, we mark the detail entry active and surface
  // `tierDerived: true` so the UI can swap the CTA copy. We deliberately
  // KEEP any grandfather_expires_at value from the row so admins on a
  // BUSINESS plan who also hold a legacy add-on still see the migration
  // history, but the active flag itself is owned by the tier overlay.
  // Pass the persisted gracePeriodEndsAt so past_due is bounded to its
  // 7-day window. Use the row we already serialized into the detail map
  // (its gracePeriodEndsAt string was set above) — converting back to a
  // Date string is safe for the predicate.
  const persistedGrace = map["marketing_os"]?.gracePeriodEndsAt ?? null;
  if (
    tierInputs &&
    marketingOsActiveFromTier(
      tierInputs.planTier,
      tierInputs.subscriptionStatus,
      persistedGrace,
    )
  ) {
    const existing = map["marketing_os"];
    map["marketing_os"] = {
      active: true,
      // Tier-derived ACTIVE clears the user-facing grace label. For
      // past_due-within-grace we still surface the deadline so the UI
      // can warn the customer to update billing before access lapses.
      gracePeriodEndsAt:
        tierInputs.subscriptionStatus === "past_due"
          ? persistedGrace
          : null,
      grandfatherExpiresAt: existing.grandfatherExpiresAt,
      tierDerived: true,
    };
  }
  return map;
}

/**
 * Sprint 2j — Boot-time sweep. Batch-flips every row where the grace window
 * has already elapsed. Idempotent. Always logs the count (including 0) so
 * boot logs are easy to grep for the sweep ran-and-completed signal.
 */
export async function sweepExpiredEntitlements(): Promise<{ flipped: number }> {
  try {
    const sweepNow = new Date();
    const result: any = await db
      .update(orgEntitlements)
      .set({ active: false, gracePeriodEndsAt: null, updatedAt: sweepNow })
      .where(
        and(
          eq(orgEntitlements.active, true),
          isNotNull(orgEntitlements.gracePeriodEndsAt),
          lt(orgEntitlements.gracePeriodEndsAt, sweepNow),
          // Task #392 — exclude marketing_os rows whose grandfather window
          // is still in the future. Without this guard a legacy add-on
          // holder on Starter/Professional whose tier-derived past_due
          // grace elapsed before their renewal date would lose access
          // early via the boot sweep, breaking the grandfather contract.
          or(
            ne(orgEntitlements.feature, "marketing_os"),
            isNull(orgEntitlements.grandfatherExpiresAt),
            lt(orgEntitlements.grandfatherExpiresAt, sweepNow),
          ),
        ),
      )
      .returning({ id: orgEntitlements.id });
    const flipped = Array.isArray(result) ? result.length : 0;
    console.log(`[entitlements] sweep expired ${flipped} row(s)`);
    return { flipped };
  } catch (err: any) {
    // 42P01 = relation does not exist (fresh DB pre-migrations). Soft-fail
    // to keep boot resilient (Sprint 2i.6 contract).
    if (err?.code === "42P01") {
      console.warn(`[entitlements] sweep skipped: org_entitlements table not yet present`);
      return { flipped: 0 };
    }
    throw err;
  }
}

/**
 * Sprint 2j — Pure helper for unit tests. Given a row's `active` and
 * `gracePeriodEndsAt`, return the effective active boolean. Mirrors the
 * exact logic used in `fetchEntitlementMap` / `fetchEntitlementDetails`.
 */
export function effectiveActive(
  active: boolean,
  gracePeriodEndsAt: Date | null,
  now: number = Date.now(),
): boolean {
  if (!active) return false;
  if (gracePeriodEndsAt === null) return true;
  return gracePeriodEndsAt.getTime() > now;
}

/**
 * GET /api/me/entitlements — auth required, no entitlement gating.
 * Returns the four-key boolean map for the authenticated user's org.
 *
 * GET /api/me/entitlements/details — same auth, returns the richer
 * per-feature `{ active, gracePeriodEndsAt }` shape used by the
 * Settings → Billing page (Sprint 2i.4). The original boolean endpoint
 * is preserved verbatim so existing consumers (sidebar gating, route
 * gating) keep working unchanged.
 */
export function registerEntitlementRoutes(app: Express): void {
  app.get("/api/me/entitlements", async (req: Request, res: Response) => {
    if (!req.session?.userId || !req.session?.orgId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const user = await storage.getUserById(req.session.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const map = await EntitlementService.getMap(req.session.orgId);
      return res.json(map);
    } catch (err) {
      return res.status(500).json({ message: (err as Error).message });
    }
  });

  app.get("/api/me/entitlements/details", async (req: Request, res: Response) => {
    if (!req.session?.userId || !req.session?.orgId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const user = await storage.getUserById(req.session.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (user.role !== "ADMIN") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const details = await fetchEntitlementDetails(req.session.orgId);
      return res.json(details);
    } catch (err) {
      return res.status(500).json({ message: (err as Error).message });
    }
  });
}
