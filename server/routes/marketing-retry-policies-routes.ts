/**
 * Task #306 — Operator-only listing of orgs whose marketing retry
 * policy diverges from the platform defaults.
 *
 * After Task #271 made `marketingSendMaxAttempts` /
 * `marketingSendRetryBaseMs` per-org, an org could quietly bump its
 * limits to dangerous values (e.g. 20 attempts on a 1-minute base) and
 * amplify load on shared transports. This endpoint surfaces the
 * deviating orgs to platform operators so they can spot risky configs
 * before they cause incidents.
 *
 * Gating mirrors the other cross-tenant operator endpoints
 * (m365-rescope, alert-pinned-orgs): `requirePlatformOperator` 404s
 * when `PLATFORM_OPERATOR_EMAILS` is unset or the caller is not in
 * the allow-list, so tenant ADMINs can never see other orgs' configs.
 */
import type { Express, Request, Response } from "express";
import { requirePlatformOperator, sanitizeErrorMessage } from "./middleware";
import { pool } from "../db";
import {
  MAX_SEND_ATTEMPTS,
  RETRY_BACKOFF_BASE_MS,
} from "../marketing/scheduled-send";

export interface MarketingRetryPolicyRow {
  orgId: string;
  orgName: string;
  maxAttempts: number;
  retryBaseMs: number;
  attemptsDelta: number;
  retryBaseMsDelta: number;
}

export interface MarketingRetryPoliciesResponse {
  defaults: { maxAttempts: number; retryBaseMs: number };
  orgs: MarketingRetryPolicyRow[];
}

export function registerMarketingRetryPoliciesRoutes(app: Express) {
  app.get(
    "/api/admin/marketing/retry-policies",
    requirePlatformOperator,
    async (_req: Request, res: Response) => {
      try {
        const defaultsMaxAttempts = MAX_SEND_ATTEMPTS;
        const defaultsBaseMs = RETRY_BACKOFF_BASE_MS;
        // Surface every org whose configured value differs from the
        // current process-level defaults. We compare against the live
        // module constants (which honor MARKETING_SEND_MAX_ATTEMPTS /
        // MARKETING_SEND_RETRY_BASE_MS env overrides) so an ops shift
        // of the global default re-baselines the list automatically.
        const result = await pool.query<{
          id: string;
          name: string;
          marketing_send_max_attempts: number;
          marketing_send_retry_base_ms: number;
        }>(
          `SELECT id, name, marketing_send_max_attempts, marketing_send_retry_base_ms
             FROM orgs
            WHERE marketing_send_max_attempts <> $1
               OR marketing_send_retry_base_ms <> $2
            ORDER BY name ASC, id ASC`,
          [defaultsMaxAttempts, defaultsBaseMs],
        );
        const orgs: MarketingRetryPolicyRow[] = result.rows.map((row) => ({
          orgId: row.id,
          orgName: row.name,
          maxAttempts: row.marketing_send_max_attempts,
          retryBaseMs: row.marketing_send_retry_base_ms,
          attemptsDelta:
            row.marketing_send_max_attempts - defaultsMaxAttempts,
          retryBaseMsDelta:
            row.marketing_send_retry_base_ms - defaultsBaseMs,
        }));
        const body: MarketingRetryPoliciesResponse = {
          defaults: {
            maxAttempts: defaultsMaxAttempts,
            retryBaseMs: defaultsBaseMs,
          },
          orgs,
        };
        return res.json(body);
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );
}
