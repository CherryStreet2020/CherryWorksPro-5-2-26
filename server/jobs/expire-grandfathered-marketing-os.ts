/**
 * Task #392 — Daily cleanup job for grandfathered marketing_os rows.
 *
 * Walks every `org_entitlements` row where:
 *   feature = 'marketing_os'
 *   active = true
 *   grandfather_expires_at IS NOT NULL
 *   grandfather_expires_at <= now()
 * …and deactivates it. The read-path overlay also lazy-expires individual
 * rows on read, so this job is a belt-and-suspenders sweep that ensures
 * batched audit reports / admin tooling never see stale grandfather holds.
 *
 * Idempotent. Logs the flipped count (including 0). Errors are swallowed
 * past a logged warning so a single bad boot doesn't crash the scheduler.
 */
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { orgEntitlements } from "@shared/schema";

export async function expireGrandfatheredMarketingOs(): Promise<{ flipped: number }> {
  try {
    const now = new Date();
    const result: any = await db
      .update(orgEntitlements)
      // Clear grandfather_expires_at alongside the active flip — same
      // rationale as the lazy-expire / terminal-cancel paths: the UI
      // shouldn't render a "current access ends <date>" notice for a
      // window that has already passed (Task #392 post-review fix).
      .set({ active: false, grandfatherExpiresAt: null, updatedAt: now })
      .where(
        and(
          eq(orgEntitlements.feature, "marketing_os"),
          eq(orgEntitlements.active, true),
          isNotNull(orgEntitlements.grandfatherExpiresAt),
          lte(orgEntitlements.grandfatherExpiresAt, now),
        ),
      )
      .returning({ id: orgEntitlements.id });
    const flipped = Array.isArray(result) ? result.length : 0;
    console.log(
      `[marketing-os-grandfather-cleanup] expired ${flipped} grandfather row(s)`,
    );
    return { flipped };
  } catch (err: any) {
    // 42P01 = relation does not exist (schema not yet replayed). Soft-fail
    // so a fresh DB boot doesn't crash the scheduler.
    if (err?.code === "42P01") {
      console.warn(
        `[marketing-os-grandfather-cleanup] skipped: org_entitlements not yet present`,
      );
      return { flipped: 0 };
    }
    console.error(
      `[marketing-os-grandfather-cleanup] sweep failed: ${err?.message ?? err}`,
    );
    return { flipped: 0 };
  }
}
