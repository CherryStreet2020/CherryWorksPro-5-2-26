import { sql } from "drizzle-orm";
import { db } from "../db";

export const MARKETING_OS_GRANDFATHER_DISABLED_ENV =
  "MARKETING_OS_GRANDFATHER_DISABLED";

export interface MarketingOsCutoverResult {
  skipped: boolean;
  reason?: string;
  flipped: number;
}

export async function applyMarketingOsGrandfatherCutoverIfRequested(): Promise<MarketingOsCutoverResult> {
  const flag = process.env[MARKETING_OS_GRANDFATHER_DISABLED_ENV];
  if (!flag || !["true", "1", "yes", "on"].includes(flag.toLowerCase())) {
    return { skipped: true, reason: "flag-not-set", flipped: 0 };
  }

  try {
    const result = await db.execute(sql`
      WITH cutover AS (
        UPDATE org_entitlements oe
        SET active = false,
            grandfather_expires_at = NULL,
            grace_period_ends_at = NULL,
            updated_at = NOW()
        WHERE oe.feature = 'marketing_os'
          AND oe.active = true
          AND oe.grandfather_expires_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM orgs o
            WHERE o.id = oe.org_id
              AND o.plan_tier IN ('BUSINESS', 'ENTERPRISE')
              AND o.subscription_status IN ('active', 'trialing', 'past_due')
          )
        RETURNING oe.org_id
      )
      SELECT COUNT(*)::int AS flipped FROM cutover
    `);
    const rows = (result as any).rows ?? (result as any);
    const flipped = Array.isArray(rows) && rows[0] ? Number(rows[0].flipped ?? 0) : 0;
    console.warn(
      `[marketing-os-grandfather-cutover] HARD CUTOVER applied (${MARKETING_OS_GRANDFATHER_DISABLED_ENV}=true): flipped ${flipped} grandfather row(s) inactive.`,
    );
    return { skipped: false, flipped };
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    if (/relation .* does not exist/i.test(msg) || /42P01/.test(msg)) {
      console.warn(
        "[marketing-os-grandfather-cutover] skipped: org_entitlements not yet present",
      );
      return { skipped: true, reason: "table-missing", flipped: 0 };
    }
    throw e;
  }
}
