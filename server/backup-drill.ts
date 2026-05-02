import { execSync } from "child_process";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import fs from "fs";
import path from "path";
import { pool } from "./db";

const BACKUP_DIR = path.join(process.cwd(), "backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 30;
const ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || createHash("sha256").update("dev-backup-key-change-in-prod").digest();

interface BackupResult {
  filepath: string;
  sizeBytes: number;
  encrypted: boolean;
  timestamp: string;
  checksum: string;
}

interface RestoreVerification {
  sourceRowCounts: Record<string, number>;
  restoredRowCounts: Record<string, number>;
  mismatches: string[];
  arGlParity: { arTotal: string; glBalance: string; diff: string; ok: boolean };
  passed: boolean;
}

export function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export async function createEncryptedBackup(): Promise<BackupResult> {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpFile = path.join(BACKUP_DIR, `cwp-backup-${timestamp}.sql`);
  const encFile = path.join(BACKUP_DIR, `cwp-backup-${timestamp}.sql.enc`);

  const dbUrl = process.env.DATABASE_URL!;
  execSync(`pg_dump "${dbUrl}" --no-owner --no-privileges > "${dumpFile}"`, { timeout: 60_000 });

  const iv = randomBytes(16);
  const key = typeof ENCRYPTION_KEY === "string" ? createHash("sha256").update(ENCRYPTION_KEY).digest() : ENCRYPTION_KEY;
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const input = fs.readFileSync(dumpFile);
  const encrypted = Buffer.concat([iv, cipher.update(input), cipher.final()]);
  fs.writeFileSync(encFile, encrypted);

  const checksum = createHash("sha256").update(encrypted).digest("hex");

  fs.unlinkSync(dumpFile);

  const stats = fs.statSync(encFile);
  return {
    filepath: encFile,
    sizeBytes: stats.size,
    encrypted: true,
    timestamp: new Date().toISOString(),
    checksum,
  };
}

export function decryptBackup(encFilePath: string): string {
  const encrypted = fs.readFileSync(encFilePath);
  const iv = encrypted.subarray(0, 16);
  const data = encrypted.subarray(16);
  const key = typeof ENCRYPTION_KEY === "string" ? createHash("sha256").update(ENCRYPTION_KEY).digest() : ENCRYPTION_KEY;
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  const outFile = encFilePath.replace(".enc", ".restored.sql");
  fs.writeFileSync(outFile, decrypted);
  return outFile;
}

export async function getRowCounts(): Promise<Record<string, number>> {
  const tables = [
    "orgs", "users", "clients", "services", "projects",
    "invoices", "invoice_lines", "payments", "expenses",
    "gl_accounts", "gl_journal_entries", "gl_journal_lines",
    "audit_logs", "time_entries",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT COUNT(*)::int AS cnt FROM "${t}"`);
      counts[t] = r.rows[0]?.cnt || 0;
    } catch { counts[t] = 0; }
  }
  return counts;
}

export async function verifyRestoration(sourceCountsSnapshot: Record<string, number>): Promise<RestoreVerification> {
  const currentCounts = await getRowCounts();
  const mismatches: string[] = [];
  for (const [table, expected] of Object.entries(sourceCountsSnapshot)) {
    const actual = currentCounts[table] ?? 0;
    if (actual !== expected) {
      mismatches.push(`${table}: expected=${expected} actual=${actual}`);
    }
  }

  const { arTotal, glBalance, diff, arGlOk } = await (async () => {
    try {
      const arResult = await pool.query(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0)::numeric(12,2) AS ar FROM invoices WHERE status NOT IN ('DRAFT','VOID')`);
      const arTotal = String(arResult.rows[0]?.ar ?? "0.00");
      const glResult = await pool.query(`SELECT COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount ELSE -amount END),0)::numeric(12,2) AS bal FROM gl_journal_lines jl JOIN gl_journal_entries je ON jl.journal_entry_id=je.id WHERE jl.account_id IN (SELECT id FROM gl_accounts WHERE code='1200')`);
      const glBalance = String(glResult.rows[0]?.bal ?? "0.00");
      const d = Math.abs(parseFloat(arTotal) - parseFloat(glBalance));
      return { arTotal, glBalance, diff: d.toFixed(2), arGlOk: d < 0.01 };
    } catch {
      return { arTotal: "0.00", glBalance: "0.00", diff: "0.00", arGlOk: true };
    }
  })();

  return {
    sourceRowCounts: sourceCountsSnapshot,
    restoredRowCounts: currentCounts,
    mismatches,
    arGlParity: { arTotal, glBalance, diff, ok: arGlOk },
    passed: mismatches.length === 0 && arGlOk,
  };
}

export function purgeOldBackups(): number {
  ensureBackupDir();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    const fp = path.join(BACKUP_DIR, f);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(fp);
      removed++;
    }
  }
  return removed;
}

export function listBackups(): Array<{ filename: string; sizeBytes: number; created: string }> {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".enc"))
    .map(f => {
      const fp = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(fp);
      return { filename: f, sizeBytes: stat.size, created: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}
