import type { Express } from "express";
import { db } from "../db";
import { eq, and, isNull, lte, or, gte, sql } from "drizzle-orm";
import { projects, services, users, projectMembers, projectServiceMembers } from "@shared/schema";
import { requireAuth, requireManagerOrAbove } from "./middleware";
import { paramId } from "../lib/req-params";

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export function registerRateMatrixRoutes(app: Express) {
  app.get("/api/admin/rate-matrix/:projectId", requireAuth, requireManagerOrAbove, async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const projectId = paramId(req, "projectId");

      const [project] = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const orgServices = await db
        .select({ id: services.id, name: services.name, defaultRate: services.defaultRate })
        .from(services)
        .where(and(eq(services.orgId, orgId), eq(services.isActive, true)));

      const members = await db
        .select({
          userId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(and(eq(projectMembers.orgId, orgId), eq(projectMembers.projectId, projectId)));

      const today = todayStr();
      const cells = await db
        .select({
          userId: projectServiceMembers.userId,
          serviceId: projectServiceMembers.serviceId,
          billRate: projectServiceMembers.billRate,
          costRate: projectServiceMembers.costRate,
        })
        .from(projectServiceMembers)
        .where(
          and(
            eq(projectServiceMembers.orgId, orgId),
            eq(projectServiceMembers.projectId, projectId),
            or(
              isNull(projectServiceMembers.effectiveDate),
              lte(projectServiceMembers.effectiveDate, today),
            ),
            or(
              isNull(projectServiceMembers.endDate),
              gte(projectServiceMembers.endDate, today),
            ),
          ),
        );

      return res.json({ project, services: orgServices, members, cells });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/rate-matrix/:projectId/cell", requireAuth, requireManagerOrAbove, async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const projectId = paramId(req, "projectId");
      const { userId, serviceId, billRate, costRate } = req.body;

      if (!userId || !serviceId) {
        return res.status(400).json({ message: "userId and serviceId are required" });
      }
      if (billRate !== null && billRate !== undefined && (typeof billRate !== "number" || billRate < 0)) {
        return res.status(400).json({ message: "billRate must be null or a non-negative number" });
      }
      if (costRate !== null && costRate !== undefined && (typeof costRate !== "number" || costRate < 0)) {
        return res.status(400).json({ message: "costRate must be null or a non-negative number" });
      }

      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const today = todayStr();
      const yesterday = yesterdayStr();

      const priorRows = await db
        .select({ id: projectServiceMembers.id })
        .from(projectServiceMembers)
        .where(
          and(
            eq(projectServiceMembers.orgId, orgId),
            eq(projectServiceMembers.projectId, projectId),
            eq(projectServiceMembers.serviceId, serviceId),
            eq(projectServiceMembers.userId, userId),
            isNull(projectServiceMembers.endDate),
          ),
        );

      const [existingToday] = await db
        .select({ id: projectServiceMembers.id })
        .from(projectServiceMembers)
        .where(
          and(
            eq(projectServiceMembers.orgId, orgId),
            eq(projectServiceMembers.projectId, projectId),
            eq(projectServiceMembers.serviceId, serviceId),
            eq(projectServiceMembers.userId, userId),
            eq(projectServiceMembers.effectiveDate, today),
          ),
        );

      const billRateVal = billRate != null ? billRate.toFixed(2) : null;
      const costRateVal = costRate != null ? costRate.toFixed(2) : null;

      if (existingToday) {
        await db
          .update(projectServiceMembers)
          .set({
            billRate: billRateVal,
            costRate: costRateVal,
            updatedAt: new Date(),
          })
          .where(eq(projectServiceMembers.id, existingToday.id));

        return res.json({
          success: true,
          cell: { userId, serviceId, billRate: billRateVal, costRate: costRateVal, effectiveDate: today },
        });
      }

      for (const row of priorRows) {
        await db
          .update(projectServiceMembers)
          .set({ endDate: yesterday, updatedAt: new Date() })
          .where(eq(projectServiceMembers.id, row.id));
      }

      await db.insert(projectServiceMembers).values({
        orgId,
        projectId,
        serviceId,
        userId,
        billRate: billRateVal,
        costRate: costRateVal,
        effectiveDate: today,
        endDate: null,
      });

      return res.json({
        success: true,
        cell: { userId, serviceId, billRate: billRateVal, costRate: costRateVal, effectiveDate: today },
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/rate-matrix/:projectId/cell", requireAuth, requireManagerOrAbove, async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const projectId = paramId(req, "projectId");
      const { userId, serviceId } = req.body;

      if (!userId || !serviceId) {
        return res.status(400).json({ message: "userId and serviceId are required" });
      }

      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const yesterday = yesterdayStr();

      await db
        .update(projectServiceMembers)
        .set({ endDate: yesterday, updatedAt: new Date() })
        .where(
          and(
            eq(projectServiceMembers.orgId, orgId),
            eq(projectServiceMembers.projectId, projectId),
            eq(projectServiceMembers.serviceId, serviceId),
            eq(projectServiceMembers.userId, userId),
            isNull(projectServiceMembers.endDate),
          ),
        );

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });
}
