import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

declare module "express-session" {
  interface SessionData {
    impersonating?: {
      realUserId: string;
      realRole: string;
      targetUserId: string;
      targetRole: string;
      startedAt: number;
    };
  }
}

function isImpersonationExpired(startedAt: number): boolean {
  return Date.now() - startedAt > IMPERSONATION_TTL_MS;
}

export function registerImpersonationRoutes(app: Express) {

  app.use("/api/", (req: Request, _res: Response, next) => {
    if (req.session?.impersonating) {
      if (isImpersonationExpired(req.session.impersonating.startedAt)) {
        const real = req.session.impersonating;
        req.session.userId = real.realUserId;
        req.session.role = real.realRole;
        delete req.session.impersonating;
      }
    }
    next();
  });

  app.post("/api/admin/impersonate/:userId", requireAdmin, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "User Impersonation"))) return;
    const targetUserId = req.params.userId as string;
    const realUserId = req.session.userId!;
    const realRole = req.session.role!;

    if (req.session.impersonating) {
      return res.status(400).json({ message: "Already impersonating a user. End current session first." });
    }

    const target = await db.select().from(users).where(
      and(eq(users.id, targetUserId), eq(users.orgId, req.session.orgId!))
    ).then(r => r[0]);

    if (!target) return res.status(404).json({ message: "User not found in your organization" });

    if (target.role === "ADMIN") {
      return res.status(403).json({ message: "Cannot impersonate other administrators" });
    }

    req.session.impersonating = {
      realUserId,
      realRole,
      targetUserId: target.id,
      targetRole: target.role,
      startedAt: Date.now(),
    };
    req.session.userId = target.id;
    req.session.role = target.role;

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), req.session.orgId, realUserId, "IMPERSONATION_START", "user", target.id,
          JSON.stringify({ realUserId, realRole, targetUserId: target.id, targetEmail: target.email, targetRole: target.role }),
          (req as any).ip || "unknown"]
      );
    } catch {}

    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS).toISOString();

    return res.json({
      success: true,
      impersonating: {
        userId: target.id,
        email: target.email,
        name: target.name,
        role: target.role,
        expiresAt,
      },
      banner: `You are viewing as ${target.name} (${target.email}). Impersonation expires at ${expiresAt}.`,
    });
  });

  app.post("/api/impersonate/end", requireAuth, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "User Impersonation"))) return;
    if (!req.session.impersonating) {
      return res.status(400).json({ message: "Not currently impersonating anyone" });
    }

    const imp = req.session.impersonating;
    req.session.userId = imp.realUserId;
    req.session.role = imp.realRole;

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), req.session.orgId, imp.realUserId, "IMPERSONATION_END", "user", imp.targetUserId,
          JSON.stringify({ realUserId: imp.realUserId, targetUserId: imp.targetUserId, durationMs: Date.now() - imp.startedAt }),
          (req as any).ip || "unknown"]
      );
    } catch {}

    delete req.session.impersonating;

    return res.json({ success: true, message: "Impersonation ended. You are back to your admin account." });
  });

  app.get("/api/impersonation/status", requireAuth, (req: Request, res: Response) => {
    if (!req.session.impersonating) {
      return res.json({ active: false });
    }

    const imp = req.session.impersonating;
    const expired = isImpersonationExpired(imp.startedAt);
    if (expired) {
      req.session.userId = imp.realUserId;
      req.session.role = imp.realRole;
      delete req.session.impersonating;
      return res.json({ active: false, expired: true });
    }

    const remainingMs = IMPERSONATION_TTL_MS - (Date.now() - imp.startedAt);
    return res.json({
      active: true,
      realUserId: imp.realUserId,
      targetUserId: imp.targetUserId,
      targetRole: imp.targetRole,
      remainingMs,
      expiresAt: new Date(imp.startedAt + IMPERSONATION_TTL_MS).toISOString(),
      banner: `Impersonation active. Expires in ${Math.ceil(remainingMs / 60000)} minutes.`,
    });
  });

  app.get("/api/admin/impersonation/log", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT * FROM audit_logs WHERE action IN ('IMPERSONATION_START', 'IMPERSONATION_END') AND org_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.session.orgId]
      );
      return res.json({ logs: result.rows });
    } catch (e: any) {
      return res.status(500).json({ message: "Failed to fetch impersonation logs" });
    }
  });
}
