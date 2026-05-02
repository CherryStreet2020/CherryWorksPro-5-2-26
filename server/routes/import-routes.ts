import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { importRuns } from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, requireAdmin, requireManagerOrAbove, requirePlanTier } from "./middleware";
import multer from "multer";
import path from "path";
import fs from "fs";
import { scanAndQuarantine } from "../av-scanner";
import { detectPlatformAndType, normalizeRows, PLATFORM_INFO } from "../import-normalizer";
import { detectFileType, parseCSV, parseCSVWithIntegrity, sha256Sync, runPreflightOnFile, buildDryRunPlan, buildImportOps, applyImportOps, computeRowIssueSummary, ParsedFileCache, verifyImportResults } from "../import-engine";
import type { ImportOptions, ImportStorage } from "../import-engine";

export function registerImportRoutes(app: Express) {

app.get("/api/import/platforms", requireAuth, async (req, res) => {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Import Wizard"))) return;
  res.json(PLATFORM_INFO);
});

const uploadDir = path.join(process.cwd(), "tmp", "imports");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });

app.post(
  "/api/import/upload",
  requireManagerOrAbove,
  upload.array("files", 10),
  async (req: Request, res: Response) => {
    if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Import Wizard"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;

    const uploadedFiles = req.files as Express.Multer.File[];
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const run = await storage.createImportRun({
      orgId,
      createdBy: userId,
      status: "PENDING",
    });

    const fileResults = [];

    for (const file of uploadedFiles) {
      const avResult = await scanAndQuarantine(file.path, orgId, userId, "import-upload");
      if (!avResult.clean) {
        return res.status(400).json({ message: `File rejected: malware detected (${avResult.threat})`, sha256: avResult.sha256 });
      }
      const content = fs.readFileSync(file.path, "utf-8");
      const firstLine = content.split(/\r?\n/)[0] || "";
      const { platform: detectedPlatform, dataType: detectedType } = detectPlatformAndType(firstLine);
      const type = detectedType !== "unknown" ? detectedType : detectFileType(firstLine);
      const sha = sha256Sync(content);

      await storage.createImportFile({
        orgId: req.session.orgId!,
        importRunId: run.id,
        type,
        sha256: sha,
        originalFilename: file.originalname,
        storedPath: file.path,
      });

      if (type === "unknown") {
        fileResults.push({
          filename: file.originalname,
          type: "unknown",
          platform: detectedPlatform,
          sha256: sha,
          rowCount: 0,
          warning: "Unrecognized CSV format — this file will be skipped during import.",
        });
      } else {
        try {
          const { rows: rawRows, integrity } = parseCSVWithIntegrity(content);
          const rows = normalizeRows(rawRows, detectedPlatform, type as any);
          const preflight = runPreflightOnFile(rows, type as any, file.originalname, sha);
          fileResults.push({ ...preflight, platform: detectedPlatform, parseIntegrity: integrity });
        } catch (err: any) {
          fileResults.push({
            filename: file.originalname,
            type,
            platform: detectedPlatform,
            sha256: sha,
            rowCount: 0,
            error: err.message || "CSV parse error",
          });
        }
      }
    }

    res.json({ importRunId: run.id, files: fileResults });
  },
);

app.get("/api/import/runs", requireManagerOrAbove, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Import Wizard"))) return;
  const orgId = req.session.orgId!;
  const runs = await storage.getImportRunsByOrg(orgId);
  res.json(runs);
});
app.get("/api/import/runs/:id", requireManagerOrAbove, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Import Wizard"))) return;
  const run = await storage.getImportRun(req.params.id as string);
  if (!run || run.orgId !== req.session.orgId) {
    return res.status(404).json({ message: "Import run not found" });
  }
  const files = await storage.getImportFilesByRun(run.id, req.session.orgId!);
  const keys = await storage.getImportedKeysByRun(run.id, req.session.orgId!);
  res.json({ ...run, files, importedKeyCount: keys.length });
});

const importParseCaches = new Map<string, ParsedFileCache>();

function getOrCreateParseCache(runId: string, files: { type: string; sha256: string; originalFilename: string; storedPath: string }[]): ParsedFileCache {
  const fingerprint = files.map(f => `${f.type}:${f.sha256}`).sort().join("|");
  const existing = importParseCaches.get(runId);
  if (existing && existing.fingerprint === fingerprint) {
    return existing;
  }

  const cache = new ParsedFileCache();
  for (const f of files) {
    const content = fs.readFileSync(f.storedPath, "utf-8");
    const raw = parseCSV(content);
    const firstLine = content.split(/\r?\n/)[0] || "";
    const { platform, dataType } = detectPlatformAndType(firstLine);
    const normalizedRows = normalizeRows(raw, platform, dataType);
    cache.set(f.type, {
      type: f.type as any,
      rows: normalizedRows,
      sha256: f.sha256,
      filename: f.originalFilename,
    });
  }
  importParseCaches.set(runId, cache);
  return cache;
}

app.post("/api/import/dry-run/:id", requireManagerOrAbove, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Import Wizard"))) return;
  const run = await storage.getImportRun(req.params.id as string);
  if (!run || run.orgId !== req.session.orgId) {
    return res.status(404).json({ message: "Import run not found" });
  }

  const options = req.body as ImportOptions;
  const files = await storage.getImportFilesByRun(run.id, req.session.orgId!);
  const cache = getOrCreateParseCache(run.id, files);

  const plan = await buildDryRunPlan(run.orgId, cache.getAll(), options);

  await storage.updateImportRun(run.id, run.orgId, { planHash: plan.planHash });

  res.json(plan);
});
app.post("/api/import/execute/:id", requireManagerOrAbove, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Import Wizard"))) return;
  const run = await storage.getImportRun(req.params.id as string);
  if (!run || run.orgId !== req.session.orgId) {
    return res.status(404).json({ message: "Import run not found" });
  }

  if (run.status !== "PENDING") {
    return res.status(400).json({ message: `Run is ${run.status}, cannot execute` });
  }

  const { planHash: clientPlanHash, ...options } = req.body as ImportOptions & { planHash: string };

  if (!clientPlanHash) {
    return res.status(400).json({ message: "PLAN_HASH_REQUIRED" });
  }

  if (run.planHash && run.planHash !== clientPlanHash) {
    return res.status(409).json({
      message: "PLAN_HASH_STALE",
      detail: "The plan hash does not match the stored dry-run plan. The source data or selections may have changed. Re-run dry-run.",
    });
  }

  const files = await storage.getImportFilesByRun(run.id, req.session.orgId!);
  const userId = req.session.userId!;

  for (const f of files) {
    const content = fs.readFileSync(f.storedPath, "utf-8");
    const currentHash = sha256Sync(content);
    if (currentHash !== f.sha256) {
      return res.status(409).json({
        message: "FILE_HASH_MISMATCH",
        detail: `File "${f.originalFilename}" was modified between dry-run and execute. Re-upload and re-run dry-run.`,
      });
    }
  }

  const cache = getOrCreateParseCache(run.id, files);
  const parsedFiles = cache.getAll();

  const { ops, ignored: execIgnored, rowIssues, planHash: serverPlanHash, reconciliation, fileRowCounts } = cache.buildOps(options);
  if (serverPlanHash !== clientPlanHash) {
    importParseCaches.delete(run.id);
    return res.status(409).json({
      message: "DRY_RUN_EXECUTE_DIVERGENCE",
      detail: "The plan computed at execute time differs from the dry-run plan. Re-run dry-run.",
    });
  }

  const lockKey = Buffer.from(run.id).reduce((h, b) => (h * 31 + b) | 0, 0);
  const advisoryResult = await db.execute(sql`SELECT pg_try_advisory_lock(${lockKey}) AS acquired`);
  const advisory = (advisoryResult as any).rows?.[0] ?? (advisoryResult as any)[0] ?? advisoryResult;
  if (!(advisory as any).acquired) {
    return res.status(409).json({ message: "Another execution is already in progress for this import run" });
  }

  try {
  const [lockedRun] = await db
    .update(importRuns)
    .set({ status: "RUNNING" as any, optionsJson: options })
    .where(and(eq(importRuns.id, run.id), eq(importRuns.orgId, run.orgId), eq(importRuns.status, "PENDING" as any)))
    .returning();

  if (!lockedRun) {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
    return res.status(409).json({ message: "Import run is no longer PENDING, cannot execute" });
  }

  try {
    let counts: Awaited<ReturnType<typeof applyImportOps>>;
    try {
      counts = await db.transaction(async () => {
        return await applyImportOps(
          run.orgId,
          userId,
          run.id,
          parsedFiles,
          ops,
          storage as unknown as ImportStorage,
        );
      });
    } catch (applyErr: any) {
      await storage.updateImportRun(run.id, run.orgId, {
        status: "FAILED",
        completedAt: new Date(),
        summaryJson: { error: applyErr.message, stage: "applyImportOps" },
      });
      importParseCaches.delete(run.id);
      return res.status(500).json({ message: sanitizeErrorMessage(applyErr) });
    }

    const rowIssueSummary = computeRowIssueSummary(rowIssues, execIgnored);

    const verification = await verifyImportResults(
      run.id,
      counts,
      storage as unknown as ImportStorage,
      req.session.orgId!,
    );

    const summaryJson: Record<string, unknown> = {
      ...counts,
      rowIssueSummary,
      reconciliation,
      fileRowCounts,
    };
    if (!verification.passed) {
      summaryJson.verificationWarnings = verification.checks.filter(c => !c.passed);
    }
    summaryJson.verificationPassed = verification.passed;

    try {
      await storage.updateImportRun(run.id, run.orgId, {
        status: "COMPLETED",
        completedAt: new Date(),
        summaryJson,
      });
    } catch (statusErr: any) {
      console.error("[import] Failed to mark import as COMPLETED:", statusErr.message);
      try {
        await storage.createAuditLog({
          orgId: run.orgId,
          userId,
          action: "IMPORT_STATUS_UPDATE_FAILED",
          entityType: "import_run",
          entityId: run.id,
          details: { ...counts, error: statusErr.message },
        });
      } catch (auditErr: any) { console.error("[import] Audit log failed:", auditErr.message); }
      importParseCaches.delete(run.id);
      return res.status(500).json({ message: "Import data applied but status update failed. Contact admin with run ID: " + run.id });
    }

    await storage.createAuditLog({
      orgId: run.orgId,
      userId,
      action: "IMPORT_EXECUTED",
      entityType: "import_run",
      entityId: run.id,
      details: counts,
    });

    importParseCaches.delete(run.id);

    res.json({ status: "COMPLETED", counts, rowIssues, rowIssueSummary, reconciliation, fileRowCounts, verification });
  } catch (err: any) {
    try {
      await storage.updateImportRun(run.id, run.orgId, {
        status: "FAILED",
        completedAt: new Date(),
        summaryJson: { error: err.message },
      });
    } catch (auditErr: any) { console.error("[import] Audit log failed:", auditErr.message); }
    importParseCaches.delete(run.id);
    res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
  }
});
app.post("/api/import/rollback/:id", requireAdmin, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Import Wizard"))) return;
  const run = await storage.getImportRun(req.params.id as string);
  if (!run || run.orgId !== req.session.orgId) {
    return res.status(404).json({ message: "Import run not found" });
  }

  if (run.status !== "COMPLETED") {
    return res.status(400).json({ message: `Run is ${run.status}, cannot rollback` });
  }

  const result = await storage.rollbackImportRun(run.id, run.orgId);

  await storage.createAuditLog({
    orgId: run.orgId,
    userId: req.session.userId!,
    action: "IMPORT_ROLLED_BACK",
    entityType: "import_run",
    entityId: run.id,
    details: result.deletedCounts,
  });

  res.json({ status: "ROLLED_BACK", ...result });
});

app.post("/api/admin/import/cleanup-stale", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const count = await cleanupStaleImportRuns(orgId);
    return res.json({ ok: true, abortedCount: count });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}

export async function cleanupStaleImportRuns(orgId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const conditions = [eq(importRuns.status, "PENDING"), sql`${importRuns.startedAt} < ${cutoff}`];
  if (orgId) {
    conditions.push(eq(importRuns.orgId, orgId));
  }
  const result = await db
    .update(importRuns)
    .set({
      status: "FAILED",
      completedAt: new Date(),
      summaryJson: { autoAborted: true, reason: "Exceeded 1h PENDING TTL" },
    })
    .where(and(...conditions))
    .returning({ id: importRuns.id });
  if (result.length > 0) {
    console.log(`[import-cleanup] Auto-aborted ${result.length} stale PENDING import run(s)${orgId ? ` for org ${orgId}` : ""}: ${result.map(r => r.id).join(", ")}`);
  }
  return result.length;
}
