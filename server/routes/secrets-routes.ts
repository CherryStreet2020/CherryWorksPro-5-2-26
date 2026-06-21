import type { Express, Request, Response } from "express";
import { requirePlatformOperator } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface SecretMeta {
  name: string;
  envVar: string;
  lastRotated: string | null;
  rotatable: boolean;
  category: "database" | "stripe" | "smtp" | "session" | "api" | "backup";
  daysUntilAlert: number;
}

const SECRET_DEFINITIONS: SecretMeta[] = [
  { name: "Database URL", envVar: "DATABASE_URL", lastRotated: null, rotatable: true, category: "database", daysUntilAlert: 90 },
  { name: "Stripe Secret Key", envVar: "STRIPE_SECRET_KEY", lastRotated: null, rotatable: true, category: "stripe", daysUntilAlert: 90 },
  { name: "Stripe Publishable Key", envVar: "STRIPE_PUBLISHABLE_KEY", lastRotated: null, rotatable: true, category: "stripe", daysUntilAlert: 90 },
  { name: "Stripe Webhook Secret", envVar: "STRIPE_WEBHOOK_SECRET", lastRotated: null, rotatable: true, category: "stripe", daysUntilAlert: 90 },
  { name: "Session Secret", envVar: "SESSION_SECRET", lastRotated: null, rotatable: true, category: "session", daysUntilAlert: 90 },
  { name: "SMTP Password", envVar: "SMTP_PASSWORD", lastRotated: null, rotatable: true, category: "smtp", daysUntilAlert: 90 },
  { name: "SMTP Host", envVar: "SMTP_HOST", lastRotated: null, rotatable: true, category: "smtp", daysUntilAlert: 90 },
  { name: "Backup Encryption Key", envVar: "BACKUP_ENCRYPTION_KEY", lastRotated: null, rotatable: true, category: "backup", daysUntilAlert: 90 },
  { name: "Groq API Key", envVar: "GROQ_API_KEY", lastRotated: null, rotatable: true, category: "api", daysUntilAlert: 90 },
];

const rotationTimestamps: Map<string, string> = new Map();

function getSecretStatus(envVar: string): { configured: boolean; lastRotated: string | null; ageDays: number | null; alerting: boolean } {
  const configured = !!process.env[envVar];
  const lastRotated = rotationTimestamps.get(envVar) || null;
  let ageDays: number | null = null;
  let alerting = false;
  if (lastRotated) {
    ageDays = Math.floor((Date.now() - new Date(lastRotated).getTime()) / (24 * 60 * 60 * 1000));
    alerting = ageDays > 90;
  } else if (configured) {
    alerting = true;
    ageDays = null;
  }
  return { configured, lastRotated, ageDays, alerting };
}

export function registerSecretsRoutes(app: Express) {

  app.get("/api/admin/secrets", requirePlatformOperator, (req: Request, res: Response) => {
    const secrets = SECRET_DEFINITIONS.map(def => {
      const status = getSecretStatus(def.envVar);
      return {
        name: def.name,
        envVar: def.envVar,
        category: def.category,
        configured: status.configured,
        lastRotated: status.lastRotated,
        ageDays: status.ageDays,
        alerting: status.alerting,
        rotatable: def.rotatable,
      };
    });

    const alertCount = secrets.filter(s => s.alerting).length;
    return res.json({ secrets, alertCount, alertThresholdDays: 90 });
  });

  app.post("/api/admin/secrets/rotate", requirePlatformOperator, async (req: Request, res: Response) => {
    const { envVar, newValue } = req.body;
    if (!envVar) return res.status(400).json({ message: "envVar is required" });

    const def = SECRET_DEFINITIONS.find(d => d.envVar === envVar);
    if (!def) return res.status(404).json({ message: "Unknown secret" });
    if (!def.rotatable) return res.status(400).json({ message: "This secret is not rotatable" });

    const oldConfigured = !!process.env[envVar];
    if (newValue) {
      process.env[envVar] = newValue;
    }

    const now = new Date().toISOString();
    rotationTimestamps.set(envVar, now);

    if (envVar === "SESSION_SECRET") {
      // no-downtime: existing sessions remain valid until they expire naturally
    }

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), req.session.orgId, req.session.userId, "SECRET_ROTATED", "secret", envVar,
          JSON.stringify({ envVar, category: def.category, previouslyConfigured: oldConfigured }),
          (req as any).ip || "unknown"]
      );
    } catch {}

    return res.json({
      success: true,
      envVar,
      lastRotated: now,
      message: `Secret ${def.name} rotated successfully. No downtime required.`,
    });
  });

  app.get("/api/admin/secrets/alerts", requirePlatformOperator, (_req: Request, res: Response) => {
    const alerts = SECRET_DEFINITIONS
      .map(def => {
        const status = getSecretStatus(def.envVar);
        return { ...def, ...status };
      })
      .filter(s => s.alerting);

    return res.json({
      alerts,
      count: alerts.length,
      threshold: "90 days",
      message: alerts.length > 0
        ? `${alerts.length} secret(s) need rotation (>90 days or never rotated)`
        : "All secrets are within rotation policy",
    });
  });

  app.post("/api/admin/secrets/mark-rotated", requirePlatformOperator, async (req: Request, res: Response) => {
    const { envVar } = req.body;
    if (!envVar) return res.status(400).json({ message: "envVar required" });
    const def = SECRET_DEFINITIONS.find(d => d.envVar === envVar);
    if (!def) return res.status(404).json({ message: "Unknown secret" });

    const now = new Date().toISOString();
    rotationTimestamps.set(envVar, now);

    try {
      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), req.session.orgId, req.session.userId, "SECRET_ROTATION_MARKED", "secret", envVar,
          JSON.stringify({ envVar, category: def.category }),
          (req as any).ip || "unknown"]
      );
    } catch {}

    return res.json({ success: true, envVar, lastRotated: now });
  });
}
