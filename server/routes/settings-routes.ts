import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "crypto";
import { invoices, payments, services, orgs, users, expenses, clients, projects } from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, requireAdmin, apiLimiter, settingsUpdateLimiter, escapeHtml, wrapEmailLayout, emailDetailCard, emailKeyValue, maskSensitiveFields } from "./middleware";
import { hashPassword, comparePasswords } from "../auth";
import { sendInvoiceEmail, encryptSmtpPassword, getSmtpConfigFromOrg, clearTransporterCache } from "../email";
import { maskEmail } from "../utils/mask-email";
import { getExchangeRate, getMultipleRates } from "../exchange-rates";
import { newsletterSubscribers } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";

export function buildAccountDeletionScheduledEmailHtml(opts: { orgName: string; formattedDate: string }): string {
  const { orgName, formattedDate } = opts;
  return wrapEmailLayout(`
          ${emailDetailCard(`
            ${emailKeyValue("Scheduled Deletion Date", formattedDate)}
            <p style="margin-top:16px;color:#555;">Your account and all organization data will be permanently deleted on <strong>${formattedDate}</strong>.</p>
            <p style="margin-top:8px;color:#555;">To cancel, log in before that date and visit <strong>Settings</strong>.</p>
          `, "Account Deletion Scheduled")}
        `, { orgName });
}

export function buildAccountDeactivationEmailHtml(opts: { orgName: string }): string {
  const { orgName } = opts;
  return wrapEmailLayout(`
          ${emailDetailCard(`
            <p style="color:#555;">Your account has been deactivated and your personal data removed.</p>
            <p style="margin-top:8px;color:#555;">If you believe this was an error, contact your organization administrator.</p>
          `, "Account Deactivated")}
        `, { orgName });
}

export function registerSettingsRoutes(app: Express) {

app.post("/api/newsletter/subscribe", async (req: Request, res: Response) => {
  try {
    const emailSchema = z.object({ email: z.string().email() });
    const { email } = emailSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase().trim();

    await db
      .insert(newsletterSubscribers)
      .values({ email: normalizedEmail })
      .onConflictDoNothing();

    try {
      const { createTransporter } = await import("../email");
      const transporter = await createTransporter();
      if (transporter) {
        await transporter.sendMail({
          from: process.env.SMTP_USER || "noreply@cherryworkspro.com",
          to: "info@cherrystconsulting.com",
          subject: `[CherryWorks Pro] New newsletter subscriber`,
          text: `New subscriber: ${normalizedEmail}`,
          html: `<p>New newsletter subscriber: <strong>${normalizedEmail}</strong></p><p>Subscribed at ${new Date().toISOString()}</p>`,
        });
      }
    } catch (emailErr: any) {
      console.error("[newsletter] Failed to send subscriber notification:", emailErr.message);
    }

    return res.json({ success: true });
  } catch (err: any) {
    if (err?.name === "ZodError") {
      return res.status(400).json({ message: "Please enter a valid email address" });
    }
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});
app.get("/api/stripe-config", requireAuth, async (_req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return res.status(400).json({ message: "Stripe is not configured" });
  }
  return res.json({ publishableKey });
});
app.get("/api/exchange-rate", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ message: "from and to required" });
    const result = await getExchangeRate(String(from), String(to), req.session.orgId!);
    if (result.error && result.rate === 0) {
      return res.status(503).json({ message: result.error, from, to });
    }
    return res.json({ from, to, rate: result.rate, stale: result.stale, lastUpdated: result.lastUpdated, warning: result.error || undefined });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/exchange-rates", requireAuth, async (req, res) => {
  try {
    const org = await storage.getOrg(req.session.orgId!);
    const baseCurrency = org?.baseCurrency || "USD";
    const targets = String(req.query.targets || "").split(",").filter(Boolean);
    if (targets.length === 0) return res.json({ baseCurrency, rates: {} });
    const rateResults = await getMultipleRates(baseCurrency, targets, req.session.orgId!);
    const rates: Record<string, number> = {};
    const warnings: Record<string, string> = {};
    const staleRates: string[] = [];
    for (const [currency, result] of Object.entries(rateResults)) {
      rates[currency] = result.rate;
      if (result.error) warnings[currency] = result.error;
      if (result.stale) staleRates.push(currency);
    }
    return res.json({ baseCurrency, rates, ...(Object.keys(warnings).length > 0 ? { warnings } : {}), ...(staleRates.length > 0 ? { staleRates } : {}) });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

// Implementation status
app.get("/api/implementation-status", requireAuth, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const role = (req.session as any).role as string | undefined;

    if (role === "MANAGER") {
      const clients = await storage.getClientsByOrg(orgId);
      const projects = await storage.getProjectsByOrg(orgId);
      const users = await storage.getTeamMembersByOrg(orgId);
      const team = users.filter((u: any) => u.role === "TEAM_MEMBER");
      const steps = [
        { id: "explore_dashboard", label: "Explore Your Dashboard", complete: true },
        { id: "review_clients", label: "Review Your Clients", complete: clients.length > 0 },
        { id: "review_projects", label: "Review Active Projects", complete: projects.length > 0 },
        { id: "invite_team", label: "Grow Your Team", complete: team.length > 0 },
      ];
      const completedCount = steps.filter(s => s.complete).length;
      return res.json({ steps, completedCount, totalSteps: steps.length, allComplete: completedCount === steps.length, firmProfileComplete: false });
    }

    if (role !== "ADMIN") {
      const entries = await storage.getTimeEntriesByUser(orgId, userId);
      const expensesResult: any = await storage.getExpenses(orgId, { userId });
      const expenses = Array.isArray(expensesResult) ? expensesResult : (expensesResult?.items || expensesResult?.data || []);
      const currentUser = await storage.getUserById(userId);
      const profileComplete = !!((currentUser as any)?.firstName && (currentUser as any)?.lastName);
      const steps = [
        { id: "explore_dashboard", label: "Explore Your Dashboard", complete: true },
        { id: "track_time", label: "Track Your First Hour", complete: (entries?.length || 0) > 0 },
        { id: "expenses", label: "Submit an Expense", complete: (expenses?.length || 0) > 0 },
        { id: "profile", label: "Complete Your Profile", complete: profileComplete },
      ];
      const completedCount = steps.filter(s => s.complete).length;
      return res.json({ steps, completedCount, totalSteps: steps.length, allComplete: completedCount === steps.length, firmProfileComplete: false });
    }

    const org = await storage.getOrg(orgId);
    const services = await storage.getServicesByOrg(orgId);
    const clients = await storage.getClientsByOrg(orgId);
    const users = await storage.getTeamMembersByOrg(orgId);
    const invoices = await storage.getInvoicesByOrg(orgId);
    const team = users.filter((u: any) => u.role === "TEAM_MEMBER");

    const steps = [
      { id: "firm", label: "Firm Profile", complete: !!(org?.addressStreet || org?.addressCity || org?.email || org?.phone) },
      { id: "services", label: "Services", complete: services.length > 0 },
      { id: "clients", label: "First Client", complete: clients.length > 0 },
      { id: "team", label: "Invite Team", complete: team.length > 0 },
      { id: "invoice", label: "First Invoice", complete: invoices.length > 0 },
    ];
    const completedCount = steps.filter(s => s.complete).length;
    const firmStep = steps.find(s => s.id === "firm");
    const firmProfileComplete = firmStep?.complete || false;
    return res.json({ steps, completedCount, totalSteps: steps.length, allComplete: completedCount === steps.length, firmProfileComplete });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/onboarding/status", requireAuth, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const org = await storage.getOrg(orgId);
    const services = await storage.getServicesByOrg(orgId);
    const clients = await storage.getClientsByOrg(orgId);
    const users = await storage.getTeamMembersByOrg(orgId);
    const invoices = await storage.getInvoicesByOrg(orgId);
    const team = users.filter((u: any) => u.role === "TEAM_MEMBER");

    const steps = [
      { id: "firm", complete: !!(org?.addressStreet || org?.addressCity || org?.email || org?.phone) },
      { id: "services", complete: services.length > 0 },
      { id: "clients", complete: clients.length > 0 },
      { id: "team", complete: team.length > 0 },
      { id: "invoice", complete: invoices.length > 0 },
    ];
    const completedSteps = steps.reduce<number[]>((acc, s, i) => { if (s.complete) acc.push(i); return acc; }, []);
    const onboardingComplete = org?.onboardingComplete ?? (steps.every(s => s.complete));
    return res.json({ onboardingComplete, completedSteps, totalSteps: steps.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/onboarding/complete", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    await db.update(orgs).set({ onboardingComplete: true }).where(eq(orgs.id, orgId));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/onboarding/reset", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    await db.update(orgs).set({ onboardingComplete: false }).where(eq(orgs.id, orgId));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/sitemap.xml", (_req, res) => {
  const baseUrl = "https://cherryworkspro.com";
  const pages = [
    { path: "/", priority: "1.0", changefreq: "weekly" },
    { path: "/features", priority: "0.9", changefreq: "weekly" },
    { path: "/pricing", priority: "0.9", changefreq: "weekly" },
    { path: "/compare", priority: "0.9", changefreq: "weekly" },
    { path: "/demo", priority: "0.8", changefreq: "weekly" },
    { path: "/integrations", priority: "0.8", changefreq: "weekly" },
    { path: "/about", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-freshbooks", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-quickbooks", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-xero", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-wave", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-harvest", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-bigtime", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-scoro", priority: "0.8", changefreq: "weekly" },
    { path: "/switch-from-paymo", priority: "0.8", changefreq: "weekly" },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
  <loc>${baseUrl}${p.path}</loc>
  <changefreq>${p.changefreq}</changefreq>
  <priority>${p.priority}</priority>
</url>`).join("\n")}
</urlset>`;
  res.header("Content-Type", "application/xml").send(xml);
});
app.get("/robots.txt", (_req, res) => {
  res.header("Content-Type", "text/plain").send(
    `User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /api/\nDisallow: /auth/\nSitemap: https://cherryworkspro.com/sitemap.xml`
  );
});

// ─── SUPPORT REQUEST ──────────────────────────────────────
app.post("/api/support-request", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const user = await storage.getUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const org = await storage.getOrg(orgId);

    const { subject, message, pageUrl, searchHistory } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = String(Math.floor(1000 + Math.random() * 9000));
    const referenceId = `SR-${datePart}-${rand}`;

    const userName = user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;
    const orgName = org?.name || "";
    const planTier = org?.planTier || "STARTER";
    const priorityPrefix = (planTier === "BUSINESS" || planTier === "ENTERPRISE") ? "[PRIORITY] " : "";

    const { createTransporter, wrapEmailLayout: wrapLayout, emailKeyValue: kv, emailDetailCard: detailCard } = await import("../email");

    let emailSent = false;
    try {
      const transporter = await createTransporter();
      const innerHtml = `
        <h2 style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 8px;">New Support Request</h2>
        <p style="font-size:14px;color:#555770;margin:0 0 24px;">Reference: <strong>${referenceId}</strong></p>
        ${detailCard(
          kv("From", userName) +
          kv("Email", user.email) +
          kv("Organization", orgName) +
          kv("Plan", planTier) +
          kv("Subject", subject) +
          kv("Page", pageUrl || "N/A")
        )}
        <div style="margin:24px 0;">
          <p style="font-size:13px;color:#555770;margin:0 0 8px;font-weight:600;">Message:</p>
          <p style="font-size:14px;color:#1a1a2e;line-height:1.6;white-space:pre-wrap;">${message}</p>
        </div>
        ${searchHistory ? `<div style="margin:24px 0;"><p style="font-size:12px;color:#8b8da3;margin:0 0 4px;">Recent searches:</p><p style="font-size:12px;color:#8b8da3;">${searchHistory}</p></div>` : ""}
      `;
      const html = wrapLayout(innerHtml, { orgName: "CherryWorks Pro Support" });

      await transporter!.sendMail({
        from: '"CherryWorks Pro Support" <noreply@cherryworks.com>',
        to: "info@cherrystconsulting.com",
        replyTo: user.email,
        subject: `${priorityPrefix}[${referenceId}] ${subject}`,
        html,
      });
      emailSent = true;
    } catch (emailErr: any) {
      console.error("[support] Email send failed:", emailErr.message);
    }

    try {
      const { supportRequests } = await import("@shared/schema");
      const { db } = await import("../db");
      await db.insert(supportRequests).values({
        orgId,
        userId,
        referenceId,
        userName,
        userEmail: user.email,
        orgName,
        subject,
        message,
        pageUrl: pageUrl || null,
        searchHistory: searchHistory || null,
        emailSent,
      });
    } catch (dbErr: any) {
      console.error("[support] DB insert failed:", dbErr.message);
    }

    return res.json({ referenceId, emailSent });
  } catch (err: any) {
    console.error("[support] Error:", err.message);
    return res.status(500).json({ message: "Failed to submit support request" });
  }
});

// ─── STRIPE BILLING: CHECKOUT SESSION ──────────────────────
app.post("/api/billing/checkout", requireAuth, async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    const orgId = req.session.orgId!;
    const org = await storage.getOrg(orgId);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const { plan, annual } = req.body;
    const validPlans = ["STARTER", "PROFESSIONAL", "BUSINESS"] as const;
    const planKey = validPlans.includes(plan) ? plan : "PROFESSIONAL";
    const isAnnual = annual === true;

    console.log(`[billing/checkout] plan=${planKey} annual_raw=${JSON.stringify(annual)} isAnnual=${isAnnual}`);

    let priceId: string;
    try {
      const { getPriceId } = await import("../stripe-prices");
      priceId = getPriceId(planKey as "STARTER" | "PROFESSIONAL" | "BUSINESS", isAnnual);
    } catch (priceErr: any) {
      console.error("[billing/checkout] Price ID resolution failed:", priceErr.message);
      return res.status(503).json({ message: "Billing configuration error, please contact support" });
    }

    console.log(`[billing/checkout] resolved priceId=${priceId} for ${planKey}/${isAnnual ? "yearly" : "monthly"}`);

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const user = await storage.getUserById(req.session.userId!);
      const customer = await stripe.customers.create({
        email: user?.email || "",
        name: user?.name || "",
        metadata: { orgId },
      });
      customerId = customer.id;
      await db.update(orgs).set({ stripeCustomerId: customerId }).where(eq(orgs.id, orgId));
    }

    const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      subscription_data: {
        trial_period_days: 14,
        metadata: { orgId, planTier: planKey },
      },
      payment_method_collection: "always",
      success_url: `${baseUrl}/getting-started?welcome=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/signup?checkout=canceled&orgId=${orgId}`,
      metadata: { orgId, planTier: planKey, annual: String(isAnnual) },
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});

// ─── STRIPE BILLING: CUSTOMER PORTAL ──────────────────────
app.post("/api/billing/portal", requireAuth, async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    const orgId = req.session.orgId!;
    const org = await storage.getOrg(orgId);
    if (!org || !org.stripeCustomerId) {
      return res.status(400).json({ message: "No billing account found. Please contact support." });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${baseUrl}/settings`,
    });

    return res.json({ url: session.url });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});

// ─── BILLING STATUS ──────────────────────────────────────
app.get("/api/billing/status", requireAuth, async (req, res) => {
  try {
    const org = await storage.getOrg(req.session.orgId!);
    if (!org) return res.status(404).json({ message: "Org not found" });

    const activeUserCount = await db.select().from(users).where(and(
      eq(users.orgId, org.id),
      eq(users.isActive, true),
    ));

    let hasPaymentMethod = false;
    if (org.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const methods = await stripe.paymentMethods.list({
          customer: org.stripeCustomerId,
          limit: 1,
        });
        hasPaymentMethod = methods.data.length > 0;
      } catch (_e) {}
    }

    return res.json({
      planTier: org.planTier,
      orgName: org.name,
      subscriptionStatus: org.subscriptionStatus,
      maxTeamMembers: org.maxTeamMembers,
      currentTeamMembers: activeUserCount.length,
      trialEndsAt: org.trialEndsAt,
      stripeCustomerId: org.stripeCustomerId ? "configured" : null,
      hasPaymentMethod,
      deletionScheduledFor: (org as any).deletionScheduledFor || null,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/api-access/status", requireAuth, async (req, res) => {
  try {
    const org = await storage.getOrg(req.session.orgId!);
    if (!org) return res.status(404).json({ message: "Org not found" });
    const hasAccess = ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"].includes(org.planTier || "TRIAL");
    return res.json({ hasAccess, planTier: org.planTier });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/org/api-key/regenerate", requireAdmin, async (req, res) => {
  try {
    const newKey = randomBytes(32).toString("hex");
    const keyHash = await hashPassword(newKey);
    await storage.updateOrg(req.session.orgId!, { apiKey: keyHash } as any);
    return res.json({ apiKey: newKey });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/org/api-key", requireAdmin, async (req, res) => {
  try {
    const org = await storage.getOrg(req.session.orgId!);
    if (!org) return res.status(404).json({ message: "Org not found" });
    if (!org.apiKey) {
      const newKey = randomBytes(32).toString("hex");
      const keyHash = await hashPassword(newKey);
      await storage.updateOrg(req.session.orgId!, { apiKey: keyHash } as any);
      return res.json({ apiKey: newKey, isNew: true });
    }
    return res.json({ apiKey: null, hasKey: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/admin/test-email", requireAdmin, async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "Missing 'to' email address" });
    const org = await storage.getOrg(req.session.orgId!);
    const smtpConfig = getSmtpConfigFromOrg(org);
    const orgName = org?.name || "CherryWorks Pro";
    const testBody = wrapEmailLayout(`
      <p style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 4px;">Email is working</p>
      <p style="font-size:14px;color:#8b8da3;margin:0 0 28px;">SMTP configuration confirmed</p>

      <p style="font-size:15px;color:#555770;line-height:1.7;margin:0 0 24px;">
        This is a test email from CherryWorks Pro sent at <strong style="color:#1a1a2e;">${new Date().toISOString()}</strong>.
      </p>

      <p style="font-size:14px;color:#555770;line-height:1.7;margin:0;">
        If you're reading this in your inbox, your SMTP configuration is confirmed and ready to use.
      </p>
    `, { orgName });
    const result = await sendInvoiceEmail(
      to,
      "CherryWorks Pro — Test Email",
      testBody,
      undefined,
      smtpConfig,
      undefined,
      org,
    );
    console.log("[email] Test email sent to:", maskEmail(to), "messageId:", result.messageId);
    await db.update(orgs).set({ lastSuccessfulSmtpSendAt: new Date() }).where(eq(orgs.id, req.session.orgId!));
    return res.json({ success: true, messageId: result.messageId, previewUrl: result.previewUrl });
  } catch (err: any) {
    console.error("[email] Test email FAILED:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Public contact form ──
app.post("/api/public/contact", apiLimiter, async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ message: "Name, email, and message are required" });
    }
    // Send email notification to admin
    try {
      const { createTransporter } = await import("../email");
      const transporter = await createTransporter();
      await transporter!.sendMail({
        from: process.env.SMTP_USER || "noreply@cherryworkspro.com",
        to: "info@cherrystconsulting.com",
        replyTo: email,
        subject: `[CherryWorks Pro] Contact form: ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        html: wrapEmailLayout(`
          <p style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 4px;">Contact Form</p>
          <p style="font-size:14px;color:#8b8da3;margin:0 0 28px;">New message received</p>
          ${emailDetailCard(
            emailKeyValue("Name", escapeHtml(name)) +
            emailKeyValue("Email", `<a href="mailto:${escapeHtml(email)}" style="color:#1a1a2e;text-decoration:underline;">${escapeHtml(email)}</a>`)
          )}
          <div style="font-size:15px;color:#555770;line-height:1.7;white-space:pre-wrap;">${escapeHtml(message).replace(/\n/g, "<br/>")}</div>
        `),
      });
    } catch (emailErr: any) {
      console.error("[contact] Failed to send contact email:", emailErr.message);
      console.log(`[contact] Message from ${name} <${maskEmail(email)}>: ${message.slice(0, 100)}...`);
      return res.json({ ok: true, warning: "Your message was saved but the email notification could not be sent. Our team will still see your message." });
    }
    console.log(`[contact] Message from ${name} <${maskEmail(email)}>: ${message.slice(0, 100)}...`);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/org/settings", requireAdmin, async (req, res) => {
  const org = await storage.getOrg(req.session.orgId!);
  if (!org) return res.status(404).json({ message: "Org not found" });
  const { smtpPass, ...safeOrg } = org;
  res.json(maskSensitiveFields(safeOrg as any));
});
app.patch("/api/org/settings", settingsUpdateLimiter, requireAdmin, async (req, res) => {
  const schema = z.object({
    invoicePrefix: z.string().nullable().optional(),
    estimatePrefix: z.string().nullable().optional(),
    defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
    defaultTaxRate: z.coerce.number().min(0).max(100).optional(),
    baseCurrency: z.string().length(3).optional(),
    address: z.string().nullable().optional(),
    addressStreet: z.string().nullable().optional(),
    addressSuite: z.string().nullable().optional(),
    addressCity: z.string().nullable().optional(),
    addressState: z.string().nullable().optional(),
    addressZip: z.string().nullable().optional(),
    addressCountry: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    invoiceTheme: z.enum(["classic", "modern", "minimal", "bold"]).optional(),
    showTimeEntryDetails: z.boolean().optional(),
    autoPostJournalEntries: z.boolean().optional(),
    reminderEnabled: z.boolean().optional(),
    reminderDaysOverdue: z.string().nullable().optional(),
    reminderSubjectTemplate: z.string().nullable().optional(),
    reminderBodyTemplate: z.string().nullable().optional(),
    defaultBillRate: z.number().int().min(0).max(9999).optional(),
    dataRetentionDays: z.number().int().min(0).max(3650).optional(),
    rateLimitRpm: z.number().int().min(60).max(10000).optional(),
    // Task #271 — per-org marketing send retry policy.
    marketingSendMaxAttempts: z.number().int().min(1).max(20).optional(),
    marketingSendRetryBaseMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1000).optional(),
    // Task #322 — per-org large-audience warning threshold for the
    // marketing campaign editor (recipients above this count trigger a
    // soft "are you sure?" warning).
    marketingLargeAudienceThreshold: z.number().int().min(1).max(10_000_000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  if (parsed.data.reminderDaysOverdue) {
    const raw = parsed.data.reminderDaysOverdue.split(",").map(s => s.trim()).filter(Boolean);
    for (const v of raw) {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 365 || String(n) !== v) {
        return res.status(400).json({ message: `Invalid reminder day "${v}": must be an integer between 1 and 365` });
      }
    }
    const nums = [...new Set(raw.map(v => parseInt(v, 10)))].sort((a, b) => a - b);
    parsed.data.reminderDaysOverdue = nums.join(",");
  }

  if (parsed.data.logoUrl) {
    try {
      const u = new URL(parsed.data.logoUrl);
      if (!["http:", "https:"].includes(u.protocol)) {
        return res.status(400).json({ message: "Logo URL must use http or https protocol" });
      }
    } catch {
      return res.status(400).json({ message: "Logo URL is not a valid URL" });
    }
  }

  const update: any = { ...parsed.data };
  if (update.defaultTaxRate !== undefined) update.defaultTaxRate = String(update.defaultTaxRate);

  const addrFields = ["addressStreet", "addressSuite", "addressCity", "addressState", "addressZip", "addressCountry"] as const;
  const hasStructuredAddr = addrFields.some(f => f in update);
  // When structured address parts are supplied, derive the canonical `address`
  // string from them (overriding any free-form value the client also sent).
  if (hasStructuredAddr && "address" in update) delete update.address;
  if (hasStructuredAddr) {
    const street = update.addressStreet || "";
    const suite = update.addressSuite || "";
    const city = update.addressCity || "";
    const state = update.addressState || "";
    const zip = update.addressZip || "";
    const country = update.addressCountry || "";
    const line1 = [street, suite].filter(Boolean).join(", ");
    const line2 = [city, state, zip].filter(Boolean).join(", ");
    const line3 = country || "";
    const parts = [line1, line2, line3].filter(Boolean);
    update.address = parts.length > 0 ? parts.join("\n") : null;
  }

  await storage.updateOrg(req.session.orgId!, update);

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "ORG_SETTINGS_UPDATED",
    entityType: "orgs",
    entityId: req.session.orgId!,
    details: {},
  });

  const org = await storage.getOrg(req.session.orgId!);
  const { smtpPass, ...safeOrg } = org as any;
  res.json(maskSensitiveFields(safeOrg as any));
});
app.get("/api/org/smtp-settings", requireAdmin, async (req, res) => {
  const org = await storage.getOrg(req.session.orgId!);
  if (!org) return res.status(404).json({ message: "Org not found" });
  res.json({
    smtpHost: org.smtpHost || "",
    smtpPort: org.smtpPort || "",
    smtpUser: org.smtpUser || "",
    smtpPassSet: !!org.smtpPass,
    smtpFromName: org.smtpFromName || "",
    smtpFromEmail: org.smtpFromEmail || "",
    smtpReplyTo: org.smtpReplyTo || "",
    configured: !!(org.smtpHost && org.smtpPort && org.smtpUser && org.smtpPass),
    lastSuccessfulSmtpSendAt: org.lastSuccessfulSmtpSendAt || null,
  });
});
app.put("/api/org/smtp-settings", settingsUpdateLimiter, requireAdmin, async (req, res) => {
  try {
    const schema = z.object({
      smtpHost: z.string().min(1, "SMTP host is required"),
      smtpPort: z.coerce.number().int().min(1).max(65535),
      smtpUser: z.string().min(1, "Username is required"),
      smtpPass: z.string().optional(),
      smtpFromName: z.string().optional(),
      smtpFromEmail: z.string().email().optional().or(z.literal("")),
      smtpReplyTo: z.string().email().optional().or(z.literal("")),
    });
    const parsed = schema.parse(req.body);

    const update: Record<string, any> = {
      smtpHost: parsed.smtpHost,
      smtpPort: parsed.smtpPort,
      smtpUser: parsed.smtpUser,
      smtpFromName: parsed.smtpFromName || null,
      smtpFromEmail: parsed.smtpFromEmail || null,
      smtpReplyTo: parsed.smtpReplyTo || null,
    };

    if (parsed.smtpPass) {
      update.smtpPass = encryptSmtpPassword(parsed.smtpPass);
    }

    await storage.updateOrg(req.session.orgId!, update);

    clearTransporterCache();

    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "SMTP_SETTINGS_UPDATED",
      entityType: "orgs",
      entityId: req.session.orgId!,
      details: { host: parsed.smtpHost, port: parsed.smtpPort },
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.delete("/api/org/smtp-settings", requireAdmin, async (req, res) => {
  await storage.updateOrg(req.session.orgId!, {
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    smtpPass: null,
    smtpFromName: null,
    smtpFromEmail: null,
    smtpReplyTo: null,
  });

  clearTransporterCache();

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "SMTP_SETTINGS_REMOVED",
    entityType: "orgs",
    entityId: req.session.orgId!,
    details: {},
  });

  res.json({ success: true });
});

const EDITABLE_ENTITIES = [
  "clients",
  "projects",
  "project_members",
  "project_services",
  "services",
  "time_entries",
  "invoices",
  "invoice_lines",
  "payments",
  "imported_payouts",
  "team_member_payouts_v2",
  "payout_time_entries",
  "recurring_invoice_templates",
  "estimates",
  "estimate_lines",
  "expense_categories",
  "expenses",
  "expense_reports",
  "timesheet_weeks",
];
const VIEW_ONLY_ENTITIES = [
  "users",
  "orgs",
  "audit_logs",
  "imported_keys",
  "outbox_emails",
  "stripe_events",
  "import_runs",
  "import_files",
  "invoice_revisions",
  "exchange_rates",
];
const ALL_ENTITIES = [...EDITABLE_ENTITIES, ...VIEW_ONLY_ENTITIES];

app.get("/api/admin/data/entities", requireAdmin, (_req: Request, res: Response) => {
  res.json({
    editable: EDITABLE_ENTITIES,
    viewOnly: VIEW_ONLY_ENTITIES,
  });
});
app.get("/api/admin/data/:entity", requireAdmin, async (req: Request, res: Response) => {
  const entity = req.params.entity as string;
  if (!ALL_ENTITIES.includes(entity)) {
    return res.status(400).json({ message: `Unsupported entity: ${entity}` });
  }
  const orgId = req.session.orgId!;
  const query = String(req.query.query || "");
  const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

  const result = await storage.adminListEntity(entity, orgId, query, limit, offset);
  res.json(result);
});
app.get("/api/admin/data/:entity/:id", requireAdmin, async (req: Request, res: Response) => {
  const entity = req.params.entity as string;
  const id = req.params.id as string;
  if (!ALL_ENTITIES.includes(entity)) {
    return res.status(400).json({ message: `Unsupported entity: ${entity}` });
  }
  const orgId = req.session.orgId!;
  const row = await storage.adminGetEntity(entity, id, orgId);
  if (!row) return res.status(404).json({ message: "Not found" });
  res.json(row);
});
app.post("/api/admin/data/:entity", requireAdmin, async (req: Request, res: Response) => {
  const entity = req.params.entity as string;
  if (!EDITABLE_ENTITIES.includes(entity)) {
    return res.status(400).json({ message: `Entity ${entity} is not editable` });
  }
  const orgId = req.session.orgId!;
  try {
    const row = await storage.adminCreateEntity(entity, orgId, req.body);
    res.status(201).json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "Duplicate record", detail: err.detail });
    }
    if (err.code === "23503") {
      return res.status(400).json({ message: "Referenced record not found", detail: err.detail });
    }
    return res.status(400).json({ message: err.message || "Create failed" });
  }
});
app.patch("/api/admin/data/:entity/:id", requireAdmin, async (req: Request, res: Response) => {
  const entity = req.params.entity as string;
  const id = req.params.id as string;
  if (!EDITABLE_ENTITIES.includes(entity)) {
    return res.status(400).json({ message: `Entity ${entity} is not editable` });
  }
  const orgId = req.session.orgId!;
  try {
    const row = await storage.adminUpdateEntity(entity, id, orgId, req.body);
    if (!row) return res.status(404).json({ message: "Not found" });
    res.json(row);
  } catch (err: any) {
    return res.status(400).json({ message: err.message || "Update failed" });
  }
});
app.delete("/api/admin/data/:entity/:id", requireAdmin, async (req: Request, res: Response) => {
  const entity = req.params.entity as string;
  const id = req.params.id as string;
  if (!EDITABLE_ENTITIES.includes(entity)) {
    return res.status(400).json({ message: `Entity ${entity} is not editable` });
  }
  const orgId = req.session.orgId!;
  const result = await storage.adminDeleteEntity(entity, id, orgId);
  if (!result.deleted) {
    if (result.error === "not_found") return res.status(404).json({ message: "Not found" });
    return res.status(400).json({ message: result.error });
  }
  res.json({ deleted: true });
});
app.get("/api/admin/integrity-check", requireAdmin, async (req, res) => {
  const orgId = req.session.orgId!;
  const violations = await storage.integrityCheck(orgId);
  res.json({ violations, count: violations.length });
});
app.get("/api/admin/expense-categories", requireAdmin, async (req, res) => {
  try {
    const result = await storage.getExpenseCategories(req.session.orgId!);
    return res.json(result);
  } catch (err: any) { return res.status(500).json({ message: sanitizeErrorMessage(err) }); }
});

// Logo upload
const logoDir = path.join(process.cwd(), "uploads", "logos");
fs.mkdirSync(logoDir, { recursive: true });

const ALLOWED_LOGO_MIMETYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ALLOWED_LOGO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const DANGEROUS_LOGO_EXTENSIONS = new Set([".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif", ".js", ".vbs", ".svg", ".html", ".htm", ".php"]);

function sanitizeLogoFilename(original: string): string {
  let name = path.basename(original);
  name = name.replace(/[^\w.-]/g, "_");
  name = name.replace(/\.{2,}/g, ".");
  if (name.startsWith(".")) name = "_" + name;
  return name.substring(0, 200);
}

const logoUpload = multer({
  dest: logoDir,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (DANGEROUS_LOGO_EXTENSIONS.has(ext)) {
      return cb(new Error(`File type "${ext}" is not allowed for security reasons`));
    }
    if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
      return cb(new Error(`File extension "${ext}" is not allowed. Accepted: ${[...ALLOWED_LOGO_EXTENSIONS].join(", ")}`));
    }
    if (!ALLOWED_LOGO_MIMETYPES.has(file.mimetype) && file.mimetype !== "application/octet-stream") {
      return cb(new Error(`MIME type "${file.mimetype}" is not allowed for logo uploads`));
    }
    if (file.originalname.includes("..") || file.originalname.includes("/") || file.originalname.includes("\\")) {
      return cb(new Error("Filename contains path traversal characters"));
    }
    cb(null, true);
  },
});

app.post("/api/org/logo", requireAdmin, (req, res, next) => {
  logoUpload.single("logo")(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ message: err.message || "File upload failed" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const file = req.file as Express.Multer.File;
    if (!file) return res.status(400).json({ message: "No file uploaded. Accepted: JPG, PNG, GIF, WebP (max 5MB). SVG files are not accepted for security reasons." });
    const ext = path.extname(sanitizeLogoFilename(file.originalname)).toLowerCase() || ".png";
    if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
      try { fs.unlinkSync(file.path); } catch {}
      return res.status(400).json({ message: `File extension "${ext}" is not allowed` });
    }
    const newName = `${req.session.orgId}${ext}`;
    const destPath = path.join(logoDir, newName);
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    fs.renameSync(file.path, destPath);
    const logoUrl = `/api/uploads/logos/${newName}`;
    try {
      await storage.updateOrg(req.session.orgId!, { logoUrl });
    } catch (dbErr) {
      try { fs.unlinkSync(destPath); } catch {}
      throw dbErr;
    }
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "ORG_LOGO_UPDATED",
      entityType: "org",
      entityId: req.session.orgId!,
      details: {},
    });
    return res.json({ logoUrl });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.delete("/api/org/logo", requireAdmin, async (req, res) => {
  try {
    const org = await storage.getOrg(req.session.orgId!);
    if (org?.logoUrl) {
      const filename = path.basename(org.logoUrl);
      const fp = path.join(logoDir, filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await storage.updateOrg(req.session.orgId!, { logoUrl: null });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/uploads/logos/:filename", (req, res) => {
  const fp = path.join(logoDir, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ message: "Not found" });
  return res.sendFile(fp);
});

app.post("/api/account/delete-request", requireAuth, async (req, res) => {
  try {
    const schema = z.object({ password: z.string().min(1) });
    const { password } = schema.parse(req.body);
    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await comparePasswords(password, (user as any).password);
    if (!valid) return res.status(401).json({ message: "Incorrect password" });

    const orgId = req.session.orgId!;
    const org = await storage.getOrg(orgId);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const admins = await db.select().from(users).where(
      and(eq(users.orgId, orgId), eq(users.role, "ADMIN"), eq(users.isActive, true))
    );

    const isOnlyAdmin = user.role === "ADMIN" && admins.length <= 1;

    if (isOnlyAdmin) {
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + 30);
      await storage.updateOrg(orgId, {
        deletionRequestedAt: new Date(),
        deletionScheduledFor: scheduledDate,
      } as any);

      const formattedDate = scheduledDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      const smtpConfig = getSmtpConfigFromOrg(org);
      if (smtpConfig) {
        const html = buildAccountDeletionScheduledEmailHtml({ orgName: org.name, formattedDate });
        try {
          await sendInvoiceEmail(user.email, `Account Deletion Scheduled — ${org.name}`, html, undefined, smtpConfig, undefined, org);
        } catch (emailErr) {
          console.error("[delete-request] Failed to send confirmation email:", emailErr);
        }
      }

      try {
        await db.execute(sql`INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), ${orgId}, ${user.id}, ${"account.deletion_scheduled"}, ${"org"}, ${orgId}, ${JSON.stringify({ scheduledFor: scheduledDate.toISOString() })})`);
      } catch (auditErr) {
        console.error("[audit-log] Failed to persist account.deletion_scheduled audit row:", auditErr);
      }

      return res.json({ success: true, message: `Your organization and all data will be permanently deleted on ${formattedDate}. You can cancel within that period by logging back in.`, scheduledDeletion: true });
    } else {
      const originalEmail = user.email;

      const smtpConfig = getSmtpConfigFromOrg(org);
      if (smtpConfig) {
        const html = buildAccountDeactivationEmailHtml({ orgName: org.name });
        try {
          await sendInvoiceEmail(originalEmail, `Account Deactivated — ${org.name}`, html, undefined, smtpConfig, undefined, org);
        } catch (emailErr) {
          console.error("[delete-request] Failed to send deactivation email:", emailErr);
        }
      }

      await db.update(users).set({
        isActive: false,
        name: "Deleted User",
        email: `deleted-${user.id}@removed.local`,
        phone: null,
        avatarUrl: null,
      } as any).where(eq(users.id, user.id));

      try {
        await db.execute(sql`INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), ${orgId}, ${user.id}, ${"account.deactivated"}, ${"user"}, ${user.id}, ${JSON.stringify({ reason: "user_requested" })})`);
      } catch (auditErr) {
        console.error("[audit-log] Failed to persist account.deactivated audit row:", auditErr);
      }

      req.session.destroy(() => {});
      return res.json({ success: true, message: "Your account has been deactivated and your personal data removed.", scheduledDeletion: false });
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: "Password is required" });
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/account/cancel-deletion", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    await storage.updateOrg(orgId, {
      deletionRequestedAt: null,
      deletionScheduledFor: null,
    } as any);

    try {
      await db.execute(sql`INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), ${orgId}, ${req.session.userId}, ${"account.deletion_cancelled"}, ${"org"}, ${orgId}, ${JSON.stringify({ cancelledAt: new Date().toISOString() })})`);
    } catch (auditErr) {
      console.error("[audit-log] Failed to persist account.deletion_cancelled audit row:", auditErr);
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
