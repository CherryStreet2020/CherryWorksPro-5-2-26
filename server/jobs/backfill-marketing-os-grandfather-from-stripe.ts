/**
 * Task #392 — Stripe-aware one-shot backfill for grandfathered marketing_os
 * holders.
 *
 * The SQL migration (0025) stamps a conservative `NOW()+30 days` sentinel
 * on every legacy paid-add-on row that exists at deploy time. Replaying the
 * sentinel is fine because the migration is idempotent (only stamps when
 * grandfather_expires_at IS NULL), but it is NOT authoritative — the real
 * grandfather deadline is the underlying Stripe subscription's
 * `current_period_end`. This script reconciles the two:
 *
 *   For each row in org_entitlements where:
 *     feature='marketing_os' AND active=true
 *     AND grandfather_expires_at IS NOT NULL
 *     AND stripe_subscription_id IS NOT NULL
 *
 *   We fetch the Stripe subscription. Then:
 *     • If the sub is canceled / incomplete_expired / unpaid → flip
 *       active=false, clear grandfather_expires_at (matches the terminal
 *       handling in handleAddonSubscriptionEvent).
 *     • Else if Stripe returned a current_period_end:
 *         - If the period is already in the past → deactivate + clear
 *           grandfather (collapses any over-grant immediately on first
 *           prod boot rather than waiting for the daily cleanup).
 *         - Else → overwrite grandfather_expires_at with the
 *           authoritative value, even when it shortens an over-generous
 *           sentinel (Stripe is the source of truth, not the placeholder).
 *     • Else (Stripe returned no sub or no period boundary) → leave the
 *       row alone with a warning so on-call sees the gap.
 *
 * Every UPDATE includes an `AND active=true` guard so the backfill cannot
 * accidentally resurrect a row that was already deactivated by the boot
 * cleanup sweep, a webhook, or a concurrent admin action.
 *
 * Idempotent + replay-safe — re-running converges to the same state. Wired
 * into server/index.ts after the daily cleanup job; runs once per boot,
 * gracefully no-ops in dev (no STRIPE_SECRET_KEY) and degrades to
 * boot-survivable warnings on Stripe API failures so a transient outage
 * never blocks deploy.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { orgEntitlements } from "@shared/schema";

type Outcome = {
  scanned: number;
  extended: number;
  deactivated: number;
  skipped: number;
  errors: number;
};

export async function backfillMarketingOsGrandfatherFromStripe(): Promise<Outcome> {
  const result: Outcome = {
    scanned: 0,
    extended: 0,
    deactivated: 0,
    skipped: 0,
    errors: 0,
  };

  if (!process.env.STRIPE_SECRET_KEY) {
    console.log(
      "[marketing-os-grandfather-backfill] skipped: STRIPE_SECRET_KEY not configured (dev environment?)",
    );
    return result;
  }

  let rows: Array<{
    id: string;
    orgId: string;
    stripeSubscriptionId: string | null;
    grandfatherExpiresAt: Date | null;
  }>;

  try {
    rows = await db
      .select({
        id: orgEntitlements.id,
        orgId: orgEntitlements.orgId,
        stripeSubscriptionId: orgEntitlements.stripeSubscriptionId,
        grandfatherExpiresAt: orgEntitlements.grandfatherExpiresAt,
      })
      .from(orgEntitlements)
      .where(
        and(
          eq(orgEntitlements.feature, "marketing_os"),
          eq(orgEntitlements.active, true),
          isNotNull(orgEntitlements.grandfatherExpiresAt),
          isNotNull(orgEntitlements.stripeSubscriptionId),
        ),
      );
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.warn(
        "[marketing-os-grandfather-backfill] skipped: org_entitlements relation not yet present",
      );
      return result;
    }
    console.error(
      `[marketing-os-grandfather-backfill] scan failed: ${err?.message ?? err}`,
    );
    return result;
  }

  result.scanned = rows.length;
  if (rows.length === 0) {
    console.log(
      "[marketing-os-grandfather-backfill] nothing to do (0 grandfather rows with stripe_subscription_id)",
    );
    return result;
  }

  let stripe: any;
  try {
    const Stripe = (await import("stripe")).default;
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  } catch (err: any) {
    console.error(
      `[marketing-os-grandfather-backfill] failed to init Stripe SDK: ${err?.message ?? err}`,
    );
    return result;
  }

  const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);
  const now = new Date();

  for (const row of rows) {
    if (!row.stripeSubscriptionId) {
      result.skipped++;
      continue;
    }

    let sub: any;
    try {
      sub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
    } catch (err: any) {
      // 404 → subscription has been deleted upstream. Treat as terminal.
      if (err?.statusCode === 404 || err?.code === "resource_missing") {
        try {
          await db
            .update(orgEntitlements)
            .set({
              active: false,
              grandfatherExpiresAt: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(orgEntitlements.id, row.id),
                eq(orgEntitlements.active, true),
              ),
            );
          result.deactivated++;
          console.log(
            `[marketing-os-grandfather-backfill] deactivated org=${row.orgId} sub=${row.stripeSubscriptionId} (Stripe 404)`,
          );
        } catch (deactivateErr: any) {
          result.errors++;
          console.error(
            `[marketing-os-grandfather-backfill] deactivate failed for org=${row.orgId}: ${deactivateErr?.message ?? deactivateErr}`,
          );
        }
        continue;
      }
      result.errors++;
      console.warn(
        `[marketing-os-grandfather-backfill] Stripe fetch failed for org=${row.orgId} sub=${row.stripeSubscriptionId}: ${err?.message ?? err}`,
      );
      continue;
    }

    const status = sub?.status as string | undefined;
    if (status && TERMINAL_STATUSES.has(status)) {
      try {
        await db
          .update(orgEntitlements)
          .set({
            active: false,
            grandfatherExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(orgEntitlements.id, row.id),
              eq(orgEntitlements.active, true),
            ),
          );
        result.deactivated++;
        console.log(
          `[marketing-os-grandfather-backfill] deactivated org=${row.orgId} sub=${row.stripeSubscriptionId} (status=${status})`,
        );
      } catch (deactivateErr: any) {
        result.errors++;
        console.error(
          `[marketing-os-grandfather-backfill] deactivate failed for org=${row.orgId}: ${deactivateErr?.message ?? deactivateErr}`,
        );
      }
      continue;
    }

    const cpeRaw = sub?.current_period_end;
    if (typeof cpeRaw !== "number" || !Number.isFinite(cpeRaw)) {
      result.skipped++;
      console.warn(
        `[marketing-os-grandfather-backfill] no current_period_end on sub=${row.stripeSubscriptionId} (status=${status}); leaving sentinel in place`,
      );
      continue;
    }

    const authoritative = new Date(cpeRaw * 1000);

    // Stripe is the source of truth. Migration 0025 stamped a
    // conservative `NOW()+30d` placeholder; this backfill overwrites it
    // with the real period end — even when Stripe's value is *earlier*
    // than the sentinel (which is the over-grant case the architect
    // flagged). If the period has already elapsed, we deactivate
    // immediately rather than wait for the daily cleanup pass.
    if (authoritative.getTime() <= now.getTime()) {
      try {
        await db
          .update(orgEntitlements)
          .set({
            active: false,
            grandfatherExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(eq(orgEntitlements.id, row.id), eq(orgEntitlements.active, true)),
          );
        result.deactivated++;
        console.log(
          `[marketing-os-grandfather-backfill] deactivated org=${row.orgId} sub=${row.stripeSubscriptionId} (CPE ${authoritative.toISOString()} already elapsed)`,
        );
      } catch (deactivateErr: any) {
        result.errors++;
        console.error(
          `[marketing-os-grandfather-backfill] deactivate (elapsed CPE) failed for org=${row.orgId}: ${deactivateErr?.message ?? deactivateErr}`,
        );
      }
      continue;
    }

    const existing = row.grandfatherExpiresAt;
    if (existing && existing.getTime() === authoritative.getTime()) {
      result.skipped++;
      continue;
    }

    try {
      await db
        .update(orgEntitlements)
        .set({
          grandfatherExpiresAt: authoritative,
          updatedAt: now,
        })
        .where(
          and(eq(orgEntitlements.id, row.id), eq(orgEntitlements.active, true)),
        );
      result.extended++;
      const direction =
        existing && existing.getTime() > authoritative.getTime()
          ? "shortened"
          : "extended";
      console.log(
        `[marketing-os-grandfather-backfill] ${direction} org=${row.orgId} sub=${row.stripeSubscriptionId} grandfather → ${authoritative.toISOString()}`,
      );
    } catch (extendErr: any) {
      result.errors++;
      console.error(
        `[marketing-os-grandfather-backfill] update failed for org=${row.orgId}: ${extendErr?.message ?? extendErr}`,
      );
    }
  }

  console.log(
    `[marketing-os-grandfather-backfill] done — scanned=${result.scanned} extended=${result.extended} deactivated=${result.deactivated} skipped=${result.skipped} errors=${result.errors}`,
  );
  return result;
}
