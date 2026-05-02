import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { projectServices, projectMembers, services, projects, users, createProjectSchema, addProjectMemberSchema } from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, requireAdmin, requireManagerOrAbove, stripCostFieldsForRole } from "./middleware";

export function registerProjectRoutes(app: Express) {
app.get("/api/services", requireAuth, async (req, res) => {
  const result = await storage.getServicesByOrg(req.session.orgId!);
  return res.json(result);
});
app.post("/api/services", requireManagerOrAbove, async (req, res) => {
  try {
    const { name, description, defaultRate, isActive } = req.body;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ message: "Name is required" });
    }
    const service = await storage.createService({
      orgId: req.session.orgId!,
      name,
      description: description || null,
      defaultRate: defaultRate ? String(defaultRate) : null,
      isActive: isActive !== false,
    });
    return res.json(service);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ message: `A service named "${name}" already exists` });
    }
    return res.status(400).json({ message: err.message });
  }
});
app.patch("/api/services/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const serviceId = String(req.params.id);
    const existing = await storage.getServiceById(serviceId, req.session.orgId!);
    if (!existing) {
      return res.status(404).json({ message: "Service not found" });
    }
    const updates: any = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.defaultRate !== undefined) updates.defaultRate = req.body.defaultRate ? String(req.body.defaultRate) : null;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    const updated = await storage.updateService(serviceId, req.session.orgId!, updates);
    return res.json(updated);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ message: `A service with that name already exists` });
    }
    return res.status(400).json({ message: err.message });
  }
});
app.get("/api/projects", requireManagerOrAbove, async (req, res) => {
  const currentUser = await storage.getUserById(req.session.userId!);
  const result = await storage.getProjectsByOrg(req.session.orgId!);
  let scoped = result;
  if (currentUser && currentUser.role !== "ADMIN" && currentUser.role !== "MANAGER") {
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.orgId, req.session.orgId!), eq(projectMembers.userId, req.session.userId!)));
    const allowed = new Set(memberRows.map(r => r.projectId));
    scoped = result.filter((p: any) => allowed.has(p.id));
  }
  return res.json(stripCostFieldsForRole(scoped, currentUser?.role));
});
app.get("/api/projects/:id", requireAuth, async (req, res) => {
  try {
    const currentUser = await storage.getUserById(req.session.userId!);
    if (currentUser && currentUser.role !== "ADMIN" && currentUser.role !== "MANAGER") {
      const membership = await storage.getProjectMembership(req.params.id as string, req.session.userId!);
      if (!membership) return res.status(403).json({ message: "Forbidden" });
    }
    const detail = await storage.getProjectDetail(req.params.id as string, req.session.orgId!);
    if (!detail) return res.status(404).json({ message: "Project not found" });
    return res.json(stripCostFieldsForRole(detail, currentUser?.role));
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/projects", requireManagerOrAbove, async (req, res) => {
  try {
    const org = await storage.getOrg(req.session.orgId!);
    const projectLimits: Record<string, number> = { TRIAL: 999999, STARTER: 3, PROFESSIONAL: 999999, BUSINESS: 999999, ENTERPRISE: 999999 };
    const maxProjects = projectLimits[org?.planTier || "TRIAL"] || 3;
    const existingProjects = await db.select().from(projects).where(eq(projects.orgId, req.session.orgId!));
    if (existingProjects.length >= maxProjects) {
      await storage.createAuditLog({
        orgId: req.session.orgId!,
        userId: req.session.userId!,
        action: "FEATURE_GATE_BLOCKED",
        entityType: "feature_gate",
        entityId: "project_limit",
        details: { feature: "Project Limit", currentCount: existingProjects.length, maxAllowed: maxProjects, currentTier: org?.planTier },
      });
      return res.status(403).json({
        message: `Your ${org?.planTier || "Starter"} plan supports up to ${maxProjects} projects. Upgrade to Professional for unlimited projects.`,
        currentCount: existingProjects.length,
        projectLimit: maxProjects,
        upgradeUrl: "/pricing",
      });
    }

    const parsed = createProjectSchema.parse(req.body);
    const client = await storage.getClientById(parsed.clientId, req.session.orgId!);
    if (!client) {
      return res.status(400).json({ message: "Client not found in your organization" });
    }
    const project = await storage.createProject({
      orgId: req.session.orgId!,
      clientId: parsed.clientId,
      name: parsed.name,
      description: parsed.description || null,
      budgetHours: parsed.budgetHours != null ? String(parsed.budgetHours) : null,
      startDate: parsed.startDate || null,
      endDate: parsed.endDate || null,
    });
    return res.json(project);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.patch("/api/projects/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const { name, description, status, budgetHours, startDate, endDate } = req.body;
    if (status !== undefined) {
      const validStatuses = ["ACTIVE", "COMPLETED", "ON_HOLD", "ARCHIVED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid project status. Must be one of: " + validStatuses.join(", ") });
      }
    }
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (budgetHours !== undefined) updateData.budgetHours = budgetHours != null ? String(budgetHours) : null;
    if (startDate !== undefined) updateData.startDate = startDate || null;
    if (endDate !== undefined) updateData.endDate = endDate || null;
    const project = await storage.updateProject(req.params.id as string, req.session.orgId!, updateData);
    if (!project) return res.status(404).json({ message: "Project not found" });
    return res.json(project);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.delete("/api/projects/:id", requireManagerOrAbove, async (req, res) => {
  const result = await storage.deleteProject(req.params.id as string, req.session.orgId!);
  if (!result.deleted) {
    return res.status(409).json({ message: `Cannot delete project: has linked ${result.conflict}. Remove them first.` });
  }
  return res.json({ success: true });
});
app.get("/api/projects/:id/members", requireManagerOrAbove, async (req, res) => {
  try {
    const project = await storage.getProjectById(req.params.id as string, req.session.orgId!);
    if (!project) return res.status(404).json({ message: "Project not found" });
    const currentUser = await storage.getUserById(req.session.userId!);
    const rows = await db
      .select({
        id: projectMembers.id,
        userId: projectMembers.userId,
        name: users.name,
        email: users.email,
        role: projectMembers.role,
        billRate: projectMembers.hourlyRate,
        costRate: projectMembers.costRateHourly,
        active: users.isActive,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, req.params.id as string), eq(projectMembers.orgId, req.session.orgId!)));
    const sanitized = rows.map(r => stripCostFieldsForRole(r, currentUser?.role));
    return res.json(sanitized);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err.message) });
  }
});
app.delete("/api/projects/:id/members/:memberId", requireManagerOrAbove, async (req, res) => {
  const project = await storage.getProjectById(req.params.id as string, req.session.orgId!);
  if (!project) {
    return res.status(404).json({ message: "Project not found" });
  }
  const removed = await storage.removeProjectMember(req.params.id as string, req.params.memberId as string, req.session.orgId!);
  if (!removed) return res.status(404).json({ message: "Member not found" });
  return res.json({ success: true });
});

app.put("/api/projects/:id/members/by-user/:userId/cost-rate", requireAdmin, async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const userId = req.params.userId as string;
    const orgId = req.session.orgId!;
    const project = await storage.getProjectById(projectId, orgId);
    if (!project) return res.status(404).json({ message: "Project not found" });
    const updateSchema = z.object({
      costRateHourly: z.coerce.number().positive("Cost rate must be greater than 0").max(10000, "Cost rate cannot exceed $10,000/hr"),
    });
    const parsed = updateSchema.parse(req.body);
    const user = await storage.getUserById(userId);
    if (!user || user.orgId !== orgId) {
      return res.status(404).json({ message: "Team member not found in your organization" });
    }
    const existing = await db
      .select()
      .from(projectMembers)
      .where(and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
        eq(projectMembers.orgId, orgId),
      ));
    let saved;
    if (existing.length > 0) {
      const [updated] = await db
        .update(projectMembers)
        .set({ costRateHourly: parsed.costRateHourly.toFixed(2) })
        .where(eq(projectMembers.id, existing[0].id))
        .returning();
      saved = updated;
    } else {
      const fallbackBillRate = Number(user.hourlyPayRate) || 0;
      const [inserted] = await db
        .insert(projectMembers)
        .values({
          orgId,
          projectId,
          userId,
          hourlyRate: fallbackBillRate.toFixed(2),
          costRateHourly: parsed.costRateHourly.toFixed(2),
        })
        .returning();
      saved = inserted;
    }
    return res.json(saved);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.post("/api/projects/:id/duplicate", requireManagerOrAbove, async (req, res) => {
  const result = await storage.duplicateProject(req.params.id as string, req.session.orgId!);
  if (!result) return res.status(404).json({ message: "Project not found" });
  return res.json(result);
});

app.post(
  "/api/projects/:id/members",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const parsed = addProjectMemberSchema.parse(req.body);
      const projectId = req.params.id as string;
      const project = await storage.getProjectById(projectId, req.session.orgId!);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      const user = await storage.getUserById(parsed.userId);
      if (!user || user.orgId !== req.session.orgId!) {
        return res.status(400).json({ message: "User not found in your organization" });
      }
      const costRate = parsed.costRateHourly != null ? parsed.costRateHourly : (Number(user.hourlyPayRate) || 0);
      const member = await storage.addProjectMember({
        orgId: req.session.orgId!,
        projectId,
        userId: parsed.userId,
        hourlyRate: parsed.hourlyRate.toFixed(2),
        costRateHourly: costRate.toFixed(2),
      });
      const currentUser = await storage.getUserById(req.session.userId!);
      return res.json(stripCostFieldsForRole(member, currentUser?.role));
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.get("/api/projects/:id/services", requireManagerOrAbove, async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const project = await storage.getProjectById(projectId, req.session.orgId!);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const rows = await db
      .select({
        id: projectServices.id,
        serviceId: projectServices.serviceId,
        serviceName: services.name,
        serviceDescription: services.description,
        defaultRate: services.defaultRate,
        rateOverride: projectServices.rateOverride,
      })
      .from(projectServices)
      .innerJoin(services, eq(projectServices.serviceId, services.id))
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.orgId, req.session.orgId!)));
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/projects/:id/services", requireManagerOrAbove, async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const project = await storage.getProjectById(projectId, req.session.orgId!);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const { serviceId, rateOverride } = req.body;
    if (!serviceId) return res.status(400).json({ message: "serviceId is required" });
    if (rateOverride !== undefined && rateOverride !== null) {
      const rate = Number(rateOverride);
      if (isNaN(rate) || rate < 0 || rate > 10000) {
        return res.status(400).json({ message: "Rate override must be between 0 and $10,000" });
      }
    }
    const existing = await db
      .select()
      .from(projectServices)
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.serviceId, serviceId), eq(projectServices.orgId, req.session.orgId!)));
    if (existing.length > 0) {
      return res.status(409).json({ message: "Service already assigned to this project" });
    }
    const [row] = await db.insert(projectServices).values({
      orgId: req.session.orgId!,
      projectId,
      serviceId,
      rateOverride: rateOverride ? String(rateOverride) : null,
    }).returning();
    return res.json(row);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.delete("/api/projects/:id/services/:serviceAssignmentId", requireManagerOrAbove, async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const project = await storage.getProjectById(projectId, req.session.orgId!);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    await db.delete(projectServices).where(
      and(eq(projectServices.id, req.params.serviceAssignmentId as string), eq(projectServices.projectId, projectId), eq(projectServices.orgId, req.session.orgId!))
    );
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/projects/:id/available-services", requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const project = await storage.getProjectById(projectId, req.session.orgId!);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }
    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    if (user.role !== "ADMIN") {
      const membership = await db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, req.session.userId!)));
      if (membership.length === 0) {
        return res.status(403).json({ message: "Not a member of this project" });
      }
    }

    const rows = await db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        defaultRate: services.defaultRate,
        rateOverride: projectServices.rateOverride,
        isActive: services.isActive,
      })
      .from(projectServices)
      .innerJoin(services, eq(projectServices.serviceId, services.id))
      .where(and(eq(projectServices.projectId, projectId), eq(projectServices.orgId, req.session.orgId!), eq(services.isActive, true)));

    if (rows.length === 0) {
      const allServices = await storage.getServicesByOrg(req.session.orgId!);
      return res.json(allServices.filter(s => s.isActive));
    }

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
