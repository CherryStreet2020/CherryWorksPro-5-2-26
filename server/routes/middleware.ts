import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { wrapEmailLayout, emailButton, emailDivider, emailDetailCard, emailKeyValue } from "../email";

const isTestEnv = process.env.NODE_ENV === "test";
export const isProduction = process.env.NODE_ENV === "production";

export function setCSRFToken(res: Response): string {
const token = randomBytes(32).toString("hex");
res.cookie("csrf-token", token, {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
res.setHeader("X-CSRF-Token", token);
return token;
}

/**
 * Defers `res.json()` / `res.send()` until `req.session.save()` resolves so the
 * Set-Cookie header and persisted session row are guaranteed to be in place
 * before the response body is flushed. This removes the need for per-handler
 * `req.session.save(...)` callback wrapping inside auth/MFA routes.
 *
 * Express-session ordinarily wraps `res.end` to save the session, but on cold
 * starts (slow first DB round-trip) the regenerate -> set fields -> respond
 * sequence can race the cookie write. Forcing an explicit save here keeps the
 * behavior deterministic without per-route boilerplate.
 */
export function awaitSessionSave(req: Request, res: Response, next: NextFunction) {
  let saved = false;
  const originalJson = res.json.bind(res);
  const originalStatus = res.status.bind(res);

  const saveAnd = (cb: () => void) => {
    if (saved || !req.session) return cb();
    saved = true;
    req.session.save((err) => {
      if (err) {
        console.error("[auth] Session save failed:", err);
        // Fail closed: do NOT flush the queued success body, since the
        // session row didn't persist. The caller would otherwise be
        // "logged in" with no usable session on the next request.
        if (!res.headersSent) {
          originalStatus(500);
          originalJson({ message: "Session persistence failed. Please try again." });
        }
        return;
      }
      cb();
    });
  };

  res.json = function (body: any) {
    saveAnd(() => originalJson(body));
    return res;
  };

  const originalSend = res.send.bind(res);
  res.send = function (body?: any) {
    saveAnd(() => originalSend(body));
    return res;
  };

  next();
}

export function sanitizeErrorMessage(err: any): string {
  if (!isProduction) return err?.message || "Internal server error";
  const msg = (err?.message || "").toLowerCase();
  if (msg.includes("not found")) return err?.message || "Not found";
  const dbPatterns = [
    "unique constraint",
    "duplicate key",
    "foreign key",
    "violates check constraint",
    "relation",
    "column",
    "null value in column",
  ];
  if (dbPatterns.some((p) => msg.includes(p))) return "The operation could not be completed. Please try again.";
  return "Internal server error";
}

// NOTE: All rate limiters below use the default in-memory store. This means rate limit
// state is NOT shared across multiple server instances. When horizontal scaling is needed,
// set RATE_LIMIT_STORE=redis and configure REDIS_URL to share rate limit state across instances.
// Currently only "memory" (default) is implemented. Redis support is planned for future scaling.
const _rateLimitStore = process.env.RATE_LIMIT_STORE || "memory";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 1000 : 100,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    const retryAfter = Math.ceil(15 * 60);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ message: "Too many login attempts. Please try again in 15 minutes.", retryAfter });
  },
});

export const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 1000 : 10,
  message: { message: "Too many accounts created. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 1000 : 10,
  message: { message: "Too many password reset attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const publicTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later" },
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ message: "Too many requests. Please slow down.", retryAfter: 60 });
  },
});

export const invoiceSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 1000 : 20,
  message: { message: "Too many invoice send requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader("Retry-After", "900");
    res.status(429).json({ message: "Too many invoice send requests.", retryAfter: 900 });
  },
});

export const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: isTestEnv ? 1000 : 30,
  message: { message: "Too many payment requests." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader("Retry-After", "300");
    res.status(429).json({ message: "Too many payment requests.", retryAfter: 300 });
  },
});

export const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTestEnv ? 1000 : 10,
  message: { message: "Too many import requests." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader("Retry-After", "3600");
    res.status(429).json({ message: "Too many import requests.", retryAfter: 3600 });
  },
});

export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 1000 : 5,
  message: { message: "Too many password change attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const userCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTestEnv ? 1000 : 20,
  message: { message: "Too many user invitations. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const settingsUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTestEnv ? 1000 : 30,
  message: { message: "Too many settings updates. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 1000 : 5,
  message: { message: "Too many password reset requests" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const payrollWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv ? 1000 : 30,
  message: { message: "Too many webhook requests" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const dashboardBankingLimiter = rateLimit({
  windowMs: 60_000,
  max: isTestEnv ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many banking dashboard requests. Please slow down." },
});

const tenantBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const ipBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const userBuckets = new Map<string, { tokens: number; lastRefill: number }>();

// Test bypass mirrors the express-rate-limit limiters above (all `isTestEnv ? 1000 : X`):
// the parallel vitest/playwright suites hammer every /api/* route from a single
// localhost IP and one shared seed admin, which would otherwise drain these
// per-IP / per-user token buckets and produce spurious 429s. Production and dev
// (NODE_ENV !== "test") keep the real 300 / 200 caps.
const IP_RPM = isTestEnv ? 1_000_000 : 300;
const USER_RPM = isTestEnv ? 1_000_000 : 200;

function getClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
}

function checkTokenBucket(
  bucketMap: Map<string, { tokens: number; lastRefill: number }>,
  key: string,
  maxRpm: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let bucket = bucketMap.get(key);
  if (!bucket) {
    bucket = { tokens: maxRpm, lastRefill: now };
    bucketMap.set(key, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 60000;
  bucket.tokens = Math.min(maxRpm, bucket.tokens + elapsed * maxRpm);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    return { allowed: false, retryAfter: Math.ceil(60 / maxRpm) };
  }
  bucket.tokens -= 1;
  return { allowed: true, retryAfter: 0 };
}

export async function tenantRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIp(req);
  const ipCheck = checkTokenBucket(ipBuckets, `ip:${ip}`, IP_RPM);
  if (!ipCheck.allowed) {
    res.setHeader("Retry-After", String(ipCheck.retryAfter));
    try {
      await storage.createAuditLog({
        orgId: (req.session?.orgId || "") as string,
        userId: req.session?.userId || null,
        action: "RATE_LIMIT_IP_BLOCKED",
        entityType: "api",
        entityId: req.path,
        details: { method: req.method, path: req.path, ip, limit: IP_RPM, bucket: "per-ip" },
      });
    } catch {}
    return res.status(429).json({ message: "Too many requests from this IP. Please slow down.", retryAfter: ipCheck.retryAfter });
  }

  const userId = req.session?.userId;
  if (userId) {
    const userCheck = checkTokenBucket(userBuckets, `user:${userId}`, USER_RPM);
    if (!userCheck.allowed) {
      res.setHeader("Retry-After", String(userCheck.retryAfter));
      try {
        await storage.createAuditLog({
          orgId: (req.session?.orgId || "") as string,
          userId,
          action: "RATE_LIMIT_USER_BLOCKED",
          entityType: "api",
          entityId: req.path,
          details: { method: req.method, path: req.path, userId, limit: USER_RPM, bucket: "per-user" },
        });
      } catch {}
      return res.status(429).json({ message: "Too many requests from this user. Please slow down.", retryAfter: userCheck.retryAfter });
    }
  }

  const orgId = req.session?.orgId;
  if (!orgId) return next();

  let maxRpm = isTestEnv ? 1_000_000 : 600;
  // In test mode keep the effectively-unlimited cap: the per-org override
  // below would otherwise reset maxRpm to the org's stored rateLimitRpm
  // (schema default 600, see shared/schema.ts), undoing the test bypass for
  // the tenant bucket and re-introducing spurious 429s under the parallel
  // suite. Production/dev are unaffected (isTestEnv is false there anyway).
  if (!isTestEnv) {
    try {
      const org = await storage.getOrg(orgId);
      if (org?.rateLimitRpm && org.rateLimitRpm > 0) maxRpm = org.rateLimitRpm;
    } catch {}
  }

  const tenantCheck = checkTokenBucket(tenantBuckets, `tenant:${orgId}`, maxRpm);
  if (!tenantCheck.allowed) {
    res.setHeader("Retry-After", String(tenantCheck.retryAfter));
    try {
      await storage.createAuditLog({
        orgId,
        userId: req.session?.userId || null,
        action: "RATE_LIMIT_EXCEEDED",
        entityType: "api",
        entityId: req.path,
        details: { method: req.method, path: req.path, limit: maxRpm, bucket: "per-tenant" },
      });
    } catch {}
    return res.status(429).json({ message: "Too many requests. Please slow down.", retryAfter: tenantCheck.retryAfter });
  }

  next();
}

export function getRateLimitInfo() {
  return {
    perIp: { rpm: IP_RPM, activeBuckets: ipBuckets.size },
    perUser: { rpm: USER_RPM, activeBuckets: userBuckets.size },
    perTenant: { defaultRpm: 600, activeBuckets: tenantBuckets.size },
    stricterBuckets: {
      "auth/*": "15min window, 100 max (loginLimiter)",
      "invoices/*/send": "15min window, 20 max (invoiceSendLimiter)",
      "payments/*": "5min window, 30 max (paymentLimiter)",
      "import/*": "1hr window, 10 max (importLimiter)",
    },
  };
}

const MFA_PENDING_ALWAYS_ALLOWED = new Set<string>([
  "/api/mfa/status",
  "/api/auth/logout",
]);
const MFA_PENDING_SETUP_ONLY = new Set<string>([
  "/api/mfa/totp/setup",
  "/api/mfa/totp/verify",
]);
const MFA_PENDING_CODE_ONLY = new Set<string>([
  "/api/mfa/totp/validate",
]);

export function rejectIfMfaPending(req: Request, res: Response): boolean {
  if (!req.session?.mfaPending) return false;
  const path = req.path;
  if (MFA_PENDING_ALWAYS_ALLOWED.has(path)) return false;
  const reason = req.session.mfaPendingReason;
  if (reason === "setup" && MFA_PENDING_SETUP_ONLY.has(path)) return false;
  if (reason === "code" && MFA_PENDING_CODE_ONLY.has(path)) return false;
  res.status(401).json({ message: "MFA required", mfaPending: true });
  return true;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    console.warn(`[auth] 401 Unauthorized: no session userId for ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (rejectIfMfaPending(req, res)) return;
  try {
    const user = await storage.getUserById(req.session.userId);
    if (!user || !user.isActive) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Account deactivated" });
    }
  } catch {
    return res.status(500).json({ message: "Auth check failed" });
  }
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    console.warn(`[auth] 401 Unauthorized: no session userId for ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (rejectIfMfaPending(req, res)) return;
  try {
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      console.warn(`[auth] 403 Forbidden: user not found for userId=${req.session.userId} on ${req.method} ${req.path}`);
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.role !== "ADMIN") {
      console.warn(`[auth] 403 Forbidden: user ${user.email} has role=${user.role}, needs ADMIN for ${req.method} ${req.path}`);
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  } catch (err: any) {
    console.error(`[auth] Error in requireAdmin for ${req.method} ${req.path}:`, err.message);
    return res.status(500).json({ message: "Internal server error during authorization" });
  }
}

export async function requireManagerOrAbove(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    console.warn(`[auth] 401 Unauthorized: no session userId for ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (rejectIfMfaPending(req, res)) return;
  try {
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      console.warn(`[auth] 403 Forbidden: user not found for userId=${req.session.userId} on ${req.method} ${req.path}`);
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!user.isActive) {
      console.warn(`[auth] 403 Forbidden: user ${user.email} is inactive on ${req.method} ${req.path}`);
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      console.warn(`[auth] 403 Forbidden: user ${user.email} has role=${user.role}, needs ADMIN or MANAGER for ${req.method} ${req.path}`);
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  } catch (err: any) {
    console.error(`[auth] Error in requireManagerOrAbove for ${req.method} ${req.path}:`, err.message);
    return res.status(500).json({ message: "Internal server error during authorization" });
  }
}

export const requireAdminOnly = requireAdmin;

/**
 * Marketing-scope authorization gate. Allows ADMIN or MANAGER through;
 * denies TEAM_MEMBER. Identical semantics to `requireManagerOrAbove`,
 * exported under a Marketing-intent name so call sites in
 * `server/routes/marketing*.ts` make the policy obvious. Do not use
 * for non-marketing surfaces — they remain ADMIN-only via
 * `requireAdmin`.
 */
export const requireAdminOrManager = requireManagerOrAbove;

/**
 * Platform-operator gate. Distinct from tenant ADMIN: a tenant admin must
 * NOT be able to reach cross-tenant maintenance endpoints. The operator
 * allow-list is sourced from the `PLATFORM_OPERATOR_EMAILS` env var
 * (comma- or whitespace-separated, case-insensitive). If the env var is
 * unset or empty the route reports 404 so it does not exist in misconfig.
 */
export function getPlatformOperatorEmails(): string[] {
  const raw = process.env.PLATFORM_OPERATOR_EMAILS || "";
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isPlatformOperatorUserId(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  const allowed = getPlatformOperatorEmails();
  if (allowed.length === 0) return false;
  try {
    const user = await storage.getUserById(userId);
    if (!user || !user.isActive || !user.email) return false;
    return allowed.includes(user.email.trim().toLowerCase());
  } catch {
    return false;
  }
}

export async function requirePlatformOperator(req: Request, res: Response, next: NextFunction) {
  // Hide existence of the route entirely when env var not configured.
  const allowed = getPlatformOperatorEmails();
  if (allowed.length === 0) {
    return res.status(404).json({ message: "Not found" });
  }
  if (!req.session.userId) {
    return res.status(404).json({ message: "Not found" });
  }
  // Existence-hiding contract: pending sessions also look like 404.
  if (req.session.mfaPending) {
    return res.status(404).json({ message: "Not found" });
  }
  const ok = await isPlatformOperatorUserId(req.session.userId);
  if (!ok) {
    return res.status(404).json({ message: "Not found" });
  }
  next();
}

export function stripCostFieldsForRole(data: any, userRole: string | undefined): any {
  // Policy: ADMIN and MANAGER are trusted with cost / profit / margin visibility.
  // The project-detail UI already gates the Profitability tab on
  // (role === "ADMIN" || role === "MANAGER"), so the API contract must match
  // or managers see an empty/broken panel. Everyone else (TEAM_MEMBER, etc.)
  // gets these sensitive financial fields scrubbed recursively.
  if (userRole === "ADMIN" || userRole === "MANAGER") return data;
  if (data == null) return data;
  const COST_FIELDS = [
    "costRateHourly",
    "costRateSnapshot",
    "costRate",
    "costAmount",
    "totalCost",
    "laborCost",
    "profit",
    "profitability",
    "margin",
    "profitMargin",
  ];
  const scrub = (obj: any): any => {
    if (obj == null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(scrub);
    const out: any = {};
    for (const k of Object.keys(obj)) {
      if (COST_FIELDS.includes(k)) continue;
      out[k] = scrub(obj[k]);
    }
    return out;
  };
  return scrub(data);
}

export async function requirePlanTier(req: Request, res: Response, tiers: string[], featureName: string): Promise<boolean> {
  const org = await storage.getOrg(req.session.orgId!);
  const currentTier = org?.planTier || "TRIAL";
  if (!tiers.includes(currentTier)) {
    const tierLabel = tiers.includes("PROFESSIONAL") ? "Professional" : "Business";
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "FEATURE_GATE_BLOCKED",
      entityType: "feature_gate",
      entityId: featureName,
      details: { feature: featureName, currentTier, requiredTiers: tiers },
    });
    res.status(403).json({
      message: `${featureName} requires ${tierLabel} plan or higher. Please upgrade.`,
      requiredTier: tierLabel.toUpperCase(),
      currentTier,
    });
    return false;
  }
  return true;
}

export function extractDomain(url: string): string | null {
  try {
    let cleaned = url.trim();
    if (!cleaned.match(/^https?:\/\//i)) cleaned = "https://" + cleaned;
    const parsed = new URL(cleaned);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function fetchClientLogo(website: string): Promise<string | null> {
  const domain = extractDomain(website);
  if (!domain) return null;
  const clearbitUrl = `https://logo.clearbit.com/${domain}`;
  try {
    const res = await fetch(clearbitUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (res.ok) return clearbitUrl;
  } catch {}
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function plainTextToHtml(text: string, orgName?: string): string {
  const bodyContent = `<div style="font-size:15px;color:#555770;line-height:1.7;white-space:pre-wrap;">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  return wrapEmailLayout(bodyContent, { orgName });
}

export const EDITABLE_STATUSES = ["DRAFT", "SENT", "PARTIAL"];

export function buildInvoiceSnapshot(invoice: any) {
  return {
    number: invoice.number,
    status: invoice.status,
    issuedDate: invoice.issuedDate,
    dueDate: invoice.dueDate,
    subtotal: invoice.subtotal,
    discountType: invoice.discountType,
    discountValue: invoice.discountValue,
    discountAmount: invoice.discountAmount,
    taxRate: invoice.taxRate,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    paidAmount: invoice.paidAmount,
    notes: invoice.notes,
    clientName: invoice.clientName,
    currency: invoice.currency,
    lines: (invoice.lines || []).map((l: any) => ({
      id: l.id,
      description: l.description,
      quantity: l.quantity,
      unitRate: l.unitRate,
      amount: l.amount,
      sortOrder: l.sortOrder,
      isHeader: l.isHeader,
    })),
  };
}

export async function saveRevisionIfNeeded(invoiceId: string, orgId: string, reason: string) {
  const invoice = await storage.getInvoice(invoiceId, orgId);
  if (!invoice) return;
  if (invoice.status === "DRAFT") return;
  await storage.createInvoiceRevision(invoiceId, buildInvoiceSnapshot(invoice), reason, orgId);
}

export async function createAutoJournalEntry(
  orgId: string,
  entryDate: string,
  memo: string,
  sourceType: string,
  sourceId: string | number,
  lines: { accountNumber: string; debit: string; credit: string; memo?: string }[],
  createdByUserId?: string | null,
) {
  try {
    const sourceRef = typeof sourceId === "string" ? sourceId : null;
    const existingJEs = await storage.getGLJournalEntriesByOrg(orgId, { sourceType });
    const alreadyPosted = existingJEs.some(je => je.sourceRef === sourceRef && sourceRef);
    if (alreadyPosted) return;
    const accounts = await storage.getGLAccountsByOrg(orgId);
    if (accounts.length === 0) return;
    const acctMap = new Map(accounts.map(a => [a.accountNumber, a]));
    const journalLines: { accountId: number; debit: string; credit: string; memo?: string }[] = [];
    for (const line of lines) {
      const acct = acctMap.get(line.accountNumber);
      if (!acct) continue;
      journalLines.push({ accountId: acct.id, debit: line.debit, credit: line.credit, memo: line.memo });
    }
    if (journalLines.length === 0) return;
    try {
      await storage.createGLJournalEntry(
        orgId, entryDate, memo, sourceType,
        typeof sourceId === "number" ? sourceId : null,
        true, createdByUserId || null, journalLines, sourceRef,
      );
    } catch (insertErr: any) {
      if (insertErr?.code === "23505") return;
      throw insertErr;
    }
  } catch (err) {
    console.error("[GL] Auto journal entry failed:", err);
    try {
      await storage.createAuditLog({ orgId, userId: createdByUserId || null, action: "GL_AUTO_JOURNAL_FAILED", entityType: sourceType, entityId: typeof sourceId === "string" ? sourceId : String(sourceId), details: { error: sanitizeErrorMessage(err) } });
    } catch {}
  }
}

export async function isGlPosted(orgId: string, sourceType: string, sourceRef: string): Promise<boolean> {
  const entries = await storage.getGLJournalEntriesByOrg(orgId, { sourceType });
  return entries.some(je => je.sourceRef === sourceRef);
}

export async function reverseGLBySourceRef(
  orgId: string,
  sourceType: string,
  sourceRef: string,
  reversalMemo: string,
  reversalSourceType: string,
  userId: string | null,
): Promise<boolean> {
  try {
    const entries = await storage.getGLJournalEntriesByOrg(orgId, { sourceType });
    const original = entries.find(je => je.sourceRef === sourceRef);
    if (!original || !original.lines || original.lines.length === 0) return false;

    const existingReversals = await storage.getGLJournalEntriesByOrg(orgId, { sourceType: reversalSourceType });
    const alreadyReversed = existingReversals.some(je => je.sourceRef === `${sourceRef}-reverse`);
    if (alreadyReversed) return true;

    const reversalLines = original.lines.map((line: any) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      memo: reversalMemo,
    }));

    await storage.createGLJournalEntry(
      orgId,
      new Date().toISOString().split("T")[0],
      reversalMemo,
      reversalSourceType,
      null,
      true,
      userId,
      reversalLines,
      `${sourceRef}-reverse`,
    );
    return true;
  } catch (err) {
    console.error(`[GL] Reversal failed for ${sourceType}/${sourceRef}:`, err);
    return false;
  }
}

export function buildInvoiceEmailHtml(opts: {
  clientName: string;
  invoiceNumber: string;
  total: string;
  dueDate: string;
  viewLink: string;
  pdfLink: string;
  portalLink: string | null;
  orgName: string;
  isResend: boolean;
  customMessage?: string;
}): string {
  const { clientName, invoiceNumber, total, dueDate, viewLink, pdfLink, portalLink, orgName, isResend, customMessage } = opts;

  const innerHtml = `
    ${isResend ? '<p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#8b8da3;margin:0 0 20px;">Reminder</p>' : ''}

    <p style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 4px;">Invoice ${invoiceNumber}</p>
    <p style="font-size:14px;color:#8b8da3;margin:0 0 28px;">From ${escapeHtml(orgName)}</p>

    ${customMessage
      ? `<div style="font-size:15px;color:#555770;line-height:1.7;margin:0 0 24px;white-space:pre-wrap;">${escapeHtml(customMessage).replace(/\n/g, "<br>")}</div>`
      : `<p style="font-size:15px;color:#555770;line-height:1.7;margin:0 0 24px;">
      Hi ${escapeHtml(clientName)}, please find ${isResend ? 'the resent' : 'your'} invoice below for <strong style="color:#1a1a2e;">$${total}</strong>.
    </p>`}

    ${emailDetailCard(
      emailKeyValue("Invoice", invoiceNumber) +
      emailKeyValue("Amount", `<span style="font-size:16px;color:#1a1a2e;">$${total}</span>`) +
      emailKeyValue("Due Date", dueDate)
    )}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr><td align="center" style="padding-bottom:12px;">${emailButton("View Invoice", viewLink)}</td></tr>
      <tr><td align="center">${emailButton("Download PDF", pdfLink, { secondary: true })}</td></tr>
    </table>

    ${portalLink ? `
    ${emailDivider()}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:8px;">
      <tr><td style="padding:16px 20px;">
        <p style="font-size:14px;font-weight:600;color:#1a1a2e;margin:0 0 4px;">Client Portal</p>
        <p style="font-size:13px;color:#555770;margin:0 0 8px;">View all your invoices and payment history in one place.</p>
        <a href="${portalLink}" style="font-size:13px;font-weight:600;color:#1a1a2e;text-decoration:underline;">Open portal &rarr;</a>
      </td></tr>
    </table>
    ` : ''}

    ${emailDivider()}
    <p style="font-size:14px;color:#555770;margin:0;">Thank you for your business.</p>
  `;

  return wrapEmailLayout(innerHtml, { orgName, preheader: `Invoice ${invoiceNumber} for $${total}` });
}

export { wrapEmailLayout, emailButton, emailDivider, emailDetailCard, emailKeyValue };

const SENSITIVE_FIELD_NAMES = new Set([
  "bankAccountNumber",
  "bankRoutingNumber",
  "ssnLast4",
  "taxIdLast4",
  "smtpPass",
  "apiKey",
]);

const SENSITIVE_FIELD_PATTERNS = [
  /encrypted/i,
  /secret/i,
  /token/i,
  /password/i,
];

function isSensitiveField(key: string): boolean {
  if (SENSITIVE_FIELD_NAMES.has(key)) return true;
  return SENSITIVE_FIELD_PATTERNS.some(p => p.test(key));
}

function maskValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (!str || str.length === 0) return value;
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes("accountnumber") || lowerKey.includes("routingnumber")) {
    return str.length > 4 ? "****" + str.slice(-4) : "****";
  }
  if (lowerKey.includes("ssnlast4") || lowerKey.includes("taxidlast4")) {
    return "********";
  }
  return "********";
}

export function maskSensitiveFields<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (isSensitiveField(key) && result[key] !== null && result[key] !== undefined) {
      (result as any)[key] = maskValue(key, result[key]);
    }
  }
  return result;
}

export function maskSensitiveArray<T extends Record<string, unknown>>(arr: T[]): T[] {
  return arr.map(item => maskSensitiveFields(item));
}
