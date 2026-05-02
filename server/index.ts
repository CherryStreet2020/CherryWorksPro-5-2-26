process.on('uncaughtException', (err) => {
  console.error('[FATAL uncaughtException]', err.stack || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL unhandledRejection]', reason);
  process.exit(1);
});

import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrationsAndSeed } from "./startup-orchestrator";
import { startWebhookRetryProcessor } from "./webhooks";
import { startReminderProcessor, stopReminderProcessor } from "./reminders";
import {
  startMarketingScheduledSendProcessor,
  stopMarketingScheduledSendProcessor,
} from "./marketing/scheduled-send";
import {
  startMailboxRecoveryProcessor,
  stopMailboxRecoveryProcessor,
} from "./email/mailbox-status";
import {
  startWebhookHealthCheckProcessor,
  stopWebhookHealthCheckProcessor,
} from "./email/webhook-health-check";
import {
  startPendingAdminNotificationProcessor,
  stopPendingAdminNotificationProcessor,
} from "./notifications/marketing-failures";
import { pool } from "./db";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Trust Replit's reverse proxy so req.ip is correct and secure cookies work
app.set("trust proxy", 1);

if (process.env.NODE_ENV === 'production') {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    frameguard: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
  }));
}

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const SENSITIVE_FIELDS = new Set([
  "password", "token", "secret", "apiKey", "api_key",
  "authorization", "cookie", "ssn", "bankAccountNumber",
  "bankRoutingNumber", "creditCard", "cardNumber",
]);

function scrubPII(obj: any, depth = 0): any {
  if (depth > 3 || !obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.length > 3 ? `[Array(${obj.length})]` : obj.map(i => scrubPII(i, depth + 1));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(k)) { out[k] = "***REDACTED***"; continue; }
    if (typeof v === "string" && v.length > 200) { out[k] = v.substring(0, 50) + "...[truncated]"; continue; }
    out[k] = typeof v === "object" ? scrubPII(v, depth + 1) : v;
  }
  return out;
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export { structuredLog } from "./lib/logging";
import { structuredLog } from "./lib/logging";

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const entry: Record<string, any> = {
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        requestId: req.requestId?.substring(0, 8),
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: duration,
      };
      if (capturedJsonResponse && res.statusCode >= 400) {
        entry.response = scrubPII(capturedJsonResponse);
      }
      structuredLog(entry);
    }
  });

  next();
});

(async () => {
  try {
  app.use((req, _res, next) => {
    req.setTimeout(30000, () => {});
    next();
  });

  await registerRoutes(httpServer, app);

  app.get("/marketing-os", (_req, res) => {
    res.redirect(301, "/marketing");
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  app.all("/api/{*path}", (_req, res) => {
    res.status(404).json({ error: "API route not found", path: _req.path });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = (() => {
    const envVal = process.env.PORT;
    if (!envVal) return 5000;
    const parsed = parseInt(envVal, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.warn(`[config] Invalid PORT "${envVal}" — using default 5000`);
      return 5000;
    }
    return parsed;
  })();
  const server = httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);

      (async () => {
        // Sprint 2i.6 / Task #171 / Task #186 — migration + seed orchestration
        // is extracted to `server/startup-orchestrator.ts` so its gating
        // contract can be exercised end-to-end by integration tests.
        //
        // Sprint 2o.0 startup-latency fix — when SKIP_STARTUP_MIGRATIONS is
        // set truthy (prod Autoscale), the prestart phase (`npm run
        // db:migrate:prod`) has already replayed migrations/*.sql and run
        // `drizzle-kit push --force`, so the in-listen replay is pure
        // redundant latency that pushes Promote past its health-check
        // deadline. The seeds (`seedExpenseCategories`,
        // `seedOrgEntitlements`) are idempotent and have been applied on
        // every prior boot, so skipping them on one post-prestart boot is a
        // no-op in practice.
        const skipStartupMigrations = (() => {
          const raw = process.env.SKIP_STARTUP_MIGRATIONS;
          if (raw === undefined) return false;
          const v = raw.trim().toLowerCase();
          if (v === "") return false;
          return v !== "0" && v !== "false" && v !== "no" && v !== "off";
        })();
        if (skipStartupMigrations) {
          log(
            "SKIP_STARTUP_MIGRATIONS=1 set — skipping runMigrationsAndSeed() (both migration replay AND seed functions). Prestart phase is expected to have covered migrations; seeds are idempotent and previously applied.",
            "startup",
          );
        } else {
          await runMigrationsAndSeed();
        }
        try {
          // Sprint 2j — log add-on price availability once per boot, then
          // batch-flip any rows whose 7-day grace window has elapsed since
          // the previous boot. Idempotent.
          const { logAddonAvailability } = await import("./stripe-addon-prices");
          logAddonAvailability();
          const { sweepExpiredEntitlements } = await import("./services/entitlements");
          await sweepExpiredEntitlements();
        } catch (e: any) {
          console.error(`[startup] sweepExpiredEntitlements failed: ${e?.message ?? e} (code=${e?.code ?? "n/a"})`);
        }

        // Sprint M-Chat-1 — one-shot, idempotent enablement of the Cherry
        // persona on the CherryWorks Pro brand row. Runs after Phase-0 SQL
        // (which adds the `chat_*` columns). Failure here is non-fatal.
        try {
          const { enableCherryPersonaOnCherryWorksProBrand } = await import(
            "./marketing/cherry-persona-enable"
          );
          await enableCherryPersonaOnCherryWorksProBrand();
        } catch (e: any) {
          console.error(
            `[startup] enableCherryPersonaOnCherryWorksProBrand failed (non-fatal): ${e?.message ?? e}`,
          );
        }

        log("background migrations complete", "startup");

        try {
          const { loadOrgEmailAlertWebhooksOnBoot } = await import(
            "./routes/email-alert-webhook-routes"
          );
          await loadOrgEmailAlertWebhooksOnBoot();
        } catch (e: any) {
          console.error(
            `[startup] loadOrgEmailAlertWebhooksOnBoot failed: ${e?.message ?? e} (code=${e?.code ?? "n/a"})`,
          );
        }

        try {
          const { db: startupDb } = await import("./db");
          const { orgs: orgsTable } = await import("@shared/schema");
          const allOrgs = await startupDb.select({ id: orgsTable.id, name: orgsTable.name, autoPost: orgsTable.autoPostJournalEntries }).from(orgsTable);
          const disabledOrgs = allOrgs.filter(o => !o.autoPost);
          if (disabledOrgs.length > 0) {
            console.warn(`[startup] ⚠️ WARNING: ${disabledOrgs.length} org(s) have autoPostJournalEntries disabled: ${disabledOrgs.map(o => o.name).join(", ")}`);
          }
        } catch (e) {
          console.error("[startup] autoPost preflight check failed:", e);
        }
      })();

      startWebhookRetryProcessor();
      startReminderProcessor();
      startMailboxRecoveryProcessor();
      // Task #207 — dispatch scheduled marketing campaigns + due
      // sequence enrollment steps. Process-wide pg advisory lock inside
      // makes multi-instance deployments safe.
      startMarketingScheduledSendProcessor();
      // Task #251 — Periodically auto-test every configured per-org
      // alert webhook so admins are warned the URL is broken before
      // a real failure burst arrives.
      startWebhookHealthCheckProcessor();
      // Task #303 — Drain admin failure emails buffered during quiet hours.
      startPendingAdminNotificationProcessor();

      const { cleanupStaleImportRuns } = await import("./routes/import-routes");
      cleanupStaleImportRuns().catch(e => console.error("[import-cleanup] Boot backfill failed:", e));
      setInterval(async () => {
        try { await cleanupStaleImportRuns(); } catch (e) { console.error("[import-cleanup] Interval failed:", e); }
      }, 15 * 60_000);

      // Sweep abandoned draft brand logos out of the public bucket.
      // The "Add brand" dropzone uploads files before the brand row is
      // created, so closing the dialog leaves orphans. Run on boot and
      // every 6 hours; only files older than 24h with no referencing
      // brand row are removed.
      const { cleanupAbandonedDraftLogos } = await import("./lib/brand-logo-cleanup");
      const runBrandLogoCleanup = async () => {
        try {
          const stats = await cleanupAbandonedDraftLogos();
          if (stats.scanned > 0 || stats.deleted > 0) {
            console.log(
              `[brand-logo-cleanup] scanned=${stats.scanned} deleted=${stats.deleted} keptReferenced=${stats.keptReferenced} keptTooNew=${stats.keptTooNew} errors=${stats.errors}`,
            );
          }
        } catch (e) {
          console.error("[brand-logo-cleanup] Sweep failed:", e);
        }
      };
      runBrandLogoCleanup();
      setInterval(runBrandLogoCleanup, 6 * 60 * 60_000);

      // Task 203 — Trim `marketing_os_telemetry_events` rows older than the
      // configured retention window (default 180 days; see
      // `MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT` in `shared/schema.ts`).
      // The admin dashboard only ever reads the last 30 days, so older rows
      // are dead weight. Run on boot and every 24h.
      //
      // Task 220 — The sweep is now wrapped in a Postgres advisory lock so
      // it's safe under multi-replica deployments: only the replica that
      // grabs the lock issues the DELETE; the others skip silently.
      const { startMarketingOsTelemetryCleanupScheduler } = await import(
        "./routes/marketing-os-telemetry-routes"
      );
      startMarketingOsTelemetryCleanupScheduler();

      // Task #212 — Trim `email_failure_alerts` rows older than the
      // configured retention window (default 30 days; override with
      // `EMAIL_FAILURE_ALERT_RETENTION_DAYS`). The 200-row cap inside
      // `recordAlert` already bounds the table by count, but on
      // long-running deployments with infrequent breaches very old
      // rows could otherwise linger indefinitely. Run on boot and
      // every 24h.
      const {
        pruneOldFailureAlerts,
        startRecipientSuppressionCleanupScheduler,
      } = await import("./email/failure-tracker");
      const runEmailFailureAlertCleanup = async () => {
        try {
          const stats = await pruneOldFailureAlerts();
          if (stats.deleted > 0) {
            console.log(
              `[email-failure-alert-cleanup] deleted=${stats.deleted} retentionDays=${stats.retentionDays} cutoff=${stats.cutoff.toISOString()}`,
            );
          }
        } catch (e) {
          console.error("[email-failure-alert-cleanup] Sweep failed:", e);
        }
      };
      runEmailFailureAlertCleanup();
      setInterval(runEmailFailureAlertCleanup, 24 * 60 * 60_000);

      // Task #392 — Daily sweep that flips off any grandfathered
      // marketing_os entitlement whose `grandfather_expires_at` has
      // elapsed. The read path also lazy-expires individual rows on
      // read; this scheduler is the belt-and-suspenders pass that
      // ensures admin tooling / batched audit queries never see stale
      // grandfather holds. Run on boot and every 24h.
      // Boot order is deterministic: cleanup (lazy-expire any rows whose
      // sentinel has already elapsed) → Stripe-aware backfill (overwrite
      // remaining sentinels with authoritative current_period_end). The
      // two are awaited sequentially in a fire-and-forget IIFE so they
      // don't block the rest of boot, but they don't race each other
      // and both UPDATE statements include `active=true` guards as a
      // belt-and-suspenders against any unexpected interleaving.
      void (async () => {
        // Task #392 — Optional ops escape hatch. When the env var
        // MARKETING_OS_GRANDFATHER_DISABLED is set to a truthy value
        // ("true"/"1"/"yes"/"on"), perform a HARD CUTOVER: deactivate
        // every grandfathered marketing_os row that isn't simultaneously
        // tier-derived-active. This lets ops force-revoke legacy add-on
        // access immediately if the rolling grandfather window proves
        // problematic in production. Default behavior (flag absent) is
        // grandfather-on (Option B) per the migration policy. Runs
        // BEFORE the cleanup sweep so its INSERT/UPDATE conflicts are
        // minimized and so cleanup sees the already-deactivated rows.
        try {
          const { applyMarketingOsGrandfatherCutoverIfRequested } =
            await import("./jobs/marketing-os-grandfather-cutover");
          await applyMarketingOsGrandfatherCutoverIfRequested();
        } catch (e) {
          console.error(
            "[marketing-os-grandfather-cutover] Boot run failed:",
            e,
          );
        }

        try {
          const { expireGrandfatheredMarketingOs } = await import(
            "./jobs/expire-grandfathered-marketing-os"
          );
          await expireGrandfatheredMarketingOs();
        } catch (e) {
          console.error(
            "[marketing-os-grandfather-cleanup] Boot sweep failed:",
            e,
          );
        }

        // Task #392 — One-shot Stripe-aware backfill that overwrites the
        // conservative `NOW()+30d` sentinel stamped by migration 0025
        // with the authoritative `current_period_end` from the
        // underlying Stripe subscription, and deactivates rows whose
        // subs are canceled/expired upstream OR whose period has already
        // elapsed. Idempotent + replay-safe; degrades to boot-survivable
        // warnings on Stripe API errors and silently no-ops in dev when
        // STRIPE_SECRET_KEY is absent.
        try {
          const { backfillMarketingOsGrandfatherFromStripe } = await import(
            "./jobs/backfill-marketing-os-grandfather-from-stripe"
          );
          await backfillMarketingOsGrandfatherFromStripe();
        } catch (e) {
          console.error(
            "[marketing-os-grandfather-backfill] Boot run failed:",
            e,
          );
        }
      })();

      setInterval(async () => {
        try {
          const { expireGrandfatheredMarketingOs } = await import(
            "./jobs/expire-grandfathered-marketing-os"
          );
          await expireGrandfatheredMarketingOs();
        } catch (e) {
          console.error(
            "[marketing-os-grandfather-cleanup] Interval failed:",
            e,
          );
        }
      }, 24 * 60 * 60_000);

      // Task #276 — Auto-expire stale `email_recipient_suppressions`
      // rows whose effective last activity (last_suppressed_at, or
      // added_at if never re-hit) is older than the configured window
      // (default 90 days; override with
      // `EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS`). Mirrors the
      // failure-alert cleanup above so the suppression list doesn't
      // grow without bound when admins forget to manually prune.
      //
      // Task #312 — Wiring extracted into
      // `startRecipientSuppressionCleanupScheduler` so an integration
      // test can exercise the same boot + 24h interval orchestration
      // production runs through.
      startRecipientSuppressionCleanupScheduler();

      // Task #277 — Trim `email_alert_webhook_tests` so no org keeps more
      // than the most recent 10 rows. The user-triggered POST .../test
      // endpoint already trims inline after each insert, but that only
      // covers the org doing the test. A periodic sweep keeps the cap
      // honest regardless of which code path inserted the rows (e.g. a
      // future scheduled webhook health check). Run on boot and every 6h.
      const { cleanupOldEmailAlertWebhookTests } = await import(
        "./routes/email-alert-webhook-routes"
      );
      const runEmailAlertWebhookTestsCleanup = async () => {
        try {
          const stats = await cleanupOldEmailAlertWebhookTests();
          if (stats.deleted > 0) {
            console.log(
              `[email-alert-webhook-tests-cleanup] deleted=${stats.deleted} perOrgLimit=${stats.perOrgLimit}`,
            );
          }
        } catch (e) {
          console.error(
            "[email-alert-webhook-tests-cleanup] Sweep failed:",
            e,
          );
        }
      };
      runEmailAlertWebhookTestsCleanup();
      setInterval(runEmailAlertWebhookTestsCleanup, 6 * 60 * 60_000);

      // One-shot boot sweep: any contact_imports row left in
      // pending/processing belongs to the previous process and cannot
      // resume, so mark it failed. We deliberately do NOT run this on
      // an interval — there's no per-job heartbeat, so a periodic sweep
      // would risk killing legitimate long-running imports.
      const { recoverStuckContactImports } = await import("./lib/contact-import-worker");
      recoverStuckContactImports().catch(e => console.error("[contact-import-worker] Boot recovery failed:", e));

      setInterval(() => {
        try {
          console.log(`[pool] active=${pool.totalCount - pool.idleCount} idle=${pool.idleCount} waiting=${pool.waitingCount} total=${pool.totalCount}`);
        } catch (err) {
          console.error("[pool] Background pool stats task failed:", err);
        }
      }, 60_000);

      if (!process.env.MAX_UPLOAD_SIZE_MB) {
        console.log("[config] MAX_UPLOAD_SIZE_MB not set, defaulting to 10 MB");
      }

      try {
        const result = await pool.query("SELECT COUNT(*)::int AS cnt FROM audit_logs");
        const count = result.rows[0]?.cnt || 0;
        if (count > 100_000) {
          console.warn(`[audit] audit_logs table has ${count} rows (>100k). Consider running POST /api/admin/audit-log/cleanup to purge old entries. Retention: ${process.env.AUDIT_LOG_RETENTION_DAYS || 365} days.`);
        }
      } catch (e) {
        console.error("[audit] audit_logs size check failed:", e);
      }
    },
  );

  function gracefulShutdown(signal: string) {
    console.log(`[shutdown] Graceful shutdown initiated (${signal})`);
    stopReminderProcessor();
    stopMailboxRecoveryProcessor();
    stopMarketingScheduledSendProcessor();
    stopWebhookHealthCheckProcessor();
    stopPendingAdminNotificationProcessor();
    void import("./routes/marketing-os-telemetry-routes").then((m) =>
      m.stopMarketingOsTelemetryCleanupScheduler(),
    );
    const forceTimeout = setTimeout(() => {
      console.error("[shutdown] Forced exit after 10s timeout");
      process.exit(1);
    }, 10_000);
    forceTimeout.unref();
    server.close(() => {
      pool.end().then(() => {
        console.log("[shutdown] Database pool closed");
        clearTimeout(forceTimeout);
        process.exit(0);
      }).catch((err) => {
        console.error("[shutdown] Pool close error:", err);
        clearTimeout(forceTimeout);
        process.exit(1);
      });
    });
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (startupErr: any) {
    console.error('[FATAL startup error]', startupErr.stack || startupErr);
    process.exit(1);
  }
})();
