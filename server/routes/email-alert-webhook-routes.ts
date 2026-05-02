import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage } from "./middleware";
import { pool } from "../db";
import {
  setOrgFailureWebhookConfig,
  clearOrgFailureWebhookConfig,
  getOrgFailureWebhookConfig,
  sendFailureWebhookTest,
} from "../email/failure-tracker";
import {
  getWebhookHealthCheckStaleMs,
  getWebhookHealthCheckTickMs,
} from "../email/webhook-health-check";

const MAX_URL_LEN = 2048;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const RECENT_TEST_LIMIT = 10;

/**
 * Task #277 — Trim `email_alert_webhook_tests` so that no org keeps more
 * than the most recent `RECENT_TEST_LIMIT` rows.
 *
 * The user-triggered POST .../test endpoint already does an inline DELETE
 * after each insert, but that only ever runs for the org that just tested.
 * Any future code path that inserts test rows from elsewhere (e.g. the
 * scheduled webhook health check) would otherwise let history grow
 * unbounded for orgs that never click "Send test" again. Running this
 * sweep on a schedule keeps the cap honest regardless of where rows
 * come from.
 *
 * Implemented as a single set-based DELETE using ROW_NUMBER() partitioned
 * by org so we don't need to enumerate orgs from app code.
 */
export async function cleanupOldEmailAlertWebhookTests(
  perOrgLimit: number = RECENT_TEST_LIMIT,
): Promise<{ deleted: number; perOrgLimit: number }> {
  const limit = Math.max(0, Math.floor(perOrgLimit));
  const { rowCount } = await pool.query(
    `DELETE FROM email_alert_webhook_tests
       WHERE id IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY org_id
                    ORDER BY tested_at DESC, id DESC
                  ) AS rn
             FROM email_alert_webhook_tests
         ) ranked
         WHERE rn > $1
       )`,
    [limit],
  );
  return { deleted: rowCount ?? 0, perOrgLimit: limit };
}

async function loadRecentTests(orgId: string): Promise<
  Array<{ testedAt: Date; ok: boolean; errorMessage: string | null }>
> {
  try {
    const { rows } = await pool.query<{
      tested_at: Date;
      ok: boolean;
      error_message: string | null;
    }>(
      `SELECT tested_at, ok, error_message
         FROM email_alert_webhook_tests
        WHERE org_id = $1
        ORDER BY tested_at DESC
        LIMIT $2`,
      [orgId, RECENT_TEST_LIMIT],
    );
    return rows.map((r) => ({
      testedAt: r.tested_at,
      ok: r.ok,
      errorMessage: r.error_message,
    }));
  } catch {
    return [];
  }
}

function isValidWebhookUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LEN) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Load every persisted org webhook config from the DB into the in-memory
 * tracker on boot. Safe to call before the table exists — a missing
 * relation is logged and treated as "no configs".
 */
export async function loadOrgEmailAlertWebhooksOnBoot(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      org_id: string;
      webhook_url: string;
      cooldown_ms: number | null;
    }>(
      `SELECT org_id, webhook_url, cooldown_ms FROM org_email_alert_webhooks`,
    );
    for (const row of rows) {
      setOrgFailureWebhookConfig(row.org_id, {
        url: row.webhook_url,
        cooldownMs:
          typeof row.cooldown_ms === "number" ? row.cooldown_ms : null,
      });
    }
    if (rows.length > 0) {
      console.log(
        `[email-alert-webhook] loaded ${rows.length} per-org webhook config(s) from DB`,
      );
    }
  } catch (err: any) {
    console.error(
      `[email-alert-webhook] failed to load configs from DB: ${err?.message ?? err}`,
    );
  }
}

export function registerEmailAlertWebhookRoutes(app: Express) {
  app.get(
    "/api/admin/email-alert-webhook",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const { rows } = await pool.query<{
          webhook_url: string;
          cooldown_ms: number | null;
          updated_at: Date;
          updated_by: string | null;
          updated_by_email: string | null;
          updated_by_name: string | null;
          updated_by_first_name: string | null;
          updated_by_last_name: string | null;
          last_tested_at: Date | null;
          last_test_ok: boolean | null;
          last_test_error: string | null;
        }>(
          `SELECT w.webhook_url,
                  w.cooldown_ms,
                  w.updated_at,
                  w.updated_by,
                  w.last_tested_at,
                  w.last_test_ok,
                  w.last_test_error,
                  u.email      AS updated_by_email,
                  u.name       AS updated_by_name,
                  u.first_name AS updated_by_first_name,
                  u.last_name  AS updated_by_last_name
             FROM org_email_alert_webhooks w
             LEFT JOIN users u ON u.id = w.updated_by
            WHERE w.org_id = $1`,
          [orgId],
        );
        const row = rows[0];
        const envFallback = !!process.env.EMAIL_FAILURE_WEBHOOK_URL;
        if (!row) {
          // Repair drift: in-memory entry without a DB row should not exist,
          // but if it does, drop it so reads stay consistent with persistence.
          if (getOrgFailureWebhookConfig(orgId)) {
            clearOrgFailureWebhookConfig(orgId);
          }
          return res.json({
            configured: false,
            webhookUrl: null,
            cooldownMs: null,
            envFallback,
            lastTestedAt: null,
            lastTestOk: null,
            lastTestError: null,
            recentTests: [],
            staleAfterMs: getWebhookHealthCheckStaleMs(),
            tickIntervalMs: getWebhookHealthCheckTickMs(),
          });
        }
        // Re-hydrate the in-memory cache opportunistically in case this
        // process started before this row was created elsewhere.
        setOrgFailureWebhookConfig(orgId, {
          url: row.webhook_url,
          cooldownMs:
            typeof row.cooldown_ms === "number" ? row.cooldown_ms : null,
        });
        const fullName = [row.updated_by_first_name, row.updated_by_last_name]
          .filter((s) => s && s.trim().length > 0)
          .join(" ")
          .trim();
        const updatedByName =
          fullName.length > 0
            ? fullName
            : row.updated_by_name && row.updated_by_name.trim().length > 0
              ? row.updated_by_name
              : null;
        return res.json({
          configured: true,
          webhookUrl: row.webhook_url,
          cooldownMs:
            typeof row.cooldown_ms === "number" ? row.cooldown_ms : null,
          envFallback,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by
            ? {
                id: row.updated_by,
                name: updatedByName,
                email: row.updated_by_email,
              }
            : null,
          lastTestedAt: row.last_tested_at,
          lastTestOk: row.last_test_ok,
          lastTestError: row.last_test_error,
          recentTests: await loadRecentTests(orgId),
          staleAfterMs: getWebhookHealthCheckStaleMs(),
          tickIntervalMs: getWebhookHealthCheckTickMs(),
        });
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );

  app.put(
    "/api/admin/email-alert-webhook",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const userId = req.session.userId!;
        const { webhookUrl, cooldownMs } = req.body ?? {};

        if (!isValidWebhookUrl(webhookUrl)) {
          return res.status(400).json({
            message:
              "webhookUrl must be a valid https URL (max 2048 chars).",
          });
        }

        let cooldown: number | null = null;
        if (
          cooldownMs !== undefined &&
          cooldownMs !== null &&
          cooldownMs !== ""
        ) {
          const n = Number(cooldownMs);
          if (!Number.isFinite(n) || n < 0 || n > MAX_COOLDOWN_MS) {
            return res.status(400).json({
              message: `cooldownMs must be between 0 and ${MAX_COOLDOWN_MS}.`,
            });
          }
          cooldown = Math.floor(n);
        }

        const url = (webhookUrl as string).trim();

        await pool.query(
          `INSERT INTO org_email_alert_webhooks (org_id, webhook_url, cooldown_ms, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (org_id) DO UPDATE
             SET webhook_url = EXCLUDED.webhook_url,
                 cooldown_ms = EXCLUDED.cooldown_ms,
                 updated_by  = EXCLUDED.updated_by,
                 updated_at  = NOW()`,
          [orgId, url, cooldown, userId],
        );

        setOrgFailureWebhookConfig(orgId, { url, cooldownMs: cooldown });

        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
           VALUES (gen_random_uuid(), $1, $2, 'EMAIL_ALERT_WEBHOOK_CONFIGURED', 'email_alert_webhook', $1, $3)`,
          [
            orgId,
            userId,
            JSON.stringify({
              host: (() => {
                try {
                  return new URL(url).host;
                } catch {
                  return null;
                }
              })(),
              cooldownMs: cooldown,
            }),
          ],
        );

        return res.json({
          success: true,
          configured: true,
          webhookUrl: url,
          cooldownMs: cooldown,
        });
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );

  app.post(
    "/api/admin/email-alert-webhook/test",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const userId = req.session.userId!;

        let url: string | null = null;
        let scope: "org" | "env" = "org";
        const cfg = getOrgFailureWebhookConfig(orgId);
        if (cfg?.url) {
          url = cfg.url;
          scope = "org";
        } else {
          const { rows } = await pool.query<{ webhook_url: string }>(
            `SELECT webhook_url FROM org_email_alert_webhooks WHERE org_id = $1`,
            [orgId],
          );
          if (rows[0]?.webhook_url) {
            url = rows[0].webhook_url;
            scope = "org";
          } else if (process.env.EMAIL_FAILURE_WEBHOOK_URL) {
            url = process.env.EMAIL_FAILURE_WEBHOOK_URL;
            scope = "env";
          }
        }

        if (!url) {
          return res.status(400).json({
            message:
              "No webhook URL is configured. Save a webhook before sending a test.",
          });
        }

        let delivered = false;
        let errorMessage: string | null = null;
        try {
          await sendFailureWebhookTest(
            url,
            scope === "env"
              ? { kind: "global" }
              : { kind: "org", orgId },
          );
          delivered = true;
        } catch (err: any) {
          errorMessage = sanitizeErrorMessage(err);
        }

        if (scope === "org") {
          await pool.query(
            `UPDATE org_email_alert_webhooks
                SET last_tested_at = NOW(),
                    last_test_ok = $2,
                    last_test_error = $3
              WHERE org_id = $1`,
            [orgId, delivered, delivered ? null : errorMessage],
          );
          try {
            await pool.query(
              `INSERT INTO email_alert_webhook_tests (org_id, ok, error_message)
               VALUES ($1, $2, $3)`,
              [orgId, delivered, delivered ? null : errorMessage],
            );
            // Keep only the most recent RECENT_TEST_LIMIT rows per org so the
            // history doesn't grow unbounded over time.
            await pool.query(
              `DELETE FROM email_alert_webhook_tests
                WHERE org_id = $1
                  AND id NOT IN (
                    SELECT id FROM email_alert_webhook_tests
                     WHERE org_id = $1
                     ORDER BY tested_at DESC
                     LIMIT $2
                  )`,
              [orgId, RECENT_TEST_LIMIT],
            );
          } catch (e: any) {
            console.error(
              `[email-alert-webhook] failed to record test history: ${e?.message ?? e}`,
            );
          }
        }

        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
           VALUES (gen_random_uuid(), $1, $2, 'EMAIL_ALERT_WEBHOOK_TESTED', 'email_alert_webhook', $1, $3)`,
          [
            orgId,
            userId,
            JSON.stringify({
              scope,
              delivered,
              host: (() => {
                try {
                  return new URL(url!).host;
                } catch {
                  return null;
                }
              })(),
              error: delivered ? null : errorMessage,
            }),
          ],
        );

        if (!delivered) {
          return res.status(502).json({
            success: false,
            delivered: false,
            scope,
            message: errorMessage ?? "Webhook delivery failed.",
          });
        }

        return res.json({ success: true, delivered: true, scope });
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );

  app.get(
    "/api/admin/email-alert-webhook/history",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const { rows } = await pool.query<{
          id: string;
          action: string;
          details: any;
          created_at: Date;
          user_id: string | null;
          user_email: string | null;
          user_name: string | null;
          user_first_name: string | null;
          user_last_name: string | null;
        }>(
          `SELECT a.id,
                  a.action,
                  a.details,
                  a.created_at,
                  a.user_id,
                  u.email      AS user_email,
                  u.name       AS user_name,
                  u.first_name AS user_first_name,
                  u.last_name  AS user_last_name
             FROM audit_logs a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE a.org_id = $1
              AND a.action IN (
                'EMAIL_ALERT_WEBHOOK_CONFIGURED',
                'EMAIL_ALERT_WEBHOOK_TESTED',
                'EMAIL_ALERT_WEBHOOK_DELETED'
              )
            ORDER BY a.created_at DESC
            LIMIT 50`,
          [orgId],
        );
        const events = rows.map((r) => {
          const fullName = [r.user_first_name, r.user_last_name]
            .filter((s) => s && s.trim().length > 0)
            .join(" ")
            .trim();
          const actorName =
            fullName.length > 0
              ? fullName
              : r.user_name && r.user_name.trim().length > 0
                ? r.user_name
                : null;
          const details =
            r.details && typeof r.details === "object" ? r.details : {};
          return {
            id: r.id,
            action: r.action,
            createdAt: r.created_at,
            host: typeof details.host === "string" ? details.host : null,
            details,
            actor: r.user_id
              ? {
                  id: r.user_id,
                  name: actorName,
                  email: r.user_email,
                }
              : null,
          };
        });
        return res.json({ events });
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );

  app.delete(
    "/api/admin/email-alert-webhook",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const userId = req.session.userId!;

        const { rowCount } = await pool.query(
          `DELETE FROM org_email_alert_webhooks WHERE org_id = $1`,
          [orgId],
        );
        clearOrgFailureWebhookConfig(orgId);

        const existed = (rowCount ?? 0) > 0;
        if (existed) {
          await pool.query(
            `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
             VALUES (gen_random_uuid(), $1, $2, 'EMAIL_ALERT_WEBHOOK_DELETED', 'email_alert_webhook', $1, $3)`,
            [orgId, userId, JSON.stringify({})],
          );
        }

        return res.json({ success: true, deleted: existed });
      } catch (err: any) {
        return res.status(500).json({ message: sanitizeErrorMessage(err) });
      }
    },
  );
}
