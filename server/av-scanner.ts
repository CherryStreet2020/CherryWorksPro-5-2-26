import { createHash } from "crypto";
import { readFileSync, renameSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { db } from "./db";
import { auditLogs } from "@shared/schema";

const QUARANTINE_DIR = path.join(process.cwd(), "uploads", "quarantine");

const MALICIOUS_SIGNATURES: Array<{ name: string; pattern: Buffer }> = [
  { name: "EICAR-Test", pattern: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR") },
  { name: "EXE-MZ", pattern: Buffer.from([0x4d, 0x5a]) },
  { name: "ELF-Binary", pattern: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { name: "PHP-Open", pattern: Buffer.from("<?php") },
  { name: "Script-Shebang", pattern: Buffer.from("#!/") },
];

const SUSPICIOUS_CONTENT_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /on(error|load|click|mouseover)\s*=/i,
  /eval\s*\(/i,
  /document\.(cookie|write|location)/i,
  /window\.(location|open)/i,
];

export interface ScanResult {
  sha256: string;
  clean: boolean;
  threat?: string;
  quarantined?: boolean;
}

export function hashFile(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export function scanFile(filePath: string): ScanResult {
  const data = readFileSync(filePath);
  const sha256 = createHash("sha256").update(data).digest("hex");

  for (const sig of MALICIOUS_SIGNATURES) {
    if (data.subarray(0, sig.pattern.length).equals(sig.pattern)) {
      return { sha256, clean: false, threat: sig.name };
    }
  }

  const textContent = data.toString("utf8", 0, Math.min(data.length, 65536));
  for (const pattern of SUSPICIOUS_CONTENT_PATTERNS) {
    if (pattern.test(textContent)) {
      return { sha256, clean: false, threat: "Suspicious-Content" };
    }
  }

  return { sha256, clean: true };
}

export async function scanAndQuarantine(
  filePath: string,
  orgId: string,
  userId: string | null,
  context: string,
): Promise<ScanResult> {
  const result = scanFile(filePath);

  if (!result.clean) {
    if (!existsSync(QUARANTINE_DIR)) {
      mkdirSync(QUARANTINE_DIR, { recursive: true });
    }
    const qPath = path.join(QUARANTINE_DIR, `${result.sha256}_${Date.now()}`);
    try {
      renameSync(filePath, qPath);
      result.quarantined = true;
    } catch {
      result.quarantined = false;
    }

    try {
      await db.insert(auditLogs).values({
        orgId,
        userId: userId || "system",
        action: "UPLOAD_QUARANTINED",
        entityType: "file",
        entityId: result.sha256,
        details: {
          threat: result.threat,
          context,
          originalPath: filePath,
          quarantinePath: qPath,
        },
      });
    } catch {}
  }

  return result;
}
