import type { Express } from "express";
import { requireAuth, requireAdmin , requirePlanTier } from "./middleware";
import { scanFile, hashFile, scanAndQuarantine } from "../av-scanner";
import { db, pool } from "../db";
import { auditLogs } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import path from "path";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "fs";

export function registerAvScanRoutes(app: Express) {

app.get("/api/admin/av/config", requireAdmin, async (_req, res) => {
  return res.json({
    engine: "built-in-signature",
    signaturePatterns: ["EICAR-Test", "EXE-MZ", "ELF-Binary", "PHP-Open", "Script-Shebang"],
    contentPatterns: ["script-injection", "javascript-uri", "event-handlers", "eval", "document-access", "window-access"],
    quarantineDir: "uploads/quarantine",
    hashAlgorithm: "sha256",
    maxFileSize: "50MB",
    scanOnUpload: true,
    auditOnDetection: true,
  });
});

app.post("/api/admin/av/test-scan", requireAdmin, async (req, res) => {
  try {
  if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "Advanced AV Scanning"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const testType = req.body.type || "clean";

    const testDir = path.join(process.cwd(), "uploads", "test-scans");
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });

    const testFile = path.join(testDir, `test_${Date.now()}.txt`);

    if (testType === "eicar") {
      writeFileSync(testFile, "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    } else if (testType === "script") {
      writeFileSync(testFile, "<script>alert('xss')</script>");
    } else {
      writeFileSync(testFile, "This is a clean test file for AV scanning proof.");
    }

    const result = await scanAndQuarantine(testFile, orgId, userId, `av-test-${testType}`);

    if (result.clean && existsSync(testFile)) {
      try { unlinkSync(testFile); } catch {}
    }

    return res.json({
      testType,
      sha256: result.sha256,
      clean: result.clean,
      threat: result.threat || null,
      quarantined: result.quarantined || false,
      auditLogged: !result.clean,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/av/quarantine", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const result = await pool.query(
      `SELECT id, action, entity_id, details, created_at FROM audit_logs WHERE org_id = $1 AND action = 'UPLOAD_QUARANTINED' ORDER BY created_at DESC LIMIT 50`,
      [orgId]
    );

    return res.json({
      quarantinedFiles: result.rows.map(r => ({
        auditLogId: r.id,
        sha256: r.entity_id,
        details: r.details,
        quarantinedAt: r.created_at,
      })),
      count: result.rows.length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

app.get("/api/admin/av/stats", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const quarantinedResult = await pool.query(
      `SELECT COUNT(*) as count FROM audit_logs WHERE org_id = $1 AND action = 'UPLOAD_QUARANTINED'`,
      [orgId]
    );
    const totalScans = await pool.query(
      `SELECT COUNT(*) as count FROM audit_logs WHERE org_id = $1 AND (action = 'UPLOAD_QUARANTINED' OR action = 'FILE_UPLOADED')`,
      [orgId]
    );

    return res.json({
      quarantinedCount: parseInt(quarantinedResult.rows[0]?.count || "0"),
      totalScans: parseInt(totalScans.rows[0]?.count || "0"),
      scanEngine: "built-in-signature",
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

}
