import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { requireAdmin } from "./middleware";
import { createEncryptedBackup, getRowCounts, verifyRestoration, purgeOldBackups, listBackups } from "../backup-drill";
import fs from "fs";
import { createHash, timingSafeEqual } from "crypto";

interface Incident {
  id: string;
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  createdAt: string;
  resolvedAt?: string;
}

const incidents: Incident[] = [];
const startTime = Date.now();

export function registerHealthRoutes(app: Express) {

  // =====================================================================
  // Container probes (Azure Container Apps). Added for the Azure migration.
  // =====================================================================

  /**
   * LIVENESS. Touches NOTHING — no database, no filesystem.
   *
   * A failed liveness probe RESTARTS the container. Every other health
   * endpoint in this file queries Postgres, so wiring liveness to one of
   * them would turn a recoverable database incident into a restart loop and
   * a total outage. This endpoint answers whether the event loop is alive
   * and nothing else, which is the only correct question for liveness.
   */
  app.get("/api/healthz", (_req: Request, res: Response) => {
    return res.status(200).json({ status: "alive" });
  });

  /**
   * READINESS / STARTUP, and the deploy gate's assertion surface.
   *
   * PUBLIC body is deliberately minimal — this is reachable unauthenticated
   * and the repository is public.
   *
   * PRIVILEGED body (x-internal-maintenance-token, same pattern as
   * /api/admin/email/m365-rescope) carries what a deploy gate must assert:
   *  - commit + revision, so the gate cannot pass against the OLD revision
   *    still draining behind the shared ingress FQDN;
   *  - `database`, which is the only way to prove the app is talking to the
   *    real database and not the rehearsal copy left over from Phase 7;
   *  - a cheap data fingerprint;
   *  - non-reversible sha256 prefixes of the four keys, which turn "the
   *    secrets were pasted correctly" from a hope into an assertion. A wrong
   *    BANKING_ or SMTP_ENCRYPTION_KEY makes stored data permanently
   *    unreadable, and nothing else in the pipeline would catch it.
   */
  app.get("/api/readyz", async (req: Request, res: Response) => {
    // The entrypoint writes this only after `drizzle-kit push --force`
    // exits 0. Without it, a half-applied schema from a mid-push network
    // blip would still answer Healthy and green every gate assertion.
    const pushOk = fs.existsSync("/tmp/db-push-ok");

    let dbOk = false;
    try {
      await pool.query("SELECT 1");
      dbOk = true;
    } catch (e: any) {
      console.error("[readyz] database check failed:", e?.message ?? e);
    }

    const healthy = dbOk && pushOk;
    const body: Record<string, unknown> = {
      status: healthy ? "Healthy" : "Unhealthy",
    };

    const expected = process.env.INTERNAL_MAINTENANCE_TOKEN;
    const provided = (req.headers["x-internal-maintenance-token"] as string | undefined) ?? "";
    let privileged = false;
    if (expected) {
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      privileged = a.length === b.length && timingSafeEqual(a, b);
    }

    if (privileged) {
      const fingerprint = (name: string): string | null => {
        const v = process.env[name];
        if (!v || v.trim() === "") return null;
        return createHash("sha256").update(v).digest("hex").slice(0, 12);
      };

      let database: string | null = null;
      let glJournalLines: number | null = null;
      try {
        const r = await pool.query("SELECT current_database() AS db");
        database = r.rows[0]?.db ?? null;
      } catch {
        /* reported via status */
      }
      try {
        const r = await pool.query("SELECT COUNT(*)::int AS cnt FROM gl_journal_lines");
        glJournalLines = r.rows[0]?.cnt ?? null;
      } catch {
        /* table may not exist on a fresh database — null is the answer */
      }

      body.checks = { database: dbOk, schemaPushMarker: pushOk };
      body.commit = process.env.GIT_COMMIT_SHA ?? null;
      body.revision = process.env.CONTAINER_APP_REVISION ?? null;
      body.database = database;
      body.dataFingerprint = { glJournalLines };
      body.nodeEnv = process.env.NODE_ENV ?? null;
      body.skipStartupMigrations = process.env.SKIP_STARTUP_MIGRATIONS ?? null;
      body.schedulersEnabled = process.env.SCHEDULERS_ENABLED ?? null;
      body.keyFingerprints = {
        SESSION_SECRET: fingerprint("SESSION_SECRET"),
        BANKING_ENCRYPTION_KEY: fingerprint("BANKING_ENCRYPTION_KEY"),
        SMTP_ENCRYPTION_KEY: fingerprint("SMTP_ENCRYPTION_KEY"),
        BACKUP_ENCRYPTION_KEY: fingerprint("BACKUP_ENCRYPTION_KEY"),
      };
      body.uptimeSeconds = Math.floor(process.uptime());
    }

    return res.status(healthy ? 200 : 503).json(body);
  });

  app.get("/api/public/status", async (_req: Request, res: Response) => {
    const checks: Record<string, string> = {};
    let overall = "operational";

    try {
      const start = Date.now();
      await pool.query("SELECT 1");
      checks.database = `ok (${Date.now() - start}ms)`;
    } catch {
      checks.database = "degraded";
      overall = "degraded";
    }

    try {
      checks.api = "operational";
    } catch {
      checks.api = "degraded";
      overall = "degraded";
    }

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const uptimeHours = (uptimeSeconds / 3600).toFixed(1);

    return res.json({
      status: overall,
      uptime: `${uptimeHours}h`,
      uptimeSeconds,
      checks,
      incidents: incidents.slice(-10),
      lastChecked: new Date().toISOString(),
    });
  });

  app.get("/api/help/status", async (_req: Request, res: Response) => {
    try {
      const start = Date.now();
      await pool.query({ text: "SELECT 1", timeout: 3000 } as any);
      const latencyMs = Date.now() - start;
      const status = latencyMs > 2000 ? "degraded" : "ok";
      return res.json({ status, latencyMs });
    } catch {
      return res.json({ status: "offline", latencyMs: -1 });
    }
  });

  app.get("/api/public/healthz", async (req: Request, res: Response) => {
    const deep = req.query.deep === "true";
    const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {};
    let healthy = true;

    const dbStart = Date.now();
    try {
      const r = await pool.query("SELECT COUNT(*)::int AS cnt FROM orgs");
      checks.database = { status: "ok", latencyMs: Date.now() - dbStart, detail: `${r.rows[0]?.cnt || 0} orgs` };
    } catch (e: any) {
      // Public endpoint — see the note on /api/health in server/routes.ts.
      console.error(`[public/healthz] db check failed:`, e?.message ?? e);
      checks.database = { status: "fail", latencyMs: Date.now() - dbStart, detail: "unavailable" };
      healthy = false;
    }

    checks.pool = {
      status: pool.totalCount > 0 ? "ok" : "warn",
      detail: `active=${pool.totalCount - pool.idleCount} idle=${pool.idleCount} waiting=${pool.waitingCount} total=${pool.totalCount}`,
    };

    if (deep) {
      try {
        const tableCheck = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
        checks.schema = { status: "ok", detail: `${tableCheck.rows.length} tables` };
      } catch (e: any) {
        checks.schema = { status: "fail", detail: e.message };
        healthy = false;
      }

      const stripeKey = process.env.STRIPE_SECRET_KEY;
      checks.stripe = { status: stripeKey ? "configured" : "not_configured" };

      const smtpHost = process.env.SMTP_HOST;
      checks.smtp = { status: smtpHost ? "configured" : "not_configured" };

      try {
        const uploadsDir = "uploads";
        const exists = fs.existsSync(uploadsDir);
        checks.storage = { status: exists ? "ok" : "warn", detail: exists ? "uploads dir exists" : "uploads dir missing" };
      } catch {
        checks.storage = { status: "warn", detail: "cannot check" };
      }
    }

    const requestId = (req as any).requestId || "unknown";
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "unhealthy",
      checks,
      requestId,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get("/api/admin/incidents", requireAdmin, (_req: Request, res: Response) => {
    return res.json({ incidents });
  });

  app.post("/api/admin/incidents", requireAdmin, (req: Request, res: Response) => {
    const { title, status } = req.body;
    if (!title) return res.status(400).json({ message: "title required" });
    const incident: Incident = {
      id: `inc-${Date.now()}`,
      title,
      status: status || "investigating",
      createdAt: new Date().toISOString(),
    };
    incidents.push(incident);
    return res.json(incident);
  });

  app.patch("/api/admin/incidents/:id", requireAdmin, (req: Request, res: Response) => {
    const inc = incidents.find(i => i.id === req.params.id);
    if (!inc) return res.status(404).json({ message: "Incident not found" });
    if (req.body.status) {
      inc.status = req.body.status;
      if (req.body.status === "resolved") inc.resolvedAt = new Date().toISOString();
    }
    if (req.body.title) inc.title = req.body.title;
    return res.json(inc);
  });

  app.post("/api/admin/backup/create", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await createEncryptedBackup();
      return res.json({ success: true, ...result });
    } catch (e: any) {
      return res.status(500).json({ message: `Backup failed: ${e.message}` });
    }
  });

  app.get("/api/admin/backup/list", requireAdmin, async (_req: Request, res: Response) => {
    const backups = listBackups();
    return res.json({ backups, retentionDays: Number(process.env.BACKUP_RETENTION_DAYS) || 30 });
  });

  app.post("/api/admin/backup/verify", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const counts = await getRowCounts();
      const verification = await verifyRestoration(counts);
      return res.json({ success: true, verification });
    } catch (e: any) {
      return res.status(500).json({ message: `Verification failed: ${e.message}` });
    }
  });

  app.post("/api/admin/backup/purge", requireAdmin, async (_req: Request, res: Response) => {
    const removed = purgeOldBackups();
    return res.json({ removed, retentionDays: Number(process.env.BACKUP_RETENTION_DAYS) || 30 });
  });

  app.post("/api/admin/backup/drill", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const sourceCounts = await getRowCounts();
      const backup = await createEncryptedBackup();
      const verification = await verifyRestoration(sourceCounts);
      return res.json({
        success: true,
        backup: { filepath: backup.filepath, sizeBytes: backup.sizeBytes, checksum: backup.checksum },
        verification,
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      return res.status(500).json({ message: `Drill failed: ${e.message}` });
    }
  });
}
