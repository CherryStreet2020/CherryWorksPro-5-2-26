import type { Express, Request, Response } from "express";
import { requireAdmin } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed" | "dead_letter";
  payload: Record<string, any>;
  result?: any;
  error?: string;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  history: Array<{ attempt: number; status: string; timestamp: string; error?: string }>;
}

const jobs: Map<string, Job> = new Map();

function seedJobsFromWebhookDeliveries() {
  pool.query(`SELECT id, event, status, attempts, created_at, idempotency_key FROM webhook_deliveries ORDER BY created_at DESC LIMIT 100`)
    .then(r => {
      for (const row of r.rows) {
        const jobStatus = row.status === "delivered" ? "completed"
          : row.status === "dead_letter" ? "dead_letter"
          : row.attempts > 0 ? "failed" : "queued";
        const job: Job = {
          id: row.id,
          type: `webhook:${row.event}`,
          status: jobStatus as any,
          payload: { event: row.event },
          attempts: row.attempts || 0,
          maxAttempts: 6,
          idempotencyKey: row.idempotency_key || row.id,
          createdAt: row.created_at,
          updatedAt: row.created_at,
          history: [],
        };
        if (!jobs.has(row.id)) jobs.set(row.id, job);
      }
    })
    .catch(() => {});
}

setTimeout(seedJobsFromWebhookDeliveries, 2000);

export function registerJobQueueRoutes(app: Express) {

  app.get("/api/admin/jobs", requireAdmin, (req: Request, res: Response) => {
    const { status, type, limit: lim, offset: off } = req.query;
    let jobList = Array.from(jobs.values());
    if (status) jobList = jobList.filter(j => j.status === status);
    if (type) jobList = jobList.filter(j => j.type.includes(type as string));
    jobList.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const total = jobList.length;
    const limit = Number(lim) || 50;
    const offset = Number(off) || 0;
    const paged = jobList.slice(offset, offset + limit);

    const counts = {
      queued: Array.from(jobs.values()).filter(j => j.status === "queued").length,
      running: Array.from(jobs.values()).filter(j => j.status === "running").length,
      completed: Array.from(jobs.values()).filter(j => j.status === "completed").length,
      failed: Array.from(jobs.values()).filter(j => j.status === "failed").length,
      dead_letter: Array.from(jobs.values()).filter(j => j.status === "dead_letter").length,
    };

    return res.json({ jobs: paged, total, counts });
  });

  app.get("/api/admin/jobs/:id", requireAdmin, (req: Request, res: Response) => {
    const job = jobs.get(req.params.id as string);
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json(job);
  });

  app.post("/api/admin/jobs/:id/retry", requireAdmin, async (req: Request, res: Response) => {
    const job = jobs.get(req.params.id as string);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.status !== "failed" && job.status !== "dead_letter") {
      return res.status(400).json({ message: `Cannot retry job in ${job.status} status` });
    }

    const newIdempotencyKey = `retry-${job.id}-${Date.now()}`;
    job.status = "queued";
    job.attempts = 0;
    job.idempotencyKey = newIdempotencyKey;
    job.updatedAt = new Date().toISOString();
    job.error = undefined;
    job.history.push({
      attempt: job.history.length + 1,
      status: "retry_queued",
      timestamp: new Date().toISOString(),
    });

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), req.session.orgId, req.session.userId, "JOB_RETRY", "job", job.id, JSON.stringify({ type: job.type, newIdempotencyKey }), (req as any).ip || "unknown"]
      );
    } catch {}

    return res.json({ success: true, job });
  });

  app.get("/api/admin/jobs/dead-letter/inspect", requireAdmin, (_req: Request, res: Response) => {
    const deadLetters = Array.from(jobs.values()).filter(j => j.status === "dead_letter");
    return res.json({
      count: deadLetters.length,
      jobs: deadLetters.map(j => ({
        id: j.id,
        type: j.type,
        error: j.error,
        attempts: j.attempts,
        createdAt: j.createdAt,
        history: j.history,
      })),
    });
  });

  app.post("/api/admin/jobs/:id/replay", requireAdmin, async (req: Request, res: Response) => {
    const job = jobs.get(req.params.id as string);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const existingReplay = Array.from(jobs.values()).find(
      j => j.idempotencyKey === `replay-${job.id}` && j.status !== "failed"
    );
    if (existingReplay) {
      return res.status(409).json({ message: "Replay already in progress", existingJobId: existingReplay.id });
    }

    const replayJob: Job = {
      id: randomUUID(),
      type: job.type,
      status: "queued",
      payload: { ...job.payload, replayOf: job.id },
      attempts: 0,
      maxAttempts: job.maxAttempts,
      idempotencyKey: `replay-${job.id}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ attempt: 0, status: "replay_created", timestamp: new Date().toISOString() }],
    };
    jobs.set(replayJob.id, replayJob);

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), req.session.orgId, req.session.userId, "JOB_REPLAY", "job", replayJob.id, JSON.stringify({ originalJobId: job.id, type: job.type }), (req as any).ip || "unknown"]
      );
    } catch {}

    return res.json({ success: true, replayJob });
  });

  app.post("/api/admin/jobs/test", requireAdmin, (req: Request, res: Response) => {
    const { type, payload } = req.body;
    const job: Job = {
      id: randomUUID(),
      type: type || "test:job",
      status: "queued",
      payload: payload || {},
      attempts: 0,
      maxAttempts: 3,
      idempotencyKey: `test-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ attempt: 0, status: "created", timestamp: new Date().toISOString() }],
    };
    jobs.set(job.id, job);
    return res.json({ success: true, job });
  });
}
