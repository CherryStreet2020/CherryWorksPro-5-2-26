import type { Express, Request, Response } from "express";
import { requireAuth, sanitizeErrorMessage } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface TimerState {
  id: string;
  userId: string;
  orgId: string;
  projectId: string | null;
  description: string;
  startedAt: Date;
  pausedAt: Date | null;
  accumulatedMs: number;
  status: "running" | "paused" | "idle" | "stopped";
  lastActivityAt: Date;
  deviceId: string;
}

const activeTimers = new Map<string, TimerState>();
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

function getUserTimerKey(userId: string, orgId: string) {
  return `${orgId}:${userId}`;
}

function checkIdle(timer: TimerState): TimerState {
  if (timer.status === "running") {
    const elapsed = Date.now() - timer.lastActivityAt.getTime();
    if (elapsed >= IDLE_THRESHOLD_MS) {
      timer.status = "idle";
      timer.pausedAt = new Date(timer.lastActivityAt.getTime() + IDLE_THRESHOLD_MS);
      timer.accumulatedMs += IDLE_THRESHOLD_MS;
    }
  }
  return timer;
}

function getElapsedMs(timer: TimerState): number {
  if (timer.status === "running") {
    return timer.accumulatedMs + (Date.now() - timer.lastActivityAt.getTime());
  }
  return timer.accumulatedMs;
}

export function registerTimerRoutes(app: Express) {

app.get("/api/timer/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const key = getUserTimerKey(req.session.userId!, req.session.orgId!);
    let timer = activeTimers.get(key);
    if (!timer) {
      return res.json({ active: false, timer: null });
    }
    timer = checkIdle(timer);
    return res.json({
      active: timer.status === "running" || timer.status === "idle",
      timer: {
        id: timer.id,
        projectId: timer.projectId,
        description: timer.description,
        status: timer.status,
        startedAt: timer.startedAt.toISOString(),
        elapsedMs: getElapsedMs(timer),
        elapsedMinutes: Math.round(getElapsedMs(timer) / 60000),
        pausedAt: timer.pausedAt?.toISOString() || null,
        lastActivityAt: timer.lastActivityAt.toISOString(),
        deviceId: timer.deviceId,
        idleDetected: timer.status === "idle",
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/timer/start", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const key = getUserTimerKey(userId, orgId);
    const { projectId, description, deviceId } = req.body;

    const existing = activeTimers.get(key);
    if (existing && (existing.status === "running" || existing.status === "idle")) {
      return res.status(409).json({
        message: "Timer already running. Stop it first.",
        existingTimer: { id: existing.id, description: existing.description, status: existing.status },
      });
    }

    const timer: TimerState = {
      id: randomUUID(),
      userId,
      orgId,
      projectId: projectId || null,
      description: description || "",
      startedAt: new Date(),
      pausedAt: null,
      accumulatedMs: 0,
      status: "running",
      lastActivityAt: new Date(),
      deviceId: deviceId || "web",
    };

    activeTimers.set(key, timer);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'TIMER_STARTED', 'timer', $3, $4)`,
      [orgId, userId, timer.id, JSON.stringify({ projectId: timer.projectId, description: timer.description, deviceId: timer.deviceId })]
    );

    return res.json({ success: true, timer: { id: timer.id, status: "running", startedAt: timer.startedAt.toISOString() } });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/timer/stop", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const key = getUserTimerKey(userId, orgId);
    const timer = activeTimers.get(key);
    if (!timer) return res.status(404).json({ message: "No active timer" });

    checkIdle(timer);
    const totalMs = getElapsedMs(timer);
    const totalMinutes = Math.round(totalMs / 60000);
    timer.status = "stopped";
    activeTimers.delete(key);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'TIMER_STOPPED', 'timer', $3, $4)`,
      [orgId, userId, timer.id, JSON.stringify({ totalMinutes, projectId: timer.projectId, description: timer.description })]
    );

    return res.json({
      success: true,
      timerId: timer.id,
      totalMs,
      totalMinutes,
      projectId: timer.projectId,
      description: timer.description,
      startedAt: timer.startedAt.toISOString(),
      stoppedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/timer/heartbeat", requireAuth, async (req: Request, res: Response) => {
  try {
    const key = getUserTimerKey(req.session.userId!, req.session.orgId!);
    const timer = activeTimers.get(key);
    if (!timer) return res.status(404).json({ message: "No active timer" });

    if (timer.status === "running") {
      timer.lastActivityAt = new Date();
    }

    return res.json({
      success: true,
      status: timer.status,
      elapsedMs: getElapsedMs(timer),
      idleDetected: timer.status === "idle",
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/timer/idle-resolve", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const key = getUserTimerKey(userId, orgId);
    const timer = activeTimers.get(key);
    if (!timer) return res.status(404).json({ message: "No active timer" });
    if (timer.status !== "idle") return res.status(400).json({ message: "Timer is not idle" });

    const { action } = req.body;
    if (action === "keep") {
      timer.status = "running";
      timer.lastActivityAt = new Date();
      timer.pausedAt = null;

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, 'TIMER_IDLE_KEPT', 'timer', $3, $4)`,
        [orgId, userId, timer.id, JSON.stringify({ accumulatedMinutes: Math.round(timer.accumulatedMs / 60000) })]
      );

      return res.json({ success: true, action: "keep", status: "running", elapsedMs: getElapsedMs(timer) });
    } else if (action === "discard") {
      activeTimers.delete(key);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, 'TIMER_IDLE_DISCARDED', 'timer', $3, $4)`,
        [orgId, userId, timer.id, JSON.stringify({ discardedMinutes: Math.round(timer.accumulatedMs / 60000) })]
      );

      return res.json({ success: true, action: "discard", status: "discarded" });
    }

    return res.status(400).json({ message: "action must be 'keep' or 'discard'" });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/timer/pause", requireAuth, async (req: Request, res: Response) => {
  try {
    const key = getUserTimerKey(req.session.userId!, req.session.orgId!);
    const timer = activeTimers.get(key);
    if (!timer) return res.status(404).json({ message: "No active timer" });
    if (timer.status !== "running") return res.status(400).json({ message: "Timer is not running" });

    timer.accumulatedMs += Date.now() - timer.lastActivityAt.getTime();
    timer.status = "paused";
    timer.pausedAt = new Date();

    return res.json({ success: true, status: "paused", elapsedMs: timer.accumulatedMs });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/timer/resume", requireAuth, async (req: Request, res: Response) => {
  try {
    const key = getUserTimerKey(req.session.userId!, req.session.orgId!);
    const timer = activeTimers.get(key);
    if (!timer) return res.status(404).json({ message: "No active timer" });
    if (timer.status !== "paused") return res.status(400).json({ message: "Timer is not paused" });

    timer.status = "running";
    timer.lastActivityAt = new Date();
    timer.pausedAt = null;

    return res.json({ success: true, status: "running", elapsedMs: getElapsedMs(timer) });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
