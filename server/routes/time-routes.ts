import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db, pool } from "../db";
import { and, eq } from "drizzle-orm";
import { projects, timesheetWeeks, createTimeEntrySchema, submitTimesheetSchema, rejectTimesheetSchema, unlockTimesheetSchema, round2, getWeekStartDate, getWeekEndDate, computeMinutesFromTimes } from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, requireAdmin, requireManagerOrAbove, stripCostFieldsForRole , requirePlanTier } from "./middleware";
import { fireWebhookEvent } from "../webhooks";
import { resolveRates } from "../services/rate-resolver";
import { sendRejectionEmail, sendTimesheetApprovedEmail, sendTimesheetReopenedEmail, getSmtpConfigFromOrg } from "../email";

export function registerTimeRoutes(app: Express) {
app.get("/api/time-entries", requireAuth, async (req, res) => {
  const user = await storage.getUserById(req.session.userId!);
  if (user?.role === "TEAM_MEMBER") {
    const result = await storage.getTimeEntriesByUser(req.session.orgId!, req.session.userId!);
    const safe = result.map((e: any) => ({
      id: e.id,
      projectId: e.projectId,
      projectName: e.projectName,
      date: e.date,
      minutes: e.minutes,
      billable: e.billable,
      notes: e.notes,
      serviceId: e.serviceId,
      serviceName: e.serviceName,
      userId: e.userId,
      userName: e.userName,
      orgId: e.orgId,
      createdAt: e.createdAt,
    }));
    return res.json(safe);
  }
  const result = await storage.getTimeEntriesByOrg(req.session.orgId!);
  return res.json(stripCostFieldsForRole(result, user?.role));
});

app.get(
  "/api/time-entries/my-projects",
  requireAuth,
  async (req, res) => {
    const result = await storage.getUserProjects(
      req.session.userId!,
      req.session.orgId!,
    );
    const currentUser = await storage.getUserById(req.session.userId!);
    if (currentUser?.role === "TEAM_MEMBER") {
      return res.json(result.map(({ rate, ...rest }: any) => rest));
    }
    return res.json(result);
  },
);

app.post("/api/time-entries", requireAuth, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    if (!currentUser || !currentUser.isActive) {
      return res.status(403).json({ message: "Deactivated users cannot submit time entries" });
    }
    const parsed = createTimeEntrySchema.parse(req.body);

    const entryDate = new Date(parsed.date);
    const now = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    if (entryDate > new Date(now.getTime() + 86400000)) {
      return res.status(400).json({ message: "Cannot submit time for future dates" });
    }
    if (entryDate < oneYearAgo) {
      return res.status(400).json({ message: "Cannot submit time more than 1 year in the past" });
    }

    const project = await storage.getProjectById(parsed.projectId, req.session.orgId!);
    if (!project) {
      return res.status(400).json({ message: "Project not found" });
    }
    if (project.status !== "ACTIVE") {
      return res.status(400).json({ message: "Cannot record time on " + project.status + " project" });
    }
    const membership = await storage.getProjectMembership(
      parsed.projectId,
      req.session.userId!,
    );
    const user = await storage.getUserById(req.session.userId!);
    if (!membership && user?.role !== "ADMIN") {
      return res
        .status(403)
        .json({ message: "Not assigned to this project" });
    }

    if (user && user.role === "TEAM_MEMBER") {
      const weekStart = getWeekStartDate(parsed.date);
      const ts = await storage.getTimesheetWeek(req.session.orgId!, req.session.userId!, weekStart);
      if (ts && ts.status !== "DRAFT") {
        return res.status(403).json({ message: "Timesheet for this week is locked" });
      }
    }

    let finalMinutes = parsed.minutes || 0;
    if (parsed.startTime && parsed.endTime) {
      finalMinutes = computeMinutesFromTimes(parsed.startTime, parsed.endTime);
      if (finalMinutes <= 0 || finalMinutes > 24 * 60) {
        return res.status(400).json({ message: "Invalid time range" });
      }
    }

    const resolved = await resolveRates({
      orgId: req.session.orgId!,
      projectId: parsed.projectId,
      userId: req.session.userId!,
      serviceId: parsed.serviceId ?? null,
      date: new Date(parsed.date),
      billable: parsed.billable ?? true,
    });
    if (resolved.warnings.length > 0) {
      console.warn('[rate-resolver] create time-entry warnings', {
        orgId: req.session.orgId,
        projectId: parsed.projectId,
        userId: req.session.userId,
        serviceId: parsed.serviceId ?? null,
        warnings: resolved.warnings,
      });
    }
    const entry = await storage.createTimeEntry({
      orgId: req.session.orgId!,
      projectId: parsed.projectId,
      userId: req.session.userId!,
      date: parsed.date,
      minutes: finalMinutes,
      startTime: parsed.startTime || null,
      endTime: parsed.endTime || null,
      serviceId: parsed.serviceId || null,
      billable: parsed.billable,
      rate: resolved.billRate.toFixed(2),
      notes: parsed.notes || null,
    }, resolved.costRate.toFixed(2));
    return res.json(entry);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/time-entries/duplicate", requireAuth, async (req, res) => {
  try {
    const { sourceEntryId, targetDate } = req.body;
    if (!sourceEntryId || !targetDate) {
      return res.status(400).json({ message: "sourceEntryId and targetDate required" });
    }
    const source = await storage.getTimeEntryById(sourceEntryId, req.session.orgId!);
    if (!source) {
      return res.status(404).json({ message: "Source entry not found" });
    }
    const dupProject = await storage.getProjectById(source.projectId, req.session.orgId!);
    if (dupProject && dupProject.status !== "ACTIVE") {
      return res.status(400).json({ message: "Cannot record time on " + dupProject.status + " project" });
    }
    const membership = await storage.getProjectMembership(source.projectId, req.session.userId!);
    if (!membership) {
      return res.status(403).json({ message: "Not assigned to this project" });
    }
    const user = await storage.getUserById(req.session.userId!);
    if (user && user.role === "TEAM_MEMBER") {
      const weekStart = getWeekStartDate(targetDate);
      const ts = await storage.getTimesheetWeek(req.session.orgId!, req.session.userId!, weekStart);
      if (ts && ts.status !== "DRAFT") {
        return res.status(403).json({ message: "Timesheet for this week is locked" });
      }
    }
    const dupResolved = await resolveRates({
      orgId: req.session.orgId!,
      projectId: source.projectId,
      userId: req.session.userId!,
      serviceId: source.serviceId ?? null,
      date: new Date(targetDate),
      billable: source.billable ?? true,
    });
    if (dupResolved.warnings.length > 0) {
      console.warn('[rate-resolver] duplicate time-entry warnings', {
        orgId: req.session.orgId,
        projectId: source.projectId,
        userId: req.session.userId,
        serviceId: source.serviceId ?? null,
        warnings: dupResolved.warnings,
      });
    }
    const entry = await storage.createTimeEntry({
      orgId: req.session.orgId!,
      projectId: source.projectId,
      userId: req.session.userId!,
      date: targetDate,
      minutes: source.minutes,
      startTime: source.startTime || null,
      endTime: source.endTime || null,
      serviceId: source.serviceId || null,
      billable: source.billable,
      rate: dupResolved.billRate.toFixed(2),
      notes: source.notes || null,
    }, dupResolved.costRate.toFixed(2));
    return res.json(entry);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.patch("/api/time-entries/:id", requireAuth, async (req, res) => {
  try {
    const entry = await storage.getTimeEntryById(req.params.id as string, req.session.orgId!);
    if (!entry) {
      return res.status(404).json({ message: "Time entry not found" });
    }
    if (entry.userId !== req.session.userId!) {
      const u = await storage.getUserById(req.session.userId!);
      if (!u || u.role !== "ADMIN") {
        return res.status(403).json({ message: "Not authorized" });
      }
    }
    if (entry.invoiced) {
      return res.status(400).json({ message: "Cannot edit invoiced time entry" });
    }
    const u2 = await storage.getUserById(req.session.userId!);
    if (u2 && u2.role === "TEAM_MEMBER") {
      const weekStart = getWeekStartDate(entry.date);
      const ts = await storage.getTimesheetWeek(req.session.orgId!, req.session.userId!, weekStart);
      if (ts && ts.status !== "DRAFT") {
        return res.status(403).json({ message: "Timesheet for this week is locked" });
      }
    }
    const { date, minutes, description, billable, serviceId, notes, startTime, endTime } = req.body;
    let finalMinutes = minutes !== undefined ? Number(minutes) : undefined;
    if (startTime !== undefined && endTime !== undefined && startTime && endTime) {
      finalMinutes = computeMinutesFromTimes(startTime, endTime);
    }
    const effectiveProjectId = entry.projectId;
    const effectiveUserId = entry.userId;
    const effectiveServiceId = serviceId !== undefined ? (serviceId ?? null) : (entry.serviceId ?? null);
    const effectiveDate = date !== undefined ? new Date(String(date)) : new Date(entry.date);
    const effectiveBillable = billable !== undefined ? billable : entry.billable;
    const updateResolved = await resolveRates({
      orgId: req.session.orgId!,
      projectId: effectiveProjectId,
      userId: effectiveUserId,
      serviceId: effectiveServiceId,
      date: effectiveDate,
      billable: effectiveBillable ?? true,
    });
    if (updateResolved.warnings.length > 0) {
      console.warn('[rate-resolver] update time-entry warnings', {
        orgId: req.session.orgId,
        projectId: effectiveProjectId,
        userId: effectiveUserId,
        serviceId: effectiveServiceId,
        warnings: updateResolved.warnings,
      });
    }
    const updated = await storage.updateTimeEntry(entry.id, req.session.orgId!, {
      ...(date !== undefined && { date: String(date) }),
      ...(finalMinutes !== undefined && { minutes: finalMinutes }),
      ...(description !== undefined && { notes: description }),
      ...(notes !== undefined && { notes }),
      ...(billable !== undefined && { billable }),
      ...(serviceId !== undefined && { serviceId }),
      ...(startTime !== undefined && { startTime: startTime || null }),
      ...(endTime !== undefined && { endTime: endTime || null }),
      rate: updateResolved.billRate.toFixed(2),
      costRateSnapshot: updateResolved.costRate.toFixed(2),
    });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.delete("/api/time-entries/:id", requireAuth, async (req, res) => {
  try {
    const entry = await storage.getTimeEntryById(req.params.id as string, req.session.orgId!);
    if (!entry) {
      return res.status(404).json({ message: "Time entry not found" });
    }

    if (entry.userId !== req.session.userId!) {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ message: "Not authorized" });
      }
    }

    if (entry.invoiced) {
      return res.status(400).json({ message: "Cannot delete invoiced time entry" });
    }

    const user = await storage.getUserById(req.session.userId!);
    if (user && user.role === "TEAM_MEMBER") {
      const weekStart = getWeekStartDate(entry.date);
      const ts = await storage.getTimesheetWeek(req.session.orgId!, req.session.userId!, weekStart);
      if (ts && ts.status !== "DRAFT") {
        return res.status(403).json({ message: "Timesheet for this week is locked" });
      }
    }

    await storage.deleteTimeEntry(entry.id, req.session.orgId!);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/time-entries/unbilled-preview", requireAdmin, async (req, res) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).json({ message: "clientId required" });
    const teamMemberIdsParam = req.query.teamMemberIds as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const includeUnapproved = req.query.includeUnapproved === "true";
    const teamMemberIdFilter = teamMemberIdsParam ? teamMemberIdsParam.split(",").filter(Boolean) : null;

    let entries;
    if (includeUnapproved) {
      entries = await storage.getUnbilledTimeEntries(req.session.orgId!, clientId);
    } else {
      const approvedRows = await storage.getUnbilledApprovedTimeForClient(req.session.orgId!, clientId);
      entries = approvedRows.map((row: any) => ({
        id: row.entry.id,
        userId: row.entry.userId,
        date: row.entry.date,
        minutes: row.entry.minutes,
        notes: row.entry.notes,
        rate: row.entry.rate,
        projectName: row.projectName,
        userName: row.userName,
        serviceName: null,
        billRate: row.entry.rate,
      }));
    }

    if (teamMemberIdFilter && teamMemberIdFilter.length > 0) {
      entries = entries.filter((e: any) => teamMemberIdFilter.includes(e.userId));
    }
    if (dateFrom) {
      entries = entries.filter((e: any) => e.date >= dateFrom);
    }
    if (dateTo) {
      entries = entries.filter((e: any) => e.date <= dateTo);
    }

    const byProject: Record<string, { project: string; hours: number; amount: number }> = {};
    const byTeamMemberMap: Record<string, { teamMemberId: string; name: string; hours: number; amount: number }> = {};
    let totalHours = 0;
    let totalAmount = 0;
    const mapped = entries.map((e: any) => {
      const hours = round2(Number(e.minutes) / 60);
      const rate = Number(e.billRate || e.rate || 0);
      const amount = round2(hours * rate);
      totalHours = round2(totalHours + hours);
      totalAmount = round2(totalAmount + amount);
      const pName = e.projectName || "Unknown";
      if (!byProject[pName]) byProject[pName] = { project: pName, hours: 0, amount: 0 };
      byProject[pName].hours = round2(byProject[pName].hours + hours);
      byProject[pName].amount = round2(byProject[pName].amount + amount);

      const userId = e.userId || "";
      const userName = e.userName || "Unknown";
      if (!byTeamMemberMap[userId]) byTeamMemberMap[userId] = { teamMemberId: userId, name: userName, hours: 0, amount: 0 };
      byTeamMemberMap[userId].hours = round2(byTeamMemberMap[userId].hours + hours);
      byTeamMemberMap[userId].amount = round2(byTeamMemberMap[userId].amount + amount);

      return {
        id: e.id,
        project: pName,
        teamMember: userName,
        teamMemberId: userId,
        userId: userId,
        date: e.date,
        hours,
        rate,
        amount,
        service: e.serviceName || null,
      };
    });
    const currentUser = await storage.getUserById(req.session.userId!);
    return res.json(stripCostFieldsForRole({
      entries: mapped,
      totalHours,
      totalAmount,
      byProject: Object.values(byProject),
      byTeamMember: Object.values(byTeamMemberMap),
    }, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/timesheets/my-week", requireAuth, async (req, res) => {
  try {
    const weekStartDate = req.query.weekStartDate as string;
    if (!weekStartDate) {
      return res.status(400).json({ message: "weekStartDate is required" });
    }
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const ts = await storage.getTimesheetWeek(orgId, userId, weekStartDate);
    const weekEnd = getWeekEndDate(weekStartDate);
    const entries = await storage.getTimeEntriesForWeek(orgId, userId, weekStartDate, weekEnd);
    const currentUser = await storage.getUserById(req.session.userId!);
    return res.json(stripCostFieldsForRole({ timesheet: ts || null, entries }, currentUser?.role));
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/timesheets/submit", requireAuth, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Timesheet Approval Workflow"))) return;
    const parsed = submitTimesheetSchema.parse(req.body);
    const orgId = req.session.orgId!;
    const actorUserId = req.session.userId!;

    // Resolve the actual rep whose timesheet is being submitted. If
    // targetUserId is provided AND differs from the caller, this is a
    // manager submitting on behalf of a rep who forgot to. We require
    // the caller to be MANAGER or ADMIN and the target to live in the
    // same org. Otherwise we silently fall back to the caller's own id.
    let userId = actorUserId;
    let onBehalfOf = false;
    if (parsed.targetUserId && parsed.targetUserId !== actorUserId) {
      const actor = await storage.getUserById(actorUserId);
      if (!actor || (actor.role !== "ADMIN" && actor.role !== "MANAGER")) {
        return res.status(403).json({ message: "Only managers and admins can submit a timesheet on behalf of another team member." });
      }
      const target = await storage.getUserById(parsed.targetUserId);
      if (!target || target.orgId !== orgId) {
        return res.status(404).json({ message: "Team member not found." });
      }
      userId = target.id;
      onBehalfOf = true;
    }

    const computed = getWeekStartDate(parsed.weekStartDate);
    if (computed !== parsed.weekStartDate) {
      return res.status(400).json({ message: "weekStartDate must be a Monday" });
    }

    const weekEnd = getWeekEndDate(parsed.weekStartDate);
    const entries = await storage.getTimeEntriesForWeek(orgId, userId, parsed.weekStartDate, weekEnd);

    if (entries.length === 0 && !parsed.confirmEmpty) {
      return res.status(400).json({ message: "No time entries for this week. Set confirmEmpty=true to submit anyway." });
    }

    let ts = await storage.getTimesheetWeek(orgId, userId, parsed.weekStartDate);

    if (ts) {
      if (ts.status !== "DRAFT") {
        return res.status(400).json({ message: `Cannot submit: timesheet is ${ts.status}` });
      }
      await storage.updateTimesheetWeekStatus(ts.id, orgId, "SUBMITTED", {
        submittedAt: new Date(),
        rejectionReason: null,
      });
    } else {
      ts = await storage.createTimesheetWeek({
        orgId,
        userId,
        weekStartDate: parsed.weekStartDate,
        status: "SUBMITTED" as any,
        approvedByUserId: null,
        rejectionReason: null,
      });
      await storage.updateTimesheetWeekStatus(ts.id, orgId, "SUBMITTED", {
        submittedAt: new Date(),
      });
    }

    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    await storage.createAuditLog({
      orgId,
      // userId on the audit row is the ACTOR (who clicked submit). The
      // rep whose timesheet was submitted is in details.targetUserId.
      userId: actorUserId,
      action: onBehalfOf ? "TIMESHEET_SUBMITTED_BY_MANAGER" : "TIMESHEET_SUBMITTED",
      entityType: "timesheet",
      entityId: ts.id,
      details: {
        targetUserId: userId,
        weekStartDate: parsed.weekStartDate,
        entryCount: entries.length,
        totalHours: round2(totalMinutes / 60),
        ...(onBehalfOf ? { onBehalfOf: true, actorUserId } : {}),
      },
    });

    fireWebhookEvent(orgId, "timesheet.submitted", {
      id: ts.id,
      userId,
      weekStartDate: parsed.weekStartDate,
      entryCount: entries.length,
      totalMinutes,
      ...(onBehalfOf ? { submittedBy: actorUserId } : {}),
    });

    const updated = await storage.getTimesheetWeek(orgId, userId, parsed.weekStartDate);
    return res.json(updated);
  } catch (err: any) {
    console.error("[timesheets] submit failed", {
      userId: req.session.userId,
      orgId: req.session.orgId,
      weekStartDate: req.body?.weekStartDate,
      confirmEmpty: req.body?.confirmEmpty,
      targetUserId: req.body?.targetUserId,
      error: err?.message,
      stack: err?.stack,
    });
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/timesheets/:id/recall", requireAuth, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Timesheet Approval Workflow"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const tsId = req.params.id as string;

    const result = await db.transaction(async (tx) => {
      // Lock by (id, orgId, userId) so non-owners can't acquire the row lock
      // and can't use 403-vs-404 to probe for existence of teammates' rows.
      const [locked] = await tx.select().from(timesheetWeeks)
        .where(and(
          eq(timesheetWeeks.id, tsId),
          eq(timesheetWeeks.orgId, orgId),
          eq(timesheetWeeks.userId, userId),
        ))
        .for("update");
      if (!locked) return { error: "Timesheet not found", status: 404 };
      if (locked.status !== "SUBMITTED") return { error: `Cannot recall: timesheet is ${locked.status}. Only submitted timesheets can be recalled.`, status: 400 };

      await tx.update(timesheetWeeks)
        .set({
          status: "DRAFT" as any,
          submittedAt: null,
          rejectionReason: null,
        })
        .where(and(
          eq(timesheetWeeks.id, tsId),
          eq(timesheetWeeks.orgId, orgId),
          eq(timesheetWeeks.userId, userId),
        ));

      return { ts: locked };
    });

    if ("error" in result) return res.status((result as any).status).json({ message: (result as any).error });
    const ts = (result as any).ts;

    await storage.createAuditLog({
      orgId,
      userId,
      action: "TIMESHEET_RECALLED",
      entityType: "timesheet",
      entityId: ts.id,
      details: {
        targetUserId: ts.userId,
        weekStartDate: ts.weekStartDate,
      },
    });

    fireWebhookEvent(orgId, "timesheet.recalled", {
      id: ts.id,
      userId: ts.userId,
      weekStartDate: ts.weekStartDate,
      recalledBy: userId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[timesheets] recall failed", {
      userId: req.session.userId,
      tsId: req.params.id,
      error: err?.message,
    });
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/timesheets/my-recent", requireAuth, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const limit = Math.min(Number(req.query.limit) || 8, 26);
    const rows = await storage.getRecentTimesheetsForUser(orgId, userId, limit);
    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/timesheets/pending", requireManagerOrAbove, async (req, res) => {
  const currentUser = await storage.getUserById(req.session.userId!);
  const result = await storage.getSubmittedTimesheets(req.session.orgId!);
  return res.json(stripCostFieldsForRole(result, currentUser?.role));
});
app.get("/api/timesheets/all", requireManagerOrAbove, async (req, res) => {
  const currentUser = await storage.getUserById(req.session.userId!);
  const result = await storage.getAllTimesheets(req.session.orgId!);
  return res.json(stripCostFieldsForRole(result, currentUser?.role));
});
app.get("/api/timesheets/recent-activity", requireManagerOrAbove, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const rows = await storage.getRecentTimesheetActivity(req.session.orgId!, limit);
    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/timesheets/:id/entries", requireManagerOrAbove, async (req, res) => {
  try {
    const ts = await storage.getTimesheetById(req.params.id as string, req.session.orgId!);
    if (!ts) {
      return res.status(404).json({ message: "Timesheet not found" });
    }
    const weekEnd = getWeekEndDate(ts.weekStartDate);
    const entries = await storage.getTimeEntriesForWeek(ts.orgId, ts.userId, ts.weekStartDate, weekEnd);
    const currentUser = await storage.getUserById(req.session.userId!);
    return res.json(stripCostFieldsForRole(entries, currentUser?.role));
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/timesheets/:id/approve", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Timesheet Approval Workflow"))) return;
    const orgId = req.session.orgId!;
    const tsId = req.params.id as string;

    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(timesheetWeeks)
        .where(and(eq(timesheetWeeks.id, tsId), eq(timesheetWeeks.orgId, orgId)))
        .for("update");
      if (!locked) return { error: "Timesheet not found", status: 404 };
      if (locked.status !== "SUBMITTED") return { error: "Only submitted timesheets can be approved", status: 400 };

      await tx.update(timesheetWeeks)
        .set({
          status: "APPROVED" as any,
          approvedAt: new Date(),
          approvedByUserId: req.session.userId!,
          rejectionReason: null,
        })
        .where(and(eq(timesheetWeeks.id, tsId), eq(timesheetWeeks.orgId, orgId)));

      return { ts: locked };
    });

    if ("error" in result) return res.status((result as any).status).json({ message: (result as any).error });
    const ts = (result as any).ts;

    const weekEnd = getWeekEndDate(ts.weekStartDate);
    const entries = await storage.getTimeEntriesForWeek(ts.orgId, ts.userId, ts.weekStartDate, weekEnd);
    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "TIMESHEET_APPROVED",
      entityType: "timesheet",
      entityId: ts.id,
      details: {
        targetUserId: ts.userId,
        weekStartDate: ts.weekStartDate,
        entryCount: entries.length,
        totalHours: round2(totalMinutes / 60),
      },
    });

    fireWebhookEvent(orgId, "timesheet.approved", { id: ts.id, userId: ts.userId, weekStartDate: ts.weekStartDate, entryCount: entries.length, totalMinutes, approvedBy: req.session.userId });

    const submitter = await storage.getUserById(ts.userId);
    if (submitter?.email) {
      const approver = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(orgId);
      const smtpConfig = getSmtpConfigFromOrg(org);
      sendTimesheetApprovedEmail(
        submitter.email,
        submitter.name,
        ts.weekStartDate,
        approver?.name || "an administrator",
        smtpConfig,
        org,
      ).catch(err => console.error("[email] Failed to send timesheet approval email:", err.message));
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/timesheets/:id/reject", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Timesheet Approval Workflow"))) return;
    const parsed = rejectTimesheetSchema.parse(req.body);
    const ts = await storage.getTimesheetById(req.params.id as string, req.session.orgId!);
    if (!ts) {
      return res.status(404).json({ message: "Timesheet not found" });
    }
    if (ts.status !== "SUBMITTED") {
      return res.status(400).json({ message: "Only submitted timesheets can be rejected" });
    }

    await storage.updateTimesheetWeekStatus(ts.id, req.session.orgId!, "REJECTED", {
      rejectionReason: parsed.reason,
    });

    const weekEnd = getWeekEndDate(ts.weekStartDate);
    const entries = await storage.getTimeEntriesForWeek(ts.orgId, ts.userId, ts.weekStartDate, weekEnd);
    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);

    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "TIMESHEET_REJECTED",
      entityType: "timesheet",
      entityId: ts.id,
      details: {
        targetUserId: ts.userId,
        weekStartDate: ts.weekStartDate,
        entryCount: entries.length,
        totalHours: round2(totalMinutes / 60),
        reason: parsed.reason,
      },
    });

    const submitter = await storage.getUserById(ts.userId);
    if (submitter?.email) {
      const reviewer = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(req.session.orgId!);
      const smtpConfig = getSmtpConfigFromOrg(org);
      sendRejectionEmail(
        submitter.email, submitter.name, "timesheet",
        `Week of ${ts.weekStartDate}`, parsed.reason,
        reviewer?.name || "an administrator", smtpConfig, org,
      ).catch(err => console.error("[email] Failed to send timesheet rejection email:", err.message));
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/timesheets/:id/unlock", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Timesheet Approval Workflow"))) return;
    const parsed = unlockTimesheetSchema.parse(req.body);
    const orgId = req.session.orgId!;
    const tsId = req.params.id as string;

    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(timesheetWeeks)
        .where(and(eq(timesheetWeeks.id, tsId), eq(timesheetWeeks.orgId, orgId)))
        .for("update");
      if (!locked) return { error: "Timesheet not found", status: 404 };

      await tx.update(timesheetWeeks)
        .set({
          status: "DRAFT" as any,
          rejectionReason: null,
        })
        .where(and(eq(timesheetWeeks.id, tsId), eq(timesheetWeeks.orgId, orgId)));

      return { ts: locked };
    });

    if ("error" in result) return res.status((result as any).status).json({ message: (result as any).error });
    const ts = (result as any).ts;

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "TIMESHEET_REOPENED",
      entityType: "timesheet",
      entityId: ts.id,
      details: {
        targetUserId: ts.userId,
        weekStartDate: ts.weekStartDate,
        reason: parsed.reason,
      },
    });

    if (ts.status === "APPROVED" || ts.status === "SUBMITTED") {
      const submitter = await storage.getUserById(ts.userId);
      if (submitter?.email) {
        const reopener = await storage.getUserById(req.session.userId!);
        const org = await storage.getOrg(orgId);
        const smtpConfig = getSmtpConfigFromOrg(org);
        sendTimesheetReopenedEmail(
          submitter.email,
          submitter.name,
          ts.weekStartDate,
          reopener?.name || "an administrator",
          parsed.reason,
          smtpConfig,
          org,
        ).catch(err => console.error("[email] Failed to send timesheet re-open email:", err.message));
      }
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/timesheets/bulk-approve", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Timesheet Approval Workflow"))) return;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array required" });
    }
    if (ids.length > 500) {
      return res.status(400).json({ message: "Maximum 500 items per bulk operation" });
    }
    const orgId = req.session.orgId!;
    const approvedTimesheets: { id: string; userId: string; weekStartDate: string }[] = [];
    const results = await db.transaction(async (tx) => {
      const txResults: { id: string; status: string }[] = [];
      for (const id of ids) {
        const ts = await storage.getTimesheetById(id, orgId);
        if (!ts) {
          txResults.push({ id, status: "not_found" });
          continue;
        }
        if (ts.status !== "SUBMITTED") {
          txResults.push({ id, status: "skipped_not_pending" });
          continue;
        }
        await tx.update(timesheetWeeks)
          .set({ status: "APPROVED", approvedByUserId: req.session.userId!, approvedAt: new Date() })
          .where(and(eq(timesheetWeeks.id, ts.id), eq(timesheetWeeks.orgId, orgId)));
        await storage.createAuditLog({
          orgId,
          userId: req.session.userId!,
          action: "TIMESHEET_APPROVED",
          entityType: "timesheet",
          entityId: ts.id,
          details: { targetUserId: ts.userId, weekStartDate: ts.weekStartDate },
        }, tx);
        approvedTimesheets.push({ id: ts.id, userId: ts.userId, weekStartDate: ts.weekStartDate });
        txResults.push({ id, status: "approved" });
      }
      return txResults;
    });

    if (approvedTimesheets.length > 0) {
      const approver = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(orgId);
      const smtpConfig = getSmtpConfigFromOrg(org);
      for (const ts of approvedTimesheets) {
        const submitter = await storage.getUserById(ts.userId);
        if (submitter?.email) {
          sendTimesheetApprovedEmail(
            submitter.email,
            submitter.name,
            ts.weekStartDate,
            approver?.name || "an administrator",
            smtpConfig,
            org,
          ).catch(err => console.error("[email] Failed to send timesheet approval email:", err.message));
        }
      }
    }

    return res.json({ results });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/timesheets/bulk-reject", requireAdmin, async (req, res) => {
  try {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Timesheet Approval Workflow"))) return;
    const { ids, reason } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array required" });
    }
    if (ids.length > 500) {
      return res.status(400).json({ message: "Maximum 500 items per bulk operation" });
    }
    if (!reason || typeof reason !== "string") {
      return res.status(400).json({ message: "reason required" });
    }
    const orgId = req.session.orgId!;
    const rejectedTimesheets: { id: string; userId: string; weekStartDate: string }[] = [];
    const results = await db.transaction(async (tx) => {
      const txResults: { id: string; status: string }[] = [];
      for (const id of ids) {
        const ts = await storage.getTimesheetById(id, orgId);
        if (!ts) {
          txResults.push({ id, status: "not_found" });
          continue;
        }
        if (ts.status !== "SUBMITTED") {
          txResults.push({ id, status: "skipped_not_pending" });
          continue;
        }
        await tx.update(timesheetWeeks)
          .set({ status: "REJECTED", rejectionReason: reason })
          .where(and(eq(timesheetWeeks.id, ts.id), eq(timesheetWeeks.orgId, orgId)));
        await storage.createAuditLog({
          orgId,
          userId: req.session.userId!,
          action: "TIMESHEET_REJECTED",
          entityType: "timesheet",
          entityId: ts.id,
          details: { targetUserId: ts.userId, weekStartDate: ts.weekStartDate, reason },
        }, tx);
        rejectedTimesheets.push({ id: ts.id, userId: ts.userId, weekStartDate: ts.weekStartDate });
        txResults.push({ id, status: "rejected" });
      }
      return txResults;
    });

    if (rejectedTimesheets.length > 0) {
      const reviewer = await storage.getUserById(req.session.userId!);
      const org = await storage.getOrg(orgId);
      const smtpConfig = getSmtpConfigFromOrg(org);
      for (const ts of rejectedTimesheets) {
        const submitter = await storage.getUserById(ts.userId);
        if (submitter?.email) {
          sendRejectionEmail(
            submitter.email, submitter.name, "timesheet",
            `Week of ${ts.weekStartDate}`, reason,
            reviewer?.name || "an administrator", smtpConfig, org,
          ).catch(err => console.error("[email] Failed to send timesheet rejection email:", err.message));
        }
      }
    }

    return res.json({ results });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
}
