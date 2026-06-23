import type { Express, Request, Response, RequestHandler } from "express";
import type { Server as HttpServer, IncomingMessage } from "http";
import { ServerResponse } from "http";
import type { Socket } from "net";
import { WebSocketServer, WebSocket } from "ws";
import { requireAuth, requireAdmin } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface Notification {
  id: string; orgId: string; userId: string;
  type: string; title: string; message: string;
  read: boolean; link?: string; metadata?: any;
  createdAt: string; readAt: string | null;
}

const notifications = new Map<string, Notification>();
const VALID_TYPES = ["invoice.paid", "timesheet.submitted", "mention", "system", "payment.failed", "budget.alert"];

const userSockets = new Map<string, Set<WebSocket>>();

type WsEvent =
  | { event: "notification.created"; notification: Notification }
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

  app.get("/api/notifications", requireAuth, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;

    const typeFilter = req.query.type as string | undefined;
    let userNotifs = Array.from(notifications.values()).filter((n) => n.orgId === orgId && n.userId === userId);
    if (typeFilter && VALID_TYPES.includes(typeFilter)) userNotifs = userNotifs.filter((n) => n.type === typeFilter);
    userNotifs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ success: true, count: userNotifs.length, unreadCount: userNotifs.filter((n) => !n.read).length, notifications: userNotifs, supportedTypes: VALID_TYPES });
  });

  app.get("/api/notifications/unread-count", requireAuth, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const unread = Array.from(notifications.values()).filter((n) => n.orgId === orgId && n.userId === userId && !n.read).length;
    res.json({ success: true, unreadCount: unread, hasBadge: unread > 0 });
  });

  app.post("/api/notifications/:notifId/read", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const notif = notifications.get(req.params.notifId as string);
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    if (notif.userId !== userId) return res.status(403).json({ error: "Not your notification" });
    notif.read = true;
    notif.readAt = new Date().toISOString();
    pushToUser(userId, { event: "notification.read", id: notif.id });
    res.json({ success: true, notification: notif });
  });

  app.post("/api/notifications/mark-all-read", requireAuth, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const now = new Date().toISOString();
    let marked = 0;
    for (const n of notifications.values()) {
      if (n.orgId === orgId && n.userId === userId && !n.read) { n.read = true; n.readAt = now; marked++; }
    }
    if (marked > 0) pushToUser(userId, { event: "notifications.allRead" });
    res.json({ success: true, markedRead: marked });
  });

  app.post("/api/notifications/send", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { userId: targetUserId, type, title, message, link } = req.body;

      if (!type || !VALID_TYPES.includes(type))
        return res.status(400).json({ error: "Invalid notification type", validTypes: VALID_TYPES });
      if (!title || !message) return res.status(400).json({ error: "title and message required" });

      const id = randomUUID();
      const notif: Notification = {
        id, orgId, userId: targetUserId || userId, type, title, message,
        read: false, link, createdAt: new Date().toISOString(), readAt: null,
      };
      notifications.set(id, notif);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, 'NOTIFICATION_SENT', 'notification', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ message: `Notification sent: ${type} - ${title}` })]
      );

      pushToUser(notif.userId, { event: "notification.created", notification: notif });

      return res.json({ success: true, notification: notif, wsDelivery: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/notifications/:notifId", requireAuth, (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const notif = notifications.get(req.params.notifId as string);
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    if (notif.userId !== userId) return res.status(403).json({ error: "Not your notification" });
    notifications.delete(req.params.notifId as string);
    pushToUser(userId, { event: "notification.deleted", id: notif.id });
    res.json({ success: true, deleted: true });
  });

  app.get("/api/notifications/ws-info", requireAuth, (req: Request, res: Response) => {
    res.json({ success: true, wsEnabled: true, wsPath: "/ws/notifications", reconnectInterval: 5000, heartbeatInterval: 30000 });
  });
}
