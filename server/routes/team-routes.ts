import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { paramId } from "../lib/req-params";
import { db } from "../db";
import { eq, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { timeEntries, orgs, users, projects, round2 } from "@shared/schema";
import { sanitizeErrorMessage, requireAdmin, requireManagerOrAbove, resetPasswordLimiter, userCreationLimiter, payrollWebhookLimiter, maskSensitiveFields, maskSensitiveArray, requirePlanTier } from "./middleware";
import { hashPassword, comparePasswords } from "../auth";
import { sendInviteEmail, getSmtpConfigFromOrg } from "../email";
import { maskEmail } from "../utils/mask-email";

async function authenticatePayrollWebhook(req: Request): Promise<any | null> {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) return null;

  const prefixMatch = apiKey.match(/^pk_([^_]+)_(.+)$/);
  let matchedOrg: any = null;

  if (prefixMatch) {
    const [, orgIdPrefix, _secret] = prefixMatch;
    const candidateOrgs = await db.select().from(orgs).where(eq(orgs.id, orgIdPrefix));
    if (candidateOrgs[0]?.apiKey && await comparePasswords(apiKey, candidateOrgs[0].apiKey)) {
      matchedOrg = candidateOrgs[0];
    }
  }

  if (!matchedOrg) {
    const allOrgs = await db.select().from(orgs);
    for (const o of allOrgs) {
      if (o.apiKey && await comparePasswords(apiKey, o.apiKey)) {
        matchedOrg = o;
        break;
      }
    }
  }

  if (!matchedOrg) return null;

  const signature = req.headers["x-payroll-signature"] as string;
  const timestamp = req.headers["x-payroll-timestamp"] as string;

  if (signature && timestamp) {
    const skewMs = Math.abs(Date.now() - Number(timestamp));
    if (skewMs > 5 * 60 * 1000) return null;

    const payload = `${timestamp}.${JSON.stringify(req.body)}`;
    const expected = createHmac("sha256", apiKey).update(payload).digest("hex");
    try {
      if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return null;
    } catch {
      return null;
    }
  }

  return matchedOrg;
}

export function registerTeamRoutes(app: Express) {
app.get("/api/team", requireManagerOrAbove, async (req, res) => {
  try {
    const members = await storage.getTeamMembers(req.session.orgId!);
    const safeMembers = (members as any[]).map((m: any) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      workerType: m.workerType,
      isActive: m.isActive,
      hourlyRate: m.hourlyPayRate || null,
      projectCount: m.projectCount,
      totalHoursThisMonth: m.totalHoursThisMonth,
      projects: m.projects,
      title: m.title,
      department: m.department,
      avatarUrl: m.avatarUrl,
      stripeConnectStatus: m.stripeConnectStatus,
      tempPassword: m.tempPassword,
      createdAt: m.createdAt,
      lastLoginAt: m.lastLoginAt,
    }));
    return res.json(safeMembers);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/team/smtp-status", requireAdmin, async (req, res) => {
  try {
    const org = await storage.getOrg(req.session.orgId!);
    const smtpConfig = getSmtpConfigFromOrg(org);
    const configured = !!(smtpConfig || process.env.SMTP_HOST);
    return res.json({ configured });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/team/invite", userCreationLimiter, requireAdmin, async (req, res) => {
  try {
    const { name, firstName, lastName, email, role, projectAssignments, workerType, title, department, payType, hourlyPayRate, salaryAmount, payrollProviderName, payrollProviderId, phone } = req.body;
    const resolvedFirstName = firstName || (name ? name.split(/\s+/)[0] : "");
    const resolvedLastName = lastName || (name && name.includes(" ") ? name.split(/\s+/).slice(1).join(" ") : "");
    const resolvedName = [resolvedFirstName, resolvedLastName].filter(Boolean).join(" ") || name || "";
    if (!resolvedFirstName || !email) return res.status(400).json({ message: "First name and email are required" });

    const org = await storage.getOrg(req.session.orgId!);
    if (org) {
      const activeUsers = await db.select().from(users).where(and(
        eq(users.orgId, org.id),
        eq(users.isActive, true),
      ));
      const currentCount = activeUsers.length;
      const maxAllowed = org.maxTeamMembers || 999999;
      if (currentCount >= maxAllowed) {
        await storage.createAuditLog({
          orgId: req.session.orgId!,
          userId: req.session.userId!,
          action: "FEATURE_GATE_BLOCKED",
          entityType: "feature_gate",
          entityId: "team_member_limit",
          details: { feature: "Team Member Limit", currentCount, maxAllowed, currentTier: org.planTier },
        });
        const tierLabel = org.planTier === "STARTER" || org.planTier === "TRIAL" ? "Professional" : "Business";
        return res.status(403).json({
          message: `You've reached your team member limit (${maxAllowed}). Upgrade to ${tierLabel} for more team members.`,
          currentCount,
          maxAllowed,
          currentTier: org.planTier,
        });
      }
    }

    if (projectAssignments && Array.isArray(projectAssignments) && projectAssignments.length > 50) {
      return res.status(400).json({ message: "Maximum 50 project assignments per invite" });
    }
    const existing = await storage.getUserByEmailInOrg(email, req.session.orgId!);
    if (existing) return res.status(409).json({ message: "A user with this email already exists" });
    const tempPwd = randomBytes(6).toString("base64url").slice(0, 12);
    const hashed = await hashPassword(tempPwd);
    const validWorkerTypes = ["INDEPENDENT", "W2_EMPLOYEE", "CORP_TO_CORP"];
    const resolvedWorkerType = validWorkerTypes.includes(workerType) ? workerType : "INDEPENDENT";
    const extraFields: Record<string, unknown> = {};
    extraFields.firstName = resolvedFirstName;
    extraFields.lastName = resolvedLastName;
    if (title) extraFields.title = title;
    if (department) extraFields.department = department;
    if (phone) extraFields.phone = phone;
    if (payType === "HOURLY" || payType === "SALARY") extraFields.payType = payType;
    if (hourlyPayRate) extraFields.hourlyPayRate = hourlyPayRate;
    if (salaryAmount) extraFields.salaryAmount = salaryAmount;
    if (payrollProviderName) extraFields.payrollProviderName = payrollProviderName;
    if (payrollProviderId) extraFields.payrollProviderId = payrollProviderId;
    const user = await storage.createUser({
      orgId: req.session.orgId!,
      email,
      name: resolvedName,
      password: hashed,
      role: ["ADMIN", "MANAGER", "TEAM_MEMBER"].includes(role) ? role : "TEAM_MEMBER",
      isActive: true,
      onboardingComplete: false,
      tempPassword: true,
      workerType: resolvedWorkerType,
      ...extraFields,
    } as any);
    if (projectAssignments && Array.isArray(projectAssignments)) {
      for (const pa of projectAssignments) {
        if (pa.projectId && pa.hourlyRate) {
          await storage.addProjectMember({
            orgId: req.session.orgId!,
            projectId: pa.projectId,
            userId: user.id,
            hourlyRate: pa.hourlyRate,
            costRateHourly: "0",
            role: "member",
          });
        }
      }
    }
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "USER_INVITED",
      entityType: "user",
      entityId: user.id,
      details: { name, email, role: user.role },
    });

    let emailSent = false;
    let emailError: string | null = null;
    let previewUrl: string | undefined;
    const org2 = await storage.getOrg(req.session.orgId!);
    const orgName = org2?.name || "CherryWorks Pro";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "localhost:5000";
    const loginUrl = `${protocol}://${host}`;
    const smtpConfig = getSmtpConfigFromOrg(org2);
    const smtpConfigured = !!(smtpConfig || process.env.SMTP_HOST);

    const inviteToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const pendingInvite = await storage.createPendingInvite({
      orgId: req.session.orgId!,
      email,
      firstName: resolvedFirstName,
      lastName: resolvedLastName || null,
      role: (["ADMIN", "MANAGER", "TEAM_MEMBER"].includes(role) ? role : "TEAM_MEMBER") as any,
      invitedByUserId: req.session.userId!,
      inviteToken,
      expiresAt,
      status: "PENDING",
    });

    try {
      const result = await sendInviteEmail(email, resolvedName, orgName, tempPwd, loginUrl, smtpConfig, org2);
      emailSent = true;
      previewUrl = result.previewUrl;
    } catch (emailErr: any) {
      emailError = emailErr.message || "Failed to send email";
      console.error("[invite] Failed to send invite email:", emailErr.message);
    }

    const inviteUrl = `${loginUrl}/login?email=${encodeURIComponent(email)}&tempPassword=${encodeURIComponent(tempPwd)}`;
    const { password: _, ...safeUser } = user;
    return res.json({ user: safeUser, inviteId: pendingInvite.id, inviteUrl, emailSent, emailError, previewUrl, smtpConfigured });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/team/:id/resend-invite", requireAdmin, async (req, res) => {
  try {
    const targetUser = await storage.getUserById(paramId(req));
    if (!targetUser || targetUser.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.lastLoginAt) {
      return res.status(400).json({ message: "This user has already logged in — not a pending invite" });
    }
    const tempPwd = randomBytes(6).toString("base64url").slice(0, 12);
    const hashed = await hashPassword(tempPwd);
    await storage.updateUser(targetUser.id, targetUser.orgId, { password: hashed, tempPassword: true } as any);

    const org = await storage.getOrg(req.session.orgId!);
    const orgName = org?.name || "CherryWorks Pro";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "localhost:5000";
    const loginUrl = `${protocol}://${host}`;
    const smtpConfig = getSmtpConfigFromOrg(org);

    let emailSent = false;
    try {
      await sendInviteEmail(targetUser.email, targetUser.name, orgName, tempPwd, loginUrl, smtpConfig, org);
      emailSent = true;
    } catch (emailErr: any) {
      console.error("[resend-invite] Failed to send invite email:", emailErr.message);
    }

    const inviteUrl = `${loginUrl}/login?email=${encodeURIComponent(targetUser.email)}&tempPassword=${encodeURIComponent(tempPwd)}`;
    return res.json({ emailSent, inviteUrl });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.delete("/api/team/:id/revoke-invite", requireAdmin, async (req, res) => {
  try {
    const targetUser = await storage.getUserById(paramId(req));
    if (!targetUser || targetUser.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.lastLoginAt) {
      return res.status(400).json({ message: "This user has already logged in — use deactivate instead" });
    }
    if (targetUser.id === req.session.userId) {
      return res.status(400).json({ message: "Cannot revoke your own invite" });
    }
    await storage.updateUser(targetUser.id, targetUser.orgId, {
      isActive: false,
      tempPassword: false,
    } as any);
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "INVITE_REVOKED",
      entityType: "user",
      entityId: targetUser.id,
      details: { email: targetUser.email, name: targetUser.name },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/team/invites", requireManagerOrAbove, async (req, res) => {
  try {
    const invites = await storage.getPendingInvitesByOrg(req.session.orgId!);
    return res.json(invites);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/team/invites/:id/resend", requireAdmin, async (req, res) => {
  try {
    const invite = await storage.getPendingInviteById(paramId(req), req.session.orgId!);
    if (!invite) {
      return res.status(404).json({ message: "Invite not found" });
    }
    if (invite.status !== "PENDING") {
      return res.status(400).json({ message: `Cannot resend — invite is ${invite.status}` });
    }
    if (invite.expiresAt <= new Date()) {
      await storage.updatePendingInvite(invite.id, invite.orgId, { status: "EXPIRED" });
      return res.status(400).json({ message: "Invite has expired" });
    }

    const org = await storage.getOrg(req.session.orgId!);
    const orgName = org?.name || "CherryWorks Pro";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "localhost:5000";
    const loginUrl = `${protocol}://${host}`;
    const smtpConfig = getSmtpConfigFromOrg(org);

    const targetUser = await storage.getUserByEmailInOrg(invite.email, invite.orgId);
    const tempPwd = randomBytes(6).toString("base64url").slice(0, 12);
    if (targetUser) {
      const hashed = await hashPassword(tempPwd);
      await storage.updateUser(targetUser.id, targetUser.orgId, { password: hashed, tempPassword: true } as any);
    }

    let emailSent = false;
    let emailError: string | null = null;
    try {
      const resolvedName = [invite.firstName, invite.lastName].filter(Boolean).join(" ");
      await sendInviteEmail(invite.email, resolvedName, orgName, tempPwd, loginUrl, smtpConfig, org);
      emailSent = true;
    } catch (emailErr: any) {
      emailError = emailErr.message || "Failed to send email";
      console.error("[resend-invite] Failed to send invite email:", emailErr.message);
    }

    const updated = await storage.updatePendingInvite(invite.id, invite.orgId, {
      lastResentAt: new Date(),
      resendCount: invite.resendCount + 1,
    });

    const inviteUrl = `${loginUrl}/login?email=${encodeURIComponent(invite.email)}&tempPassword=${encodeURIComponent(tempPwd)}`;
    return res.json({ inviteId: updated!.id, inviteUrl, emailSent, emailError });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/team/invites/:id/revoke", requireAdmin, async (req, res) => {
  try {
    const invite = await storage.getPendingInviteById(paramId(req), req.session.orgId!);
    if (!invite) {
      return res.status(404).json({ message: "Invite not found" });
    }
    if (invite.status !== "PENDING") {
      return res.status(400).json({ message: `Cannot revoke — invite is ${invite.status}` });
    }
    await storage.updatePendingInvite(invite.id, invite.orgId, { status: "REVOKED" });
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "INVITE_REVOKED",
      entityType: "pending_invite",
      entityId: invite.id,
      details: { email: invite.email, firstName: invite.firstName, lastName: invite.lastName },
    });
    return res.status(204).send();
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.patch("/api/team/:id", requireAdmin, async (req, res) => {
  try {
    const targetUser = await storage.getUserById(paramId(req));
    if (!targetUser || targetUser.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    const { name, firstName, lastName, email, role, phone, isActive, workerType,
      title, department, startDate, endDate, emergencyContactName, emergencyContactPhone,
      payrollProviderId, payrollProviderName, hourlyPayRate, salaryAmount, payType, notes } = req.body;
    const updates: Record<string, unknown> = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (firstName !== undefined || lastName !== undefined) {
      const fn = firstName !== undefined ? firstName : undefined;
      const ln = lastName !== undefined ? lastName : undefined;
      if (fn || ln) updates.name = [fn, ln].filter(Boolean).join(" ");
    }
    if (name !== undefined && firstName === undefined && lastName === undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) {
      const validRoles = ["ADMIN", "MANAGER", "TEAM_MEMBER"];
      if (!validRoles.includes(role)) return res.status(400).json({ message: "Invalid role" });
      updates.role = role;
    }
    if (phone !== undefined) updates.phone = phone;
    if (isActive !== undefined) updates.isActive = isActive;
    if (title !== undefined) updates.title = title;
    if (department !== undefined) updates.department = department;
    if (startDate !== undefined) updates.startDate = startDate;
    if (endDate !== undefined) updates.endDate = endDate;
    if (emergencyContactName !== undefined) updates.emergencyContactName = emergencyContactName;
    if (emergencyContactPhone !== undefined) updates.emergencyContactPhone = emergencyContactPhone;
    if (payrollProviderId !== undefined) updates.payrollProviderId = payrollProviderId;
    if (payrollProviderName !== undefined) updates.payrollProviderName = payrollProviderName;
    if (hourlyPayRate !== undefined) updates.hourlyPayRate = hourlyPayRate;
    if (salaryAmount !== undefined) updates.salaryAmount = salaryAmount;
    if (payType !== undefined) updates.payType = payType;
    if (notes !== undefined) updates.notes = notes;
    if (workerType !== undefined) {
      const validWorkerTypes = ["INDEPENDENT", "W2_EMPLOYEE", "CORP_TO_CORP"];
      if (validWorkerTypes.includes(workerType)) {
        updates.workerType = workerType;
        updates.is1099Eligible = workerType === "INDEPENDENT" || workerType === "CORP_TO_CORP";
      }
    }
    const updated = await storage.updateUser(paramId(req), req.session.orgId!, updates as any);
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safeUser } = updated;
    return res.json(maskSensitiveFields(safeUser as any));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/team/:id/deactivate", requireAdmin, async (req, res) => {
  try {
    const targetUser = await storage.getUserById(paramId(req));
    if (!targetUser || targetUser.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    const updated = await storage.updateUser(paramId(req), req.session.orgId!, { isActive: false });
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safeUser } = updated;
    return res.json(safeUser);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/team/:id/reset-password", resetPasswordLimiter, requireAdmin, async (req, res) => {
  try {
    const targetUser = await storage.getUserById(paramId(req));
    if (!targetUser || targetUser.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    const tempPwd = randomBytes(6).toString("base64url").slice(0, 12);
    const hashed = await hashPassword(tempPwd);
    const updated = await storage.updateUser(paramId(req), req.session.orgId!, { password: hashed, tempPassword: true });
    if (!updated) return res.status(404).json({ message: "User not found" });

    console.log(`[reset-password] Temp password generated for user ${updated.id} (${maskEmail(updated.email)})`);

    let emailSent = false;
    try {
      const org = await storage.getOrg(req.session.orgId!);
      const orgName = org?.name || "CherryWorks Pro";
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "localhost:5000";
      const loginUrl = `${protocol}://${host}`;
      const smtpConfig = getSmtpConfigFromOrg(org);
      await sendInviteEmail(updated.email, updated.name, orgName, tempPwd, loginUrl, smtpConfig, org);
      emailSent = true;
    } catch (emailErr: any) {
      console.error("[reset-password] Failed to send email:", emailErr.message);
    }

    return res.json({ emailSent });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/team/:id/payroll-config", requireManagerOrAbove, async (req, res) => {
  try {
    const user = await storage.getUserById(paramId(req));
    if (!user || user.orgId !== req.session.orgId) return res.status(404).json({ message: "User not found" });
    return res.json({
      payrollProviderName: user.payrollProviderName,
      payrollProviderId: user.payrollProviderId,
      payType: user.payType,
      hourlyPayRate: user.hourlyPayRate,
      salaryAmount: user.salaryAmount,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/webhooks/payroll/sync-hours", payrollWebhookLimiter, async (req, res) => {
  try {
    const matchedOrg = await authenticatePayrollWebhook(req);
    if (!matchedOrg) return res.status(401).json({ message: "Invalid API key or signature" });
    const { externalEmployeeId, periodStart, periodEnd } = req.body;
    if (!externalEmployeeId || !periodStart || !periodEnd) return res.status(400).json({ message: "externalEmployeeId, periodStart, and periodEnd are required" });
    const allUsers = await db.select().from(users).where(and(eq(users.orgId, matchedOrg.id), eq(users.payrollProviderId, externalEmployeeId)));
    const employee = allUsers[0];
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const entries = await db.select({
      id: timeEntries.id,
      date: timeEntries.date,
      minutes: timeEntries.minutes,
      billable: timeEntries.billable,
      notes: timeEntries.notes,
      projectId: timeEntries.projectId,
    }).from(timeEntries).where(and(
      eq(timeEntries.userId, employee.id),
      gte(timeEntries.date, periodStart),
      lte(timeEntries.date, periodEnd),
    ));
    const projectIds = [...new Set(entries.map(e => e.projectId))];
    const projectMap: Record<string, string> = {};
    for (const pid of projectIds) {
      const proj = await db.select({ name: projects.name }).from(projects).where(and(eq(projects.id, pid), eq(projects.orgId, matchedOrg.id)));
      if (proj[0]) projectMap[pid] = proj[0].name;
    }
    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    const billableMinutes = entries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0);
    return res.json({
      employeeId: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      totalHours: round2(totalMinutes / 60),
      billableHours: round2(billableMinutes / 60),
      entries: entries.map(e => ({
        date: e.date,
        hours: round2(e.minutes / 60),
        project: projectMap[e.projectId] || e.projectId,
        description: e.notes || "",
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/webhooks/payroll/employee-update", payrollWebhookLimiter, async (req, res) => {
  try {
    const matchedOrg = await authenticatePayrollWebhook(req);
    if (!matchedOrg) return res.status(401).json({ message: "Invalid API key or signature" });
    const { externalEmployeeId, firstName, lastName, email, payType, payRate } = req.body;
    if (!externalEmployeeId) return res.status(400).json({ message: "externalEmployeeId is required" });
    const allUsers = await db.select().from(users).where(and(eq(users.orgId, matchedOrg.id), eq(users.payrollProviderId, externalEmployeeId)));
    const employee = allUsers[0];
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const updates: Record<string, unknown> = {};
    if (firstName) { updates.firstName = firstName; }
    if (lastName) { updates.lastName = lastName; }
    if (firstName || lastName) { updates.name = [firstName || employee.firstName, lastName || employee.lastName].filter(Boolean).join(" "); }
    if (payType === "HOURLY" || payType === "SALARY") updates.payType = payType;
    if (payRate) { if (payType === "SALARY") updates.salaryAmount = payRate; else updates.hourlyPayRate = payRate; }
    await storage.updateUser(employee.id, matchedOrg.id, updates as any);
    return res.json({ success: true, employeeId: employee.id });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/users/team-members", requireManagerOrAbove, async (req, res) => {
  const result = await storage.getTeamMembersByOrg(req.session.orgId!);
  return res.json(
    result.map(({ password: _, ...u }) => u),
  );
});

const update1099Schema = z.object({
  legalName: z.string().optional(),
  mailingAddress: z.string().optional(),
  taxIdLast4: z.string().max(4).optional(),
  is1099Eligible: z.boolean().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
});

app.patch("/api/users/:id/profile", requireAdmin, async (req, res) => {
  try {
    const user = await storage.getUserById(paramId(req));
    if (!user || user.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    const parsed = update1099Schema.parse(req.body);
    const { phone, name, ...profileFields } = parsed;
    if (phone !== undefined || name !== undefined) {
      await storage.updateUser(user.id, req.session.orgId!, { ...(phone !== undefined ? { phone } : {}), ...(name !== undefined ? { name } : {}) });
    }
    await storage.updateUserProfile(user.id, req.session.orgId!, profileFields);
    const updated = await storage.getUserById(user.id);
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { password: _, ...safe } = updated;
    return res.json(safe);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});

// ── Stripe Connect ────────────────────────────────────────────
app.post("/api/team/:userId/connect-onboarding", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Stripe Connect Payouts"))) return;
    const { createConnectAccount, createAccountLink } = await import("../stripe-connect");
    const userId = paramId(req, "userId");
    const user = await storage.getUserById(userId);
    if (!user || user.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    const wt = user.workerType || "INDEPENDENT";
    if (wt === "W2_EMPLOYEE") {
      return res.status(400).json({ message: "Stripe Connect is only available for independent and Corp-to-Corp workers" });
    }

    let accountId = user.stripeConnectAccountId;
    if (!accountId) {
      try {
        const result = await createConnectAccount(user.email, user.name);
        accountId = result.accountId;
      } catch (connectErr: any) {
        const msg = connectErr?.message || "";
        if (msg.includes("Connect") || msg.includes("connect") || connectErr?.type === "StripeInvalidRequestError") {
          return res.status(400).json({
            message: "Stripe Connect is not enabled on your Stripe account. Please enable Connect in your Stripe Dashboard at https://dashboard.stripe.com/connect/overview before onboarding team members.",
          });
        }
        throw connectErr;
      }
      await storage.updateUser(userId, req.session.orgId!, {
        stripeConnectAccountId: accountId,
        stripeConnectStatus: "ONBOARDING_STARTED",
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const link = await createAccountLink(
      accountId,
      `${baseUrl}/team?connect_refresh=${userId}`,
      `${baseUrl}/team?connect_return=${userId}`,
    );

    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "STRIPE_CONNECT_ONBOARDING_INITIATED",
      entityType: "user",
      entityId: userId,
      details: { teamMemberName: user.name },
    });

    return res.json({ url: link.url, accountId });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/team/:userId/connect-status", requireManagerOrAbove, async (req, res) => {
  try {
    const user = await storage.getUserById(paramId(req, "userId"));
    if (!user || user.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!user.stripeConnectAccountId) {
      return res.json({ status: user.stripeConnectStatus || "NOT_STARTED", chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    }
    const { getAccountStatus } = await import("../stripe-connect");
    const acctStatus = await getAccountStatus(user.stripeConnectAccountId);

    let newStatus = user.stripeConnectStatus;
    if (acctStatus.chargesEnabled && acctStatus.payoutsEnabled) {
      newStatus = "ACTIVE";
    } else if (acctStatus.detailsSubmitted) {
      newStatus = "ONBOARDING_COMPLETE";
    }
    if (newStatus !== user.stripeConnectStatus) {
      await storage.updateUser(paramId(req, "userId"), req.session.orgId!, { stripeConnectStatus: newStatus });
    }

    return res.json({ status: newStatus, ...acctStatus });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
