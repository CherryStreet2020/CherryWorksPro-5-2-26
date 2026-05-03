import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { orgs, auditLogs, signupSchema, loginSchema, passwordResetTokens, users } from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, loginLimiter, signupLimiter, passwordChangeLimiter, forgotPasswordLimiter, setCSRFToken, awaitSessionSave } from "./middleware";
import { hashPassword, comparePasswords, validatePasswordStrength, needsRehash, rehashAndUpdate } from "../auth";
import { randomBytes, createHash } from "crypto";
import { sendPasswordResetEmail, sendWelcomeEmail, getSmtpConfigFromOrg } from "../email";
import { getMfa, isOrgMfaEnforcedForAdmins } from "./mfa-routes";
import { trackSession, removeSessionByHash, hashSessionId } from "./session-routes";
import multer from "multer";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";

function escapeLikePattern(str: string): string {
  return str.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; firstAttempt: number }>();

function checkAndRecordFailedAttempt(email: string): { locked: boolean; remainingMs: number } {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (entry && now - entry.firstAttempt > LOCKOUT_WINDOW_MS) {
    failedAttempts.delete(key);
  }
  const current = failedAttempts.get(key);
  if (current && current.count >= LOCKOUT_MAX_ATTEMPTS) {
    const remainingMs = LOCKOUT_WINDOW_MS - (now - current.firstAttempt);
    return { locked: true, remainingMs };
  }
  return { locked: false, remainingMs: 0 };
}

function recordFailedLogin(email: string) {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now - entry.firstAttempt > LOCKOUT_WINDOW_MS) {
    failedAttempts.set(key, { count: 1, firstAttempt: now });
  } else {
    entry.count++;
  }
}

function clearFailedLogin(email: string) {
  failedAttempts.delete(email.toLowerCase());
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

const ALLOWED_AVATAR_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const isTestEnv = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTestEnv ? 1000 : 5,
  message: { message: "Too many avatar uploads. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId || getClientIp(req),
});

export function registerAuthRoutes(app: Express) {
// Apply awaitSessionSave only to the routes that establish or transition auth
// state. The middleware defers the response body until req.session.save()
// resolves so the Set-Cookie header and session row are persisted before the
// client sees a success response (fixes a cold-start race) and fails closed
// with 500 if the save errors. Mounted per-route to avoid forcing an extra
// session write on every read in /api/auth or /api/mfa.
app.post("/api/auth/login", loginLimiter, awaitSessionSave, async (req, res) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const clientIp = getClientIp(req);

    const lockout = checkAndRecordFailedAttempt(parsed.email);
    if (lockout.locked) {
      const mins = Math.ceil(lockout.remainingMs / 60000);
      return res.status(429).json({ message: `Too many failed attempts. Try again in ${mins} minute(s).` });
    }

    const finalizeLogin = async (user: any) => {
      clearFailedLogin(parsed.email);

      // user_role enum is upper-case; compare case-insensitively.
      const roleLower = String(user.role || "").toLowerCase();
      const isAdmin = roleLower === "admin" || roleLower === "owner";
      if (isAdmin) {
        const enforced = await isOrgMfaEnforcedForAdmins(user.orgId);
        if (enforced) {
          const mfa = await getMfa(user.id);
          if (!mfa || !mfa.enabled) {
            req.session.regenerate((err) => {
              if (err) return res.status(500).json({ message: "Login failed" });
              req.session.userId = user.id;
              req.session.orgId = user.orgId;
              req.session.role = user.role;
              req.session.lastActivity = Date.now();
              req.session.mfaPending = true;
              req.session.mfaPendingReason = "setup";
              setCSRFToken(res);
              return res.json({ requiresMfaSetup: true });
            });
            return;
          }
          req.session.regenerate((err) => {
            if (err) return res.status(500).json({ message: "Login failed" });
            req.session.userId = user.id;
            req.session.orgId = user.orgId;
            req.session.role = user.role;
            req.session.lastActivity = Date.now();
            req.session.mfaPending = true;
            req.session.mfaPendingReason = "code";
            setCSRFToken(res);
            return res.json({ requiresMfaCode: true });
          });
          return;
        }
      }

      rehashAndUpdate(parsed.password, user.password, user.id, user.orgId).catch(() => {});

      req.session.regenerate((err) => {
        if (err) {
          console.error("[auth] Session regeneration failed:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        req.session.userId = user.id;
        req.session.orgId = user.orgId;
        req.session.role = user.role;
        req.session.lastActivity = Date.now();
        setCSRFToken(res);

        storage.updateUser(user.id, user.orgId, { lastLoginAt: new Date() } as any).catch(() => {});

        storage.createAuditLog({
          orgId: user.orgId,
          userId: user.id,
          action: "LOGIN_SUCCESS",
          entityType: "user",
          entityId: user.id,
          details: { ip: clientIp },
        }).catch(() => {});

        trackSession(req).catch(() => {});

        const { password: _, orgName: _on, orgSlug: _os, ...safeUser } = user;
        return res.json(safeUser);
      });
    };

    if (parsed.orgSlug) {
      const user = await storage.getUserByOrgSlugAndEmail(parsed.orgSlug, parsed.email);
      if (!user) {
        recordFailedLogin(parsed.email);
        storage.createAuditLog({ orgId: null as any, userId: null, action: "LOGIN_FAILED", entityType: "user", entityId: "unknown", details: { email: parsed.email, ip: clientIp, reason: "invalid_credentials" } }).catch(() => {});
        return res.status(401).json({ message: "Invalid credentials" });
      }
      if (!user.isActive) return res.status(403).json({ message: "Your account has been deactivated. Please contact your administrator." });
      const valid = await comparePasswords(parsed.password, user.password);
      if (!valid) {
        recordFailedLogin(parsed.email);
        storage.createAuditLog({ orgId: user.orgId, userId: user.id, action: "LOGIN_FAILED", entityType: "user", entityId: user.id, details: { email: parsed.email, ip: clientIp, reason: "wrong_password" } }).catch(() => {});
        return res.status(401).json({ message: "Invalid credentials" });
      }
      return await finalizeLogin(user);
    }

    const candidates = await storage.getActiveUsersByEmail(parsed.email);
    if (candidates.length === 0) {
      recordFailedLogin(parsed.email);
      storage.createAuditLog({ orgId: null as any, userId: null, action: "LOGIN_FAILED", entityType: "user", entityId: "unknown", details: { email: parsed.email, ip: clientIp, reason: "no_account" } }).catch(() => {});
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const matches = [];
    for (const c of candidates) {
      if (await comparePasswords(parsed.password, c.password)) matches.push(c);
    }
    if (matches.length === 0) {
      recordFailedLogin(parsed.email);
      storage.createAuditLog({ orgId: null as any, userId: null, action: "LOGIN_FAILED", entityType: "user", entityId: "unknown", details: { email: parsed.email, ip: clientIp, reason: "wrong_password" } }).catch(() => {});
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (matches.length === 1) {
      return await finalizeLogin(matches[0]);
    }

    return res.status(200).json({
      needsOrgPick: true,
      orgs: matches.map(m => ({ slug: m.orgSlug, name: m.orgName })),
    });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  if (req.session.mfaPending) {
    return res.status(401).json({ message: "MFA required", mfaPending: true });
  }
  const user = await storage.getUserById(req.session.userId);
  if (user && !user.isActive) {
    req.session.destroy((err) => { if (err) console.error("[auth] Deactivated session destroy:", err); });
    return res.status(403).json({ message: "Your account has been deactivated." });
  }
  if (!user) {
    return res.status(401).json({ message: "User not found" });
  }
  const { password: _, ...safeUser } = user;
  return res.json(safeUser);
});
app.patch("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const { firstName, lastName, phone } = req.body;
    const updates: Record<string, string> = {};
    if (typeof firstName === "string" && firstName.trim().length > 0) updates.firstName = firstName.trim();
    if (typeof lastName === "string") updates.lastName = lastName.trim();
    if (updates.firstName || updates.lastName) {
      const currentUser = await storage.getUserById(userId);
      const fn = updates.firstName ?? currentUser?.firstName ?? "";
      const ln = updates.lastName ?? currentUser?.lastName ?? "";
      updates.name = [fn, ln].filter(Boolean).join(" ");
    }
    if (typeof phone === "string") updates.phone = phone.trim();
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }
    const updated = await storage.updateUser(userId, orgId, updates);
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safe } = updated;
    return res.json(safe);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
const avatarDir = path.join(process.cwd(), "uploads", "avatars");
fs.mkdirSync(avatarDir, { recursive: true });
const avatarUpload = multer({
  dest: avatarDir,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  },
});
app.post("/api/auth/me/avatar", requireAuth, avatarUploadLimiter, avatarUpload.single("avatar"), async (req, res) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No valid image uploaded (max 2MB, jpeg/png/webp/gif)" });

    const safeName = path.basename(file.originalname);
    const ext = path.extname(safeName).toLowerCase();
    if (!ALLOWED_AVATAR_EXTS.has(ext)) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ message: "Invalid file type. Allowed: jpg, jpeg, png, webp, gif" });
    }
    const sanitizedName = `${userId}-${Date.now()}${ext}`.replace(/[^a-zA-Z0-9.-]/g, "");
    const newPath = path.join(avatarDir, sanitizedName);
    fs.renameSync(file.path, newPath);
    const avatarUrl = `/uploads/avatars/${sanitizedName}`;
    const updated = await storage.updateUser(userId, orgId, { avatarUrl });
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safe } = updated;
    return res.json(safe);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/csrf-token", (req, res) => {
  if (req.session?.userId) {
    const token = setCSRFToken(res);
    return res.json({ token });
  }
  return res.status(401).json({ message: "Not authenticated" });
});
app.post("/api/auth/logout", (req, res) => {
  const hashedSid = req.sessionID ? hashSessionId(req.sessionID) : null;
  res.clearCookie("csrf-token", { path: "/" });
  req.session.destroy((err) => {
    if (err) console.error("[auth] Session destroy failed:", err);
    if (hashedSid) removeSessionByHash(hashedSid).catch(() => {});
    res.json({ ok: true });
  });
});

// ─── SELF-SERVICE SIGNUP ──────────────────────────────────
app.post("/api/auth/signup", signupLimiter, awaitSessionSave, async (req, res) => {
  try {
    const parsed = signupSchema.parse(req.body);

    const emailDomain = parsed.email.split("@")[1]?.toLowerCase();
    if (emailDomain) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentSignups = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.action, "ORG_CREATED"),
          gte(auditLogs.createdAt, oneDayAgo),
          sql`${auditLogs.details}::text LIKE ${`%${escapeLikePattern(emailDomain)}%`}`,
        ));
      if (recentSignups.length >= 3) {
        console.warn(`[signup] Domain rate limit hit: ***@${emailDomain} (${recentSignups.length} signups in 24h)`);
        return res.status(429).json({
          message: "Too many accounts created from this email domain. Please try again later or contact support.",
        });
      }
    }

    const pwError = validatePasswordStrength(parsed.password);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }

    const baseSlug = parsed.firmName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    let slug = baseSlug || 'org';
    let counter = 1;
    while (await storage.getOrgBySlug(slug)) {
      slug = (baseSlug || 'org') + '-' + counter;
      counter++;
    }

    const existingInSlug = await storage.getUserByOrgSlugAndEmail(slug, parsed.email);
    if (existingInSlug) {
      return res.status(400).json({ message: "Unable to create account. Please try a different email or contact support." });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(503).json({ message: "Billing service unavailable, please try again" });
    }

    const fullName = [parsed.firstName, parsed.lastName].filter(Boolean).join(" ");
    let stripeCustomerId: string;
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey);
      const customer = await stripe.customers.create({
        email: parsed.email,
        name: fullName,
        metadata: {
          firmName: parsed.firmName,
        },
      });
      stripeCustomerId = customer.id;
    } catch (stripeErr: any) {
      console.error("[signup] Stripe customer creation failed:", stripeErr.message);
      return res.status(503).json({ message: "Billing service unavailable, please try again" });
    }

    const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const hashed = await hashPassword(parsed.password);

    let org: any;
    let user: any;
    try {
      const result = await db.transaction(async (tx) => {
        const [newOrg] = await tx.insert(orgs).values({
          name: parsed.firmName,
          slug,
          planTier: "TRIAL",
          subscriptionStatus: "trialing",
          maxTeamMembers: 999999,
          trialEndsAt: trialEnds,
          stripeCustomerId,
        }).returning();

        const [newUser] = await tx.insert(users).values({
          orgId: newOrg.id,
          email: parsed.email,
          password: hashed,
          name: fullName,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          role: "ADMIN",
          isActive: true,
          onboardingComplete: true,
          tempPassword: false,
        }).returning();

        return { org: newOrg, user: newUser };
      });
      org = result.org;
      user = result.user;
    } catch (dbErr: any) {
      console.error("[signup] DB transaction failed, cleaning up Stripe customer:", dbErr.message);
      try {
        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(stripeKey);
        await stripe.customers.del(stripeCustomerId);
      } catch (cleanupErr: any) {
        console.error("[signup] Stripe customer cleanup failed:", cleanupErr.message);
      }
      const isDuplicate = /unique|duplicate|already exists/i.test(dbErr.message);
      return res.status(isDuplicate ? 409 : 500).json({ message: isDuplicate ? "Unable to create account. Please try a different email or contact support." : "Account creation failed, please try again" });
    }

    req.session.userId = user.id;
    req.session.orgId = org.id;
    req.session.role = user.role;
    req.session.lastActivity = Date.now();
    setCSRFToken(res);

    await storage.createAuditLog({
      orgId: org.id,
      userId: user.id,
      action: "ORG_CREATED",
      entityType: "org",
      entityId: org.id,
      details: { firmName: parsed.firmName, plan: parsed.plan, email: parsed.email },
    });

    // Welcome email — best-effort. Three audit actions distinguish intent
    // (ATTEMPTED) from outcome (SUCCEEDED/FAILED).
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol || "http";
    const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0] || req.get("host") || "localhost";
    const loginUrl = `${proto}://${host}/login`;
    storage.createAuditLog({
      orgId: org.id,
      userId: user.id,
      action: "WELCOME_EMAIL_DISPATCH_ATTEMPTED",
      entityType: "user",
      entityId: user.id,
      details: { email: parsed.email, firmName: parsed.firmName },
    }).catch(() => {});
    sendWelcomeEmail(parsed.email, fullName, parsed.firmName, loginUrl, null, org)
      .then(() => {
        storage.createAuditLog({
          orgId: org.id,
          userId: user.id,
          action: "WELCOME_EMAIL_SUCCEEDED",
          entityType: "user",
          entityId: user.id,
          details: { email: parsed.email },
        }).catch(() => {});
      })
      .catch((err) => {
        console.error("[signup] sendWelcomeEmail failed:", err?.message || err);
        storage.createAuditLog({
          orgId: org.id,
          userId: user.id,
          action: "WELCOME_EMAIL_FAILED",
          entityType: "user",
          entityId: user.id,
          details: { email: parsed.email, error: String(err?.message || err) },
        }).catch(() => {});
      });

    const { password: _, ...safeUser } = user;
    return res.json({
      user: safeUser,
      org: { id: org.id, name: org.name, slug: org.slug, planTier: org.planTier },
      stripeCustomerId,
    });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.patch("/api/auth/change-password", passwordChangeLimiter, requireAuth, awaitSessionSave, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ message: "New password is required" });
    }
    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.tempPassword) {
      if (!currentPassword) return res.status(400).json({ message: "Current password is required" });
      const valid = await comparePasswords(currentPassword, user.password);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });
    }
    // Treat "change to same password" as a successful no-op (no strength enforcement).
    if (currentPassword && newPassword === currentPassword) {
      return res.json({ ok: true });
    }
    const pwError = validatePasswordStrength(newPassword);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }
    const hashed = await hashPassword(newPassword);
    await storage.updateUser(user.id, req.session.orgId!, { password: hashed, tempPassword: false });

    const allAccounts = await storage.getActiveUsersByEmail(user.email);
    const allUserIds = allAccounts.map((u) => u.id);
    if (allUserIds.length > 0) {
      await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, allUserIds));
    }

    await storage.createAuditLog({
      orgId: user.orgId,
      userId: user.id,
      action: "PASSWORD_CHANGED",
      entityType: "user",
      entityId: user.id,
      details: { method: user.tempPassword ? "temp_password_reset" : "self_service" },
    });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ message: "Session error" });
      req.session.userId = user.id;
      req.session.orgId = user.orgId;
      req.session.role = user.role;
      return res.json({ ok: true });
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/auth/revoke-reset-tokens", requireAuth, async (req, res) => {
  try {
    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });

    const allAccounts = await storage.getActiveUsersByEmail(user.email);
    const allUserIds = allAccounts.map((u) => u.id);
    if (allUserIds.length > 0) {
      await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, allUserIds));
    }

    await storage.createAuditLog({
      orgId: user.orgId,
      userId: user.id,
      action: "RESET_TOKENS_REVOKED",
      entityType: "user",
      entityId: user.id,
      details: { email: user.email, accountsAffected: allUserIds.length },
    });

    return res.json({ ok: true, message: "All password reset tokens have been revoked" });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.patch("/api/auth/complete-onboarding", requireAuth, async (req, res) => {
  try {
    const {
      name, firstName, lastName, phone, legalName, payToName, ein,
      mailingAddress, addressLine1, addressLine2, addressCity, addressState, addressZip, addressCountry,
      taxIdLast4, paymentMethod, bankName, bankRoutingNumber, bankAccountNumber, bankAccountType,
      zelleContact, w9OnFile, agreementSigned,
    } = req.body;
    const user = await storage.getUserById(req.session.userId!);
    const is1099 = user?.workerType === "INDEPENDENT" || user?.workerType === "CORP_TO_CORP";
    const updates: Record<string, unknown> = { onboardingComplete: true, is1099Eligible: is1099 };
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (firstName || lastName) {
      const fn = firstName ?? user?.firstName ?? "";
      const ln = lastName ?? user?.lastName ?? "";
      updates.name = [fn, ln].filter(Boolean).join(" ");
    } else if (name) {
      updates.name = name;
    }
    if (phone !== undefined) updates.phone = phone;
    if (legalName !== undefined) updates.legalName = legalName;
    if (payToName !== undefined) updates.payToName = payToName;
    if (ein !== undefined) updates.ein = ein;
    if (mailingAddress !== undefined) updates.mailingAddress = mailingAddress;
    if (addressLine1 !== undefined) updates.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) updates.addressLine2 = addressLine2;
    if (addressCity !== undefined) updates.addressCity = addressCity;
    if (addressState !== undefined) updates.addressState = addressState;
    if (addressZip !== undefined) updates.addressZip = addressZip;
    if (addressCountry !== undefined) updates.addressCountry = addressCountry;
    if (taxIdLast4 !== undefined) updates.taxIdLast4 = taxIdLast4;
    if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
    if (bankName !== undefined) updates.bankName = bankName;
    if (bankRoutingNumber !== undefined) updates.bankRoutingNumber = bankRoutingNumber;
    if (bankAccountNumber !== undefined) updates.bankAccountNumber = bankAccountNumber;
    if (bankAccountType !== undefined) updates.bankAccountType = bankAccountType;
    if (zelleContact !== undefined) updates.zelleContact = zelleContact;
    if (w9OnFile !== undefined) updates.w9OnFile = w9OnFile;
    if (agreementSigned !== undefined) updates.agreementSigned = agreementSigned;
    const updated = await storage.updateUser(req.session.userId!, req.session.orgId!, updates as any);
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safeUser } = updated;
    return res.json(safeUser);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
  try {
    const { email, orgSlug } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Email is required" });
    }

    const appBaseUrl = process.env.APP_BASE_URL
      || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : "http://localhost:5000");

    let usersToReset: Array<{ id: string; orgId: string; email: string }> = [];

    if (orgSlug && typeof orgSlug === "string") {
      const user = await storage.getUserByOrgSlugAndEmail(orgSlug, email.trim().toLowerCase());
      if (user && user.isActive) usersToReset.push(user);
    } else {
      const candidates = await storage.getActiveUsersByEmail(email.trim().toLowerCase());
      usersToReset = candidates;
    }

    for (const user of usersToReset) {
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token: tokenHash,
        expiresAt,
      });

      const resetUrl = `${appBaseUrl}/reset-password/${token}`;

      let smtpConfig = null;
      let org: Awaited<ReturnType<typeof storage.getOrg>> | null = null;
      if (user.orgId) {
        org = (await storage.getOrg(user.orgId)) ?? null;
        if (org) {
          smtpConfig = getSmtpConfigFromOrg(org);
        }
      }

      try {
        await sendPasswordResetEmail(email, resetUrl, smtpConfig, org);
      } catch (emailErr: any) {
        console.error("[auth] Failed to send password reset email:", emailErr.message);
      }
    }

    storage.createAuditLog({
      orgId: usersToReset[0]?.orgId || (null as any),
      userId: usersToReset[0]?.id || null,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "user",
      entityId: usersToReset[0]?.id || "unknown",
      details: { email: email.trim().toLowerCase() },
    }).catch(() => {});

    return res.json({ message: "If that email exists, a reset link has been sent." });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/auth/reset-password/:token", passwordChangeLimiter, async (req, res) => {
  try {
    const token = req.params.token as string;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.token, tokenHash), gte(passwordResetTokens.expiresAt, new Date())));

    if (!record) {
      return res.status(400).json({ valid: false, message: "This reset link is invalid or has expired." });
    }

    return res.json({ valid: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/auth/reset-password/:token", passwordChangeLimiter, async (req, res) => {
  try {
    const token = req.params.token as string;
    const { password } = req.body;

    if (!password || typeof password !== "string") {
      return res.status(400).json({ message: "Password is required" });
    }

    const strengthErr = validatePasswordStrength(password);
    if (strengthErr) {
      return res.status(400).json({ message: strengthErr });
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.token, tokenHash), gte(passwordResetTokens.expiresAt, new Date())));

    if (!record) {
      return res.status(400).json({ message: "This reset link is invalid or has expired." });
    }

    const hashed = await hashPassword(password);
    await db.update(users).set({ password: hashed, tempPassword: false }).where(eq(users.id, record.userId));

    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, record.userId));

    const resetUser = await storage.getUserById(record.userId);
    await storage.createAuditLog({
      orgId: resetUser?.orgId || (null as any),
      userId: record.userId,
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "user",
      entityId: record.userId,
      details: {},
    });

    console.log(`[auth] Password reset completed for user ${record.userId}`);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ message: "Session error" });
      return res.json({ message: "Password has been reset successfully. You can now log in." });
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
