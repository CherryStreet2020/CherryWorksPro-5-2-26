import type { Request, Response, NextFunction } from "express";
import { TIER_ORDER, tierRank, meetsMinTier } from "../../shared/tier-order";
import { storage } from "../storage";

export { TIER_ORDER, tierRank, meetsMinTier };

type TierName = keyof typeof TIER_ORDER;

const VALID_TIERS = new Set(Object.keys(TIER_ORDER));

export function requireTier(minTier: TierName) {
  if (!VALID_TIERS.has(minTier)) {
    throw new Error(`[tier-gate] Invalid tier "${minTier}". Valid tiers: ${[...VALID_TIERS].join(", ")}`);
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.orgId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const org = await storage.getOrg(req.session.orgId);
      if (!org) {
        return res.status(401).json({ message: "Organization not found" });
      }

      const currentTier = org.planTier || "TRIAL";
      if (!meetsMinTier(currentTier, minTier)) {
        return res.status(403).json({
          requiredTier: minTier,
          currentTier,
          message: `This feature requires ${minTier} plan or higher. Upgrade to unlock this feature.`,
        });
      }

      next();
    } catch (err: any) {
      console.error(`[tier-gate] Error checking tier for org ${req.session.orgId}:`, err.message);
      return res.status(500).json({ message: "Internal server error during tier check" });
    }
  };
}
