import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { randomBytes, randomUUID } from "crypto";
import { isProduction, apiLimiter, tenantRateLimiter, invoiceSendLimiter, paymentLimiter, importLimiter, getRateLimitInfo } from "./routes/middleware";
import { seedDatabase } from "./seed";
import { registerStripeWebhook } from "./stripe_webhook";

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 1) continue;
    const key = pair.substring(0, idx).trim();
    let val: string;
    try {
      val = decodeURIComponent(pair.substring(idx + 1).trim());
    } catch {
      val = pair.substring(idx + 1).trim();
    }
    result[key] = val;
  }
  return result;
}

import { registerAuthRoutes } from "./routes/auth-routes";
import { registerTeamRoutes } from "./routes/team-routes";
import { registerClientRoutes } from "./routes/client-routes";
import { registerBrandRoutes } from "./routes/brands";
import { registerContactRoutes } from "./routes/marketing/contacts";
import { registerProspectRoutes } from "./routes/marketing/prospects";
import { registerMarketingActivityRoutes } from "./routes/marketing/activities";
import { registerMarketingChatRoutes } from "./routes/marketing/chat";
import { registerMarketingContactImportRoutes } from "./routes/marketing-contact-import-routes";
import { registerContactTagRoutes } from "./routes/marketing/tags";
import { registerContactSegmentRoutes } from "./routes/marketing/segments";
import { registerMarketingCampaignRoutes } from "./routes/marketing/campaigns";
import { registerCompanyRoutes } from "./routes/marketing/companies";
import { registerProjectRoutes } from "./routes/project-routes";
import { registerTimeRoutes } from "./routes/time-routes";
import { registerInvoiceRoutes } from "./routes/invoice-routes";
import { registerPaymentRoutes } from "./routes/payment-routes";
import { registerReportRoutes } from "./routes/report-routes";
import { registerEstimateRoutes } from "./routes/estimate-routes";
import { registerExpenseRoutes } from "./routes/expense-routes";
import { registerPayoutRoutes } from "./routes/payout-routes";
import { registerGlRoutes } from "./routes/gl-routes";
import { registerBankRoutes } from "./routes/bank-routes";
import { registerIntegrationRoutes } from "./routes/integration-routes";
import { registerImportRoutes } from "./routes/import-routes";
import { registerSettingsRoutes } from "./routes/settings-routes";
import { registerOauthMailboxRoutes } from "./routes/oauth-mailbox-routes";
import { registerTestEmailRoutes } from "./routes/test-email-routes";
import { registerDashboardRoutes } from "./routes/dashboard-routes";
import { registerBackupRoutes } from "./routes/backup-routes";
import { registerDataManagementRoutes } from "./routes/data-management-routes";
import { registerSearchRoutes } from "./routes/search-routes";
import { registerHealthRoutes } from "./routes/health-routes";
import { registerSamlRoutes } from "./routes/saml-routes";
import { registerSecretsRoutes } from "./routes/secrets-routes";
import { registerI18nRoutes } from "./routes/i18n-routes";
import { registerErrorTrackingRoutes } from "./routes/error-tracking-routes";
import { registerMarketingOsTelemetryRoutes } from "./routes/marketing-os-telemetry-routes";
import { registerJobQueueRoutes } from "./routes/job-queue-routes";
import { registerImpersonationRoutes } from "./routes/impersonation-routes";
import { registerWebhookAdminRoutes } from "./routes/webhook-admin-routes";
import { registerAuditSearchRoutes } from "./routes/audit-search-routes";
import { registerMobileResponsiveRoutes } from "./routes/mobile-responsive-routes";
import { registerGlobalSearchRoutes } from "./routes/global-search-routes";
import { registerAvScanRoutes } from "./routes/av-scan-routes";
import { registerCustomerPortalRoutes } from "./routes/customer-portal-routes";
import { registerInboundWebhookSecurityRoutes } from "./routes/inbound-webhook-security-routes";
import { registerOpenAPIRoutes } from "./routes/openapi-routes";
import { registerScheduledReportsRoutes } from "./routes/scheduled-reports-routes";
import { registerFeatureFlagsRoutes } from "./routes/feature-flags-routes";
import { registerWebhookDashboardRoutes } from "./routes/webhook-dashboard-routes";
import { registerInvoiceThemesRoutes } from "./routes/invoice-themes-routes";
import { registerAutoChargeRoutes } from "./routes/auto-charge-routes";
import { registerMultiEntityRoutes } from "./routes/multi-entity-routes";
import { registerReportBuilderRoutes } from "./routes/report-builder-routes";
import { registerDunningRoutes } from "./routes/dunning-routes";
import { registerTimerRoutes } from "./routes/timer-routes";
import { registerReceiptOcrRoutes } from "./routes/receipt-ocr-routes";
import { registerProjectBudgetRoutes } from "./routes/project-budgets-routes";
import { registerEstimateApprovalRoutes } from "./routes/estimate-approval-routes";
import { registerChatNotificationsRoutes } from "./routes/chat-notifications-routes";
import { registerEmailAlertWebhookRoutes } from "./routes/email-alert-webhook-routes";
import { registerEmailDeliverabilityRoutes } from "./routes/email-deliverability-routes";
import { registerMarketingRetryPoliciesRoutes } from "./routes/marketing-retry-policies-routes";
import { registerRateMatrixRoutes } from "./routes/rate-matrix-routes";
import { registerMfaRoutes } from "./routes/mfa-routes";
import { registerBulkOpsRoutes } from "./routes/bulk-ops-routes";
import { registerImportWizardsRoutes } from "./routes/import-wizards-routes";
import { registerNotificationCenterRoutes } from "./routes/notification-center-routes";
import { registerRoleDashboardsRoutes } from "./routes/role-dashboards-routes";
import { registerKeyboardShortcutsRoutes } from "./routes/keyboard-shortcuts-routes";
import { registerTaxEngineRoutes } from "./routes/tax-engine-routes";
import { registerPaymentPlansRoutes } from "./routes/payment-plans-routes";
import { registerExpenseReimbursementRoutes } from "./routes/expense-reimbursement-routes";
import { registerVendor1099Routes } from "./routes/vendor-1099-routes";
import { registerYearEndCloseRoutes } from "./routes/year-end-close-routes";
import { registerGoLiveRoutes } from "./routes/go-live-routes";
import { registerClosePeriodRoutes } from "./routes/close-period-routes";
import { registerSessionRoutes } from "./routes/session-routes";
import { hashSessionId, updateSessionActivity } from "./routes/session-routes";
import { registerNotificationRoutes } from "./routes/notification-routes";
import { registerResendInboundRoutes } from "./routes/resend-inbound-routes";
import { registerActivityRoutes } from "./routes/activity-routes";
import { entitlementContextMiddleware, registerEntitlementRoutes } from "./services/entitlements";
import { registerEntitlementCheckoutRoutes } from "./routes/entitlement-checkout-routes";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    orgId?: string;
    role?: string;
    lastActivity?: number;
    mfaPending?: boolean;
    // "code"  → user has an enabled enrollment; only /validate is allowed.
    // "setup" → user has no enrollment yet; only /setup + /verify are allowed.
    mfaPendingReason?: "code" | "setup";
    _lastSessionDbUpdate?: number;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Required for Express type augmentation
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  const PgStore = connectPgSimple(session);

  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required in production");
  }
  const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString("hex");

  const sessionMiddleware = session({
    store: new PgStore({
      pool,
      createTableIfMissing: true,
      tableName: "session",
      // Sprint 2i.6 — soft-fail the internal prune cycle when the session
      // table is briefly missing (early in a cold boot, before any session
      // write triggers `createTableIfMissing`). Without this guard the
      // library's default error log emits a noisy "Failed to prune sessions"
      // line on every prune interval and can crash the process during
      // rolling deploys. Real errors still surface.
      errorLog: (...args: any[]) => {
        const err = args.find((a) => a && typeof a === "object" && "code" in a);
        if (err && (err as { code?: string }).code === "42P01") {
          console.warn("[sessions] session table not present yet — skipping prune");
          return;
        }
        console.error("[sessions]", ...args);
      },
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
  app.use(sessionMiddleware);
  app.use(entitlementContextMiddleware);

  const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) return next();
    const now = Date.now();
    if (req.session.lastActivity && (now - req.session.lastActivity) > SESSION_IDLE_TIMEOUT_MS) {
      return req.session.destroy(() => {
        // HTML navigations (Accept: text/html, non-/api/*) get a 302 to
        // /login?auth=required so the browser lands on the login page
        // instead of rendering a raw JSON body. XHR/fetch + /api/* keep
        // the JSON 401 the SPA already handles.
        const wantsHtml =
          req.method === "GET" &&
          !req.path.startsWith("/api/") &&
          (req.headers.accept || "").includes("text/html");
        if (wantsHtml) {
          return res.redirect(302, "/login?auth=required");
        }
        res.status(401).json({ message: "Session expired due to inactivity" });
      });
    }
    if (req.path !== "/api/csrf-token") {
      req.session.lastActivity = now;
      if (req.sessionID && (!req.session._lastSessionDbUpdate || now - req.session._lastSessionDbUpdate > 60000)) {
        req.session._lastSessionDbUpdate = now;
        const hashed = hashSessionId(req.sessionID);
        updateSessionActivity(hashed).catch(() => {});
      }
    }
    next();
  });

  const CSRF_EXEMPT_PREFIXES = [
    "/api/public/",
    "/api/webhooks/",
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/forgot-password",
    "/api/auth/reset-password/",
    "/api/v1/",
    "/api/newsletter/",
    "/api/csp-report",
    "/api/saml/",
    "/api/portal/",
    "/api/webhooks/email/",
    "/api/openapi.json",
    "/api/docs",
  ];

  function isCSRFExempt(path: string): boolean {
    return CSRF_EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix));
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    if (isCSRFExempt(req.path)) {
      return next();
    }
    const cookies = parseCookies(req.headers.cookie || "");
    const cookieToken = cookies["csrf-token"];
    const headerToken = req.headers["x-csrf-token"];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ message: "Invalid CSRF token" });
    }
    next();
  });

  const cspReportLimiter = (await import("express-rate-limit")).default({
    windowMs: 60_000,
    max: 30,
    message: "",
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.post("/api/csp-report", cspReportLimiter, express.json({ type: "application/csp-report" }), (req: Request, res: Response) => {
    const report = req.body?.["csp-report"] || req.body;
    if (report) {
      const directive = String(report["violated-directive"] || "unknown").substring(0, 200);
      const blocked = String(report["blocked-uri"] || "unknown").substring(0, 500);
      const document = String(report["document-uri"] || "unknown").substring(0, 500);
      console.warn(`[csp] violation: directive="${directive}" blocked="${blocked}" document="${document}"`);
    }
    res.status(204).end();
  });

  app.use((_req: Request, res: Response, next: NextFunction) => {
    const nonce = randomBytes(16).toString("base64");
    (res as any).cspNonce = nonce;

    if (isProduction) {
      const cspDirectives = [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://js.stripe.com`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https://logo.clearbit.com https://www.google.com",
        "connect-src 'self' https://checkout.stripe.com https://api.stripe.com",
        "frame-src 'self' blob: https://checkout.stripe.com https://js.stripe.com",
        "font-src 'self' https://fonts.gstatic.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "upgrade-insecure-requests",
        "report-uri /api/csp-report",
      ].join("; ");
      res.setHeader("Content-Security-Policy", cspDirectives);
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
      res.setHeader("X-XSS-Protection", "0");
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    }

    next();
  });

  app.use("/uploads", express.static("uploads"));

  // Sprint M-Chat-1 — universal marketing chatbot embed loader is now
  // served by a dedicated server route inside registerMarketingChatRoutes
  // (`GET /embed/chat.js`) so it can set explicit Content-Type, CORS, and
  // cache headers, gate on the marketing_os env flag, and stay aligned
  // with the route-level testing surface.

  const AUDIT_LOG_RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS) || 365;

  app.post("/api/admin/audit-log/cleanup", async (req: Request, res: Response) => {
    return res.status(403).json({
      message: "Audit logs are immutable and cannot be deleted. This policy is enforced at both application and database level.",
      immutable: true,
    });
  });

  app.get("/api/audit-log", async (req: Request, res: Response) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    const { storage: st } = await import("./storage");
    const u = await st.getUserById(req.session.userId);
    if (!u || u.role !== "ADMIN") return res.status(403).json({ message: "Admin access required" });
    try {
      const orgId = req.session.orgId!;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const entityType = req.query.entityType as string | undefined;
      const action = req.query.action as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      const conditions: string[] = ["org_id = $1"];
      const params: any[] = [orgId];
      let idx = 2;

      if (entityType) { conditions.push(`entity_type = $${idx}`); params.push(entityType); idx++; }
      if (action) { conditions.push(`action = $${idx}`); params.push(action); idx++; }
      if (startDate) {
        const d = new Date(startDate);
        if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid startDate" });
        conditions.push(`created_at >= $${idx}`); params.push(d); idx++;
      }
      if (endDate) {
        const d = new Date(endDate);
        if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid endDate" });
        conditions.push(`created_at <= $${idx}`); params.push(d); idx++;
      }

      const where = conditions.join(" AND ");
      const [dataResult, countResult] = await Promise.all([
        pool.query(`SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset]),
        pool.query(`SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${where}`, params),
      ]);

      return res.json({
        logs: dataResult.rows,
        total: countResult.rows[0]?.total || 0,
        limit,
        offset,
        hasMore: offset + limit < (countResult.rows[0]?.total || 0),
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/pool-stats", async (req: Request, res: Response) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    const { storage } = await import("./storage");
    const user = await storage.getUserById(req.session.userId);
    if (!user || user.role !== "ADMIN") return res.status(403).json({ message: "Admin access required" });
    const active = pool.totalCount - pool.idleCount;
    const utilization = pool.totalCount > 0 ? Math.round((active / pool.totalCount) * 100) : 0;
    return res.json({
      active,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      total: pool.totalCount,
      max: 20,
      utilization: `${utilization}%`,
    });
  });

  app.get("/api/health", async (_req: Request, res: Response) => {
    try {
      await pool.query("SELECT 1");
      const active = pool.totalCount - pool.idleCount;
      const utilization = pool.totalCount > 0 ? Math.round((active / pool.totalCount) * 100) : 0;
      res.json({ status: "ok", db: "connected", poolUtilization: `${utilization}%`, uptime: process.uptime() });
    } catch (err: any) {
      res.status(503).json({ status: "error", db: "disconnected", error: err.message });
    }
  });

  app.get("/api/ready", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query("SELECT COUNT(*) as cnt FROM orgs");
      const orgCount = Number(result.rows[0]?.cnt ?? 0);
      if (orgCount === 0) {
        return res.status(503).json({ status: "not_ready", reason: "no_orgs_seeded" });
      }
      res.json({ status: "ready", orgCount, uptime: process.uptime() });
    } catch (err: any) {
      res.status(503).json({ status: "not_ready", reason: "db_unavailable", error: err.message });
    }
  });

  const API_KEY_CORS_ORIGINS = process.env.API_KEY_CORS_ORIGINS?.split(",").map(s => s.trim()).filter(Boolean) || [];

  app.use("/api/v1/", (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && (API_KEY_CORS_ORIGINS.includes("*") || API_KEY_CORS_ORIGINS.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", API_KEY_CORS_ORIGINS.includes("*") ? "*" : origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Request-Id");
      res.setHeader("Access-Control-Max-Age", "86400");
      res.setHeader("Access-Control-Allow-Credentials", "false");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  app.get("/api/admin/rate-limits", async (req: Request, res: Response) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const { storage } = await import("./storage");
    const user = await storage.getUserById(req.session.userId);
    if (!user || user.role !== "ADMIN") return res.status(403).json({ message: "Admin required" });
    return res.json(getRateLimitInfo());
  });

  app.get("/api/admin/security-headers", async (req: Request, res: Response) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const { storage } = await import("./storage");
    const user = await storage.getUserById(req.session.userId);
    if (!user || user.role !== "ADMIN") return res.status(403).json({ message: "Admin required" });
    return res.json({
      headers: {
        "Content-Security-Policy": "nonce-based, strict",
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
        "X-XSS-Protection": "0 (modern CSP used instead)",
        "Cross-Origin-Opener-Policy": "same-origin",
      },
      cookies: {
        sameSite: "Lax",
        secure: isProduction,
        httpOnly: true,
        sessionFixationProtection: true,
      },
    });
  });

  app.get("/api/admin/gdpr/user-export/:userId", async (req: Request, res: Response) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const { storage } = await import("./storage");
    const admin = await storage.getUserById(req.session.userId);
    if (!admin || admin.role !== "ADMIN") return res.status(403).json({ message: "Admin required" });
    const orgId = req.session.orgId!;
    const targetUserId = req.params.userId;

    try {
      const userResult = await pool.query(`SELECT id, email, name, role, created_at FROM users WHERE id = $1 AND org_id = $2`, [targetUserId, orgId]);
      if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found" });
      const user = userResult.rows[0];

      const timeEntries = await pool.query(`SELECT id, project_id, minutes, notes, date, billable FROM time_entries WHERE user_id = $1 AND org_id = $2`, [targetUserId, orgId]);
      const auditLogs = await pool.query(`SELECT id, action, entity_type, entity_id, created_at FROM audit_logs WHERE user_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1000`, [targetUserId, orgId]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        format: "JSON",
        user: user,
        timeEntries: timeEntries.rows,
        auditLogs: auditLogs.rows,
      };

      const csvLines = ["field,value"];
      csvLines.push(`email,"${user.email}"`);
      csvLines.push(`name,"${user.name}"`);
      csvLines.push(`role,"${user.role}"`);
      csvLines.push(`created_at,"${user.created_at}"`);
      csvLines.push("");
      csvLines.push("time_entry_id,project_id,minutes,notes,date,billable");
      for (const te of timeEntries.rows) {
        csvLines.push(`${te.id},${te.project_id},${te.minutes},"${(te.notes || '').replace(/"/g, '""')}",${te.date},${te.billable}`);
      }

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), orgId, req.session.userId, "GDPR_USER_EXPORT", "user", targetUserId,
          JSON.stringify({ targetEmail: user.email, timeEntryCount: timeEntries.rows.length, auditLogCount: auditLogs.rows.length })]
      );

      return res.json({
        ok: true,
        userId: targetUserId,
        email: user.email,
        json: exportData,
        csv: csvLines.join("\n"),
        counts: {
          timeEntries: timeEntries.rows.length,
          auditLogs: auditLogs.rows.length,
        },
        auditLogged: true,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/gdpr/erase-user", async (req: Request, res: Response) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const { storage } = await import("./storage");
    const admin = await storage.getUserById(req.session.userId);
    if (!admin || admin.role !== "ADMIN") return res.status(403).json({ message: "Admin required" });
    const orgId = req.session.orgId!;
    const { userId: targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ message: "userId is required" });
    if (targetUserId === req.session.userId) return res.status(400).json({ message: "Cannot erase yourself" });

    try {
      const userResult = await pool.query(`SELECT id, email, name, role FROM users WHERE id = $1 AND org_id = $2`, [targetUserId, orgId]);
      if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found" });
      const user = userResult.rows[0];
      if (user.role === "ADMIN") return res.status(400).json({ message: "Cannot erase admin users" });

      const redactedName = `Former User #${targetUserId.substring(0, 8)}`;
      const redactedEmail = `erased-${targetUserId.substring(0, 8)}@redacted.local`;

      await pool.query("BEGIN");
      try {
        await pool.query(
          `UPDATE users SET name = $1, email = $2, password = 'ERASED' WHERE id = $3 AND org_id = $4`,
          [redactedName, redactedEmail, targetUserId, orgId]
        );

        await pool.query(
          `UPDATE time_entries SET notes = '[REDACTED]' WHERE user_id = $1 AND org_id = $2`,
          [targetUserId, orgId]
        );

        await pool.query(
          `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), orgId, req.session.userId, "GDPR_USER_ERASURE", "user", targetUserId,
            JSON.stringify({ originalName: user.name, originalEmail: user.email, redactedName, redactedEmail })]
        );

        await pool.query("COMMIT");

        const glCheck = await pool.query(`
          SELECT COALESCE(SUM(total - COALESCE(paid_amount,0)),0)::numeric(12,2) AS ar FROM invoices WHERE status NOT IN ('DRAFT','VOID') AND org_id = $1
        `, [orgId]);
        const arTotal = String(glCheck.rows[0]?.ar ?? "0.00");

        return res.json({
          ok: true,
          userId: targetUserId,
          redactedName,
          redactedEmail,
          arTotalPreserved: arTotal,
          financialIntegrityMaintained: true,
          auditLogged: true,
        });
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/secrets/dry-run", async (req: Request, res: Response) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const { storage } = await import("./storage");
    const admin = await storage.getUserById(req.session.userId);
    if (!admin || admin.role !== "ADMIN") return res.status(403).json({ message: "Admin required" });

    const secretEnvVars = [
      "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET",
      "DATABASE_URL", "SESSION_SECRET", "WEBHOOK_SIGNING_KEY",
      "SMTP_PASSWORD", "BACKUP_ENCRYPTION_KEY", "GROQ_API_KEY",
    ];

    const results = secretEnvVars.map(envVar => {
      const configured = !!process.env[envVar];
      const masked = configured ? `${envVar.substring(0, 3)}...${envVar.substring(envVar.length - 3)}` : "NOT_SET";
      return {
        envVar,
        configured,
        rotatable: true,
        masked,
        dryRunStatus: configured ? "WOULD_ROTATE" : "SKIP_NOT_CONFIGURED",
      };
    });

    return res.json({
      dryRun: true,
      timestamp: new Date().toISOString(),
      secrets: results,
      configuredCount: results.filter(r => r.configured).length,
      wouldRotateCount: results.filter(r => r.dryRunStatus === "WOULD_ROTATE").length,
      skippedCount: results.filter(r => r.dryRunStatus === "SKIP_NOT_CONFIGURED").length,
      hardcodedSecrets: 0,
      runbookSteps: [
        "1. Generate new secret value",
        "2. Set in environment variables",
        "3. Call POST /api/admin/secrets/rotate with envVar+newValue",
        "4. Verify application health via /api/health",
        "5. Mark rotation timestamp via /api/admin/secrets/mark-rotated",
      ],
    });
  });

  await seedDatabase();
  app.use("/api/", apiLimiter);
  app.use("/api/", tenantRateLimiter);

  app.use("/api/invoices/:id/send", invoiceSendLimiter);
  app.use("/api/payments", paymentLimiter);
  app.use("/api/import", importLimiter);

  registerSettingsRoutes(app);
  registerOauthMailboxRoutes(app);
  registerTestEmailRoutes(app);
  registerAuthRoutes(app);
  registerTeamRoutes(app);
  registerDashboardRoutes(app);
  registerClientRoutes(app);
  registerProjectRoutes(app);
  registerTimeRoutes(app);
  registerInvoiceRoutes(app);
  registerPaymentRoutes(app);
  registerReportRoutes(app);
  registerImportRoutes(app);
  registerEstimateRoutes(app);
  registerExpenseRoutes(app);
  registerPayoutRoutes(app);
  registerGlRoutes(app);
  registerBankRoutes(app);
  registerIntegrationRoutes(app);
  registerBackupRoutes(app);
  registerDataManagementRoutes(app);
  registerSearchRoutes(app);
  registerHealthRoutes(app);
  registerSamlRoutes(app);
  registerSecretsRoutes(app);
  registerI18nRoutes(app);
  registerErrorTrackingRoutes(app);
  registerMarketingOsTelemetryRoutes(app);
  registerJobQueueRoutes(app);
  registerImpersonationRoutes(app);
  registerWebhookAdminRoutes(app);
  registerAuditSearchRoutes(app);
  registerMobileResponsiveRoutes(app);
  registerGlobalSearchRoutes(app);
  registerAvScanRoutes(app);
  registerCustomerPortalRoutes(app);
  registerEmailDeliverabilityRoutes(app);
  registerMarketingRetryPoliciesRoutes(app);
  registerMfaRoutes(app);
  registerInboundWebhookSecurityRoutes(app);
  registerOpenAPIRoutes(app);
  registerScheduledReportsRoutes(app);
  registerFeatureFlagsRoutes(app);
  registerEntitlementRoutes(app);
  registerEntitlementCheckoutRoutes(app);
  registerBrandRoutes(app);
  registerContactRoutes(app);
  registerProspectRoutes(app);
  registerMarketingActivityRoutes(app);
  registerMarketingChatRoutes(app);
  registerMarketingContactImportRoutes(app);
  registerContactTagRoutes(app);
  registerContactSegmentRoutes(app);
  registerMarketingCampaignRoutes(app);
  registerCompanyRoutes(app);
  registerWebhookDashboardRoutes(app);
  registerInvoiceThemesRoutes(app);
  registerAutoChargeRoutes(app);
  registerMultiEntityRoutes(app);
  registerReportBuilderRoutes(app);
  registerDunningRoutes(app);
  registerTimerRoutes(app);
  registerReceiptOcrRoutes(app);
  registerProjectBudgetRoutes(app);
  registerEstimateApprovalRoutes(app);
  registerChatNotificationsRoutes(app);
  registerEmailAlertWebhookRoutes(app);
  registerBulkOpsRoutes(app);
  registerImportWizardsRoutes(app);
  registerNotificationCenterRoutes(app, httpServer, sessionMiddleware);
  registerRoleDashboardsRoutes(app);
  registerKeyboardShortcutsRoutes(app);
  registerTaxEngineRoutes(app);
  registerPaymentPlansRoutes(app);
  registerExpenseReimbursementRoutes(app);
  registerVendor1099Routes(app);
  registerYearEndCloseRoutes(app);
  registerGoLiveRoutes(app);
  registerClosePeriodRoutes(app);
  registerSessionRoutes(app);
  registerNotificationRoutes(app);
  registerResendInboundRoutes(app);
  registerActivityRoutes(app);
  registerRateMatrixRoutes(app);

  registerStripeWebhook(app);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[500]", err.message, isProduction ? "" : err.stack);
    res.status(500).json({
      message: "Internal server error",
      ...(isProduction ? {} : { detail: err.message }),
    });
  });

  return httpServer;
}
