import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./middleware";
import { captureError, addBreadcrumb, getErrorEvents, getErrorEvent, getStats, clearOldEvents, RELEASE, ENVIRONMENT } from "../error-tracking";

export function registerErrorTrackingRoutes(app: Express) {

  app.use("/api/", (req: Request, res: Response, next) => {
    const requestId = (req as any).requestId || "unknown";
    addBreadcrumb(requestId, {
      category: "http",
      message: `${req.method} ${req.path}`,
      level: "info",
      data: { query: req.query, userAgent: req.headers["user-agent"]?.substring(0, 100) },
    });

    if (req.session?.userId) {
      addBreadcrumb(requestId, {
        category: "user",
        message: "authenticated_request",
        level: "info",
        data: { role: req.session.role },
      });
    }

    const originalEnd = res.end;
    res.end = function (...args: any[]) {
      if (res.statusCode >= 500) {
        captureError(`Server error on ${req.method} ${req.path}`, {
          requestId,
          userId: req.session?.userId,
          orgId: req.session?.orgId,
          url: req.path,
          method: req.method,
          level: "error",
          extra: { statusCode: res.statusCode },
        });
      }
      return originalEnd.apply(res, args as any);
    } as any;

    next();
  });

  app.post("/api/error-tracking/capture", requireAuth, (req: Request, res: Response) => {
    const { message, stack, level, tags, extra } = req.body;
    if (!message) return res.status(400).json({ message: "message required" });

    const eventId = captureError(stack ? Object.assign(new Error(message), { stack }) : message, {
      requestId: (req as any).requestId,
      userId: req.session.userId,
      orgId: req.session.orgId,
      url: req.body.url || req.path,
      method: "CLIENT",
      level: level || "error",
      tags,
      extra,
    });

    return res.json({ eventId });
  });

  app.get("/api/admin/errors", requireAdmin, (req: Request, res: Response) => {
    const { level, limit, offset, environment } = req.query;
    const result = getErrorEvents({
      level: level as string,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      environment: environment as string,
    });
    return res.json(result);
  });

  app.get("/api/admin/errors/stats", requireAdmin, (_req: Request, res: Response) => {
    return res.json(getStats());
  });

  app.get("/api/admin/errors/:id", requireAdmin, (req: Request, res: Response) => {
    const event = getErrorEvent(req.params.id as string);
    if (!event) return res.status(404).json({ message: "Error event not found" });
    return res.json(event);
  });

  app.post("/api/admin/errors/cleanup", requireAdmin, (req: Request, res: Response) => {
    const olderThanDays = Number(req.body.olderThanDays) || 7;
    const removed = clearOldEvents(olderThanDays * 24 * 60 * 60 * 1000);
    return res.json({ removed });
  });

  app.get("/api/admin/errors/release-info", requireAdmin, (_req: Request, res: Response) => {
    return res.json({
      release: RELEASE,
      environment: ENVIRONMENT,
      sourceMapsUploaded: true,
    });
  });
}
