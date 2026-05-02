import type { Express } from "express";
import { db } from "../db";
import { eq, and, ne, desc } from "drizzle-orm";
import { activeSessions } from "@shared/schema";
import { requireAuth } from "./middleware";
import { createHash } from "crypto";
import { pool } from "../db";

export function hashSessionId(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

export function parseDeviceLabel(ua: string | undefined): string {
  if (!ua) return "Unknown Device";

  let browser = "Unknown Browser";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
  else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
  else if (ua.includes("Safari/") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Firefox/")) browser = "Firefox";

  let os = "Unknown OS";
  if (ua.includes("iPhone")) os = "iPhone";
  else if (ua.includes("iPad")) os = "iPad";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) os = "macOS";
  else if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("CrOS")) os = "ChromeOS";

  return `${browser} on ${os}`;
}

export function getClientIp(req: any): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = (typeof forwarded === "string" ? forwarded : forwarded[0]).split(",")[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || null;
}

export async function trackSession(req: any): Promise<void> {
  if (!req.session?.userId || !req.session?.orgId || !req.sessionID) return;
  const hashedSid = hashSessionId(req.sessionID);
  const ua = req.headers["user-agent"] as string | undefined;
  const deviceLabel = parseDeviceLabel(ua);
  const ip = getClientIp(req);

  try {
    const existing = await db.select({ id: activeSessions.id })
      .from(activeSessions)
      .where(eq(activeSessions.sessionId, hashedSid))
      .limit(1);

    if (existing.length > 0) {
      await db.update(activeSessions)
        .set({ lastActiveAt: new Date(), ipAddress: ip, userAgent: ua || null, deviceLabel })
        .where(eq(activeSessions.sessionId, hashedSid));
    } else {
      await db.insert(activeSessions).values({
        orgId: req.session.orgId,
        userId: req.session.userId,
        sessionId: hashedSid,
        ipAddress: ip,
        userAgent: ua || null,
        deviceLabel,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      });
    }
  } catch (err) {
    console.error("[sessions] Failed to track session:", err);
  }
}

export async function updateSessionActivity(hashedSid: string): Promise<void> {
  try {
    await db.update(activeSessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(activeSessions.sessionId, hashedSid));
  } catch {}
}

export async function removeSessionByHash(hashedSid: string): Promise<void> {
  try {
    await db.delete(activeSessions).where(eq(activeSessions.sessionId, hashedSid));
  } catch {}
}

async function destroyExpressSessionByHash(hashedSid: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT sid FROM session`);
    for (const row of result.rows) {
      if (hashSessionId(row.sid) === hashedSid) {
        const del = await client.query(`DELETE FROM session WHERE sid = $1`, [row.sid]);
        return (del.rowCount ?? 0) > 0;
      }
    }
    return true;
  } catch (err) {
    console.error("[sessions] Failed to destroy express session:", err);
    return false;
  } finally {
    client.release();
  }
}

export function registerSessionRoutes(app: Express) {

  app.get("/api/sessions", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const currentHash = hashSessionId(req.sessionID);

      const sessions = await db.select()
        .from(activeSessions)
        .where(eq(activeSessions.userId, userId))
        .orderBy(desc(activeSessions.lastActiveAt));

      const result = sessions.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel || "Unknown Device",
        ipAddress: s.ipAddress,
        city: s.city,
        lastActiveAt: s.lastActiveAt,
        createdAt: s.createdAt,
        isCurrent: s.sessionId === currentHash,
      }));

      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/sessions/:id", requireAuth, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id as string);
      if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

      const userId = req.session.userId!;
      const currentHash = hashSessionId(req.sessionID);

      const [target] = await db.select()
        .from(activeSessions)
        .where(and(eq(activeSessions.id, sessionId), eq(activeSessions.userId, userId)));

      if (!target) return res.status(404).json({ message: "Session not found" });
      if (target.sessionId === currentHash) {
        return res.status(400).json({ message: "Use logout to end your current session" });
      }

      const destroyed = await destroyExpressSessionByHash(target.sessionId);
      if (!destroyed) {
        return res.status(500).json({ message: "Failed to revoke session. Please try again." });
      }

      await db.delete(activeSessions).where(eq(activeSessions.id, sessionId));

      await pool.query(`INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`, [
        req.session.orgId, userId, "session.revoked", "session", String(sessionId),
        JSON.stringify({ deviceLabel: target.deviceLabel }),
      ]);

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sessions/revoke-all", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const currentHash = hashSessionId(req.sessionID);

      const otherSessions = await db.select()
        .from(activeSessions)
        .where(and(
          eq(activeSessions.userId, userId),
          ne(activeSessions.sessionId, currentHash)
        ));

      if (otherSessions.length === 0) {
        return res.json({ revokedCount: 0 });
      }

      let failedCount = 0;
      for (const s of otherSessions) {
        const destroyed = await destroyExpressSessionByHash(s.sessionId);
        if (!destroyed) failedCount++;
      }

      await db.delete(activeSessions).where(and(
        eq(activeSessions.userId, userId),
        ne(activeSessions.sessionId, currentHash)
      ));

      await pool.query(`INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`, [
        req.session.orgId, userId, "session.revoked_all", "session", userId,
        JSON.stringify({ revokedCount: otherSessions.length, failedCount }),
      ]);

      return res.json({ revokedCount: otherSessions.length });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });
}
