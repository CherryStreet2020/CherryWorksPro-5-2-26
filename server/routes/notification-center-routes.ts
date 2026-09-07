/**
 * Notification center — persisted in `user_notifications` (it used to live in
 * a process-local Map, which lost everything on restart and could not be
 * shared across replicas). The HTTP API is unchanged; WebSocket pushes are
 * best-effort and only reach sockets on this instance.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import type { Server as HttpServer, IncomingMessage } from "http";
import { ServerResponse } from "http";
import type { Socket } from "net";
import { WebSocketServer, WebSocket } from "ws";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./middleware";
import { db, pool } from "../db";
import { userNotifications } from "@shared/schema";

export interface NotificationView {
  id: string; orgId: string; userId: string;
  type: string; title: string; message: string;
  read: boolean; link?: string | null; metadata?: any;
  createdAt: string; readAt: string | null;
}

export const VALID_TYPES = [
  "invoice.paid", "timesheet.submitted", "mention", "system", "payment.failed", "budget.alert",
  "case.new", "case.assigned", "case.customer_message", "case.status", "case.sla",
];

const userSockets = new Map<string, Set<WebSocket>>();

type WsEvent =
  | { event: "notification.created"; notification: NotificationView }
  | { event: "notification.read"; id: string }
  | { event: "notification.deleted"; id: string }
  | { event: "notifications.allRead" };

function pushToUser(userId: string, payload: WsEvent) {
  const set = userSockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch { /* ignore */ }
    }
  }
}

function toView(row: typeof userNotifications.$inferSelect): NotificationView {
  return {
    id: row.id, orgId: row.orgId, userId: row.userId, type: row.type, title: row.title, message: row.message,
    read: !!row.readAt, link: row.link, metadata: row.metadata,
    createdAt: row.createdAt.toISOString(), readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

/** Persist a notification for one user and push it to their open sockets. */
export async function createNotification(input: {
  orgId: string; userId: string; type: string; title: string; message: string; link?: string | null; metadata?: Record<string, unknown> | null;
}): Promise<NotificationView> {
  const [row] = await db.insert(userNotifications).values({
    orgId: input.orgId, userId: input.userId, type: input.type, title: input.title, message: input.message,
    link: input.link ?? null, metadata: input.metadata ?? null,
  }).returning();
  const view = toView(row);
  pushToUser(input.userId, { event: "notification.created", notification: view });
  return view;
}

function setupNotificationsWebSocket(httpServer: HttpServer, sessionMiddleware: RequestHandler) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url || "";
    if (!url.startsWith("/ws/notifications")) return;

    const res = new ServerResponse(req);
    sessionMiddleware(req as any, res as any, () => {
      const session = (req as any).session;
      const userId = session?.userId as string | undefined;
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, userId);
      });
    });
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, userId: string) => {
    let set = userSockets.get(userId);
    if (!set) { set = new Set(); userSockets.set(userId, set); }
    set.add(ws);

    try { ws.send(JSON.stringify({ event: "connected" })); } catch { /* ignore */ }

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch { /* ignore */ }
      }
    }, 30000);

    ws.on("close", () => {
      clearInterval(heartbeat);
      const s = userSockets.get(userId);
      if (s) {
        s.delete(ws);
        if (s.size === 0) userSockets.delete(userId);
      }
    });

    ws.on("error", () => { /* swallow per-socket errors */ });
  });
}

export function registerNotificationCenterRoutes(
  app: Express,
  httpServer?: HttpServer,
  sessionMiddleware?: RequestHandler,
) {
  if (httpServer && sessionMiddleware) {
    setupNotificationsWebSocket(httpServer, sessionMiddleware);
  }

  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const typeFilter = req.query.type as string | undefined;
    const where = [eq(userNotifications.orgId, orgId), eq(userNotifications.userId, userId)];
    if (typeFilter && VALID_TYPES.includes(typeFilter)) where.push(eq(userNotifications.type, typeFilter));
    const [rows, [totals]] = await Promise.all([
      db.select().from(userNotifications).where(and(...where)).orderBy(desc(userNotifications.createdAt)).limit(200),
      db.select({ count: sql<number>`count(*)`, unread: sql<number>`count(*) filter (where ${userNotifications.readAt} is null)` }).from(userNotifications).where(and(...where)),
    ]);
    const list = rows.map(toView);
    res.json({ success: true, count: Number(totals?.count ?? list.length), unreadCount: Number(totals?.unread ?? 0), notifications: list, supportedTypes: VALID_TYPES });
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(userNotifications)
      .where(and(eq(userNotifications.orgId, req.session.orgId!), eq(userNotifications.userId, req.session.userId!), isNull(userNotifications.readAt)));
    const unread = Number(row?.n ?? 0);
    res.json({ success: true, unreadCount: unread, hasBadge: unread > 0 });
  });

  app.post("/api/notifications/:notifId/read", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const id = req.params.notifId as string;
    const [existing] = await db.select().from(userNotifications).where(eq(userNotifications.id, id));
    if (!existing) return res.status(404).json({ error: "Notification not found" });
    if (existing.userId !== userId) return res.status(403).json({ error: "Not your notification" });
    const [row] = await db.update(userNotifications).set({ readAt: existing.readAt ?? new Date() }).where(eq(userNotifications.id, id)).returning();
    pushToUser(userId, { event: "notification.read", id });
    res.json({ success: true, notification: toView(row) });
  });

  app.post("/api/notifications/mark-all-read", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const rows = await db.update(userNotifications).set({ readAt: new Date() })
      .where(and(eq(userNotifications.orgId, req.session.orgId!), eq(userNotifications.userId, userId), isNull(userNotifications.readAt)))
      .returning({ id: userNotifications.id });
    if (rows.length > 0) pushToUser(userId, { event: "notifications.allRead" });
    res.json({ success: true, markedRead: rows.length });
  });

  app.post("/api/notifications/send", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { userId: targetUserId, type, title, message, link } = req.body;

      if (!type || !VALID_TYPES.includes(type))
        return res.status(400).json({ error: "Invalid notification type", validTypes: VALID_TYPES });
      if (!title || !message) return res.status(400).json({ error: "title and message required" });

      const notif = await createNotification({ orgId, userId: targetUserId || userId, type, title, message, link });

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, 'NOTIFICATION_SENT', 'notification', $3, $4)`,
        [orgId, userId, notif.id, JSON.stringify({ message: `Notification sent: ${type} - ${title}` })]
      );

      return res.json({ success: true, notification: notif, wsDelivery: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/notifications/:notifId", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const id = req.params.notifId as string;
    const [existing] = await db.select().from(userNotifications).where(eq(userNotifications.id, id));
    if (!existing) return res.status(404).json({ error: "Notification not found" });
    if (existing.userId !== userId) return res.status(403).json({ error: "Not your notification" });
    await db.delete(userNotifications).where(eq(userNotifications.id, id));
    pushToUser(userId, { event: "notification.deleted", id });
    res.json({ success: true, deleted: true });
  });

  app.get("/api/notifications/ws-info", requireAuth, (req: Request, res: Response) => {
    res.json({ success: true, wsEnabled: true, wsPath: "/ws/notifications", reconnectInterval: 5000, heartbeatInterval: 30000 });
  });
}
