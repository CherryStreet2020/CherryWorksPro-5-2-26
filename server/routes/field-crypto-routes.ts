import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, orgs, webhookEndpoints } from "@shared/schema";
import { requirePlatformOperator } from "./middleware";
import {
  storage,
  decryptField,
  encryptField,
  isBankingCiphertextOnCurrentKey,
} from "../storage";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  isSmtpEncrypted,
  isSmtpCiphertextOnCurrentKey,
} from "../email";

/**
 * Operator-gated field-crypto rotation tooling.
 *
 * Covers every column encrypted with BANKING_ENCRYPTION_KEY / SMTP_ENCRYPTION_KEY:
 *   - users.bank_routing_number, users.bank_account_number  (banking key)
 *   - webhook_endpoints.secret                              (banking key)
 *   - orgs.smtp_pass, orgs.email_oauth_refresh_token        (smtp key)
 * (mfaEnrollments.secret uses its own scheme and is intentionally excluded.)
 *
 * GET  /api/admin/field-crypto/status   — read-only: counts encrypted vs
 *        pending (old-key) values per column, across ALL tenants.
 * POST /api/admin/field-crypto/reencrypt — decrypt-with-fallback → re-encrypt
 *        under the CURRENT key for every pending value, round-trip verified
 *        before write, idempotent (already-current rows are skipped).
 *
 * Designed for the BANKING/SMTP key rotation cutover: deploy with the new key as
 * current and the old key as *_OLD, run reencrypt, confirm 0 pending, then
 * retire the old key. Never logs or returns plaintext secret values.
 */

const BANKING_USER_COLS = ["bankRoutingNumber", "bankAccountNumber"] as const;
// webhook_endpoints.secret AND .old_secret (the previous secret kept during the
// post-rotation grace period) are both banking-key encrypted and must be re-keyed.
const WEBHOOK_COLS = ["secret", "oldSecret"] as const;
const WEBHOOK_COL_NAMES: Record<(typeof WEBHOOK_COLS)[number], string> = { secret: "secret", oldSecret: "old_secret" };
const SMTP_ORG_COLS = ["smtpPass", "emailOauthRefreshToken"] as const;

interface ColumnStat {
  column: string;
  key: "banking" | "smtp";
  encrypted: number;
  onCurrentKey: number;
  pending: number;
}

async function collectStatus(): Promise<ColumnStat[]> {
  const stats: ColumnStat[] = [];

  const userRows = await db
    .select({ id: users.id, bankRoutingNumber: users.bankRoutingNumber, bankAccountNumber: users.bankAccountNumber })
    .from(users);
  for (const col of BANKING_USER_COLS) {
    let encrypted = 0;
    let onCurrent = 0;
    for (const u of userRows) {
      const v = u[col];
      if (typeof v === "string" && v.startsWith("enc:")) {
        encrypted++;
        if (isBankingCiphertextOnCurrentKey(v)) onCurrent++;
      }
    }
    stats.push({ column: `users.${col}`, key: "banking", encrypted, onCurrentKey: onCurrent, pending: encrypted - onCurrent });
  }

  const whRows = await db
    .select({ id: webhookEndpoints.id, secret: webhookEndpoints.secret, oldSecret: webhookEndpoints.oldSecret })
    .from(webhookEndpoints);
  for (const col of WEBHOOK_COLS) {
    let encrypted = 0;
    let onCurrent = 0;
    for (const w of whRows) {
      const v = w[col];
      if (typeof v === "string" && v.startsWith("enc:")) {
        encrypted++;
        if (isBankingCiphertextOnCurrentKey(v)) onCurrent++;
      }
    }
    stats.push({ column: `webhook_endpoints.${WEBHOOK_COL_NAMES[col]}`, key: "banking", encrypted, onCurrentKey: onCurrent, pending: encrypted - onCurrent });
  }

  const orgRows = await db
    .select({ id: orgs.id, smtpPass: orgs.smtpPass, emailOauthRefreshToken: orgs.emailOauthRefreshToken })
    .from(orgs);
  for (const col of SMTP_ORG_COLS) {
    let encrypted = 0;
    let onCurrent = 0;
    for (const o of orgRows) {
      const v = o[col];
      if (typeof v === "string" && isSmtpEncrypted(v)) {
        encrypted++;
        if (isSmtpCiphertextOnCurrentKey(v)) onCurrent++;
      }
    }
    stats.push({ column: `orgs.${col}`, key: "smtp", encrypted, onCurrentKey: onCurrent, pending: encrypted - onCurrent });
  }

  return stats;
}

interface ReencryptResult {
  scanned: number;
  reencrypted: number;
  skipped: number;
  byColumn: Record<string, number>;
  errors: { column: string; id: string; error: string }[];
}

// Re-encrypt a banking ciphertext under the current key, verifying the
// plaintext round-trips before returning the new ciphertext.
function reencryptBankingVerified(v: string): string {
  const before = decryptField(v); // old key via dual-key fallback
  const next = encryptField(before); // current key
  if (decryptField(next) !== before) throw new Error("round-trip verification failed");
  return next;
}

function reencryptSmtpVerified(v: string): string {
  const before = decryptSmtpPassword(v);
  const next = encryptSmtpPassword(before);
  if (decryptSmtpPassword(next) !== before) throw new Error("round-trip verification failed");
  return next;
}

async function reencryptAll(): Promise<ReencryptResult> {
  const res: ReencryptResult = { scanned: 0, reencrypted: 0, skipped: 0, byColumn: {}, errors: [] };
  const bump = (col: string) => { res.byColumn[col] = (res.byColumn[col] || 0) + 1; };

  // users banking fields
  const userRows = await db
    .select({ id: users.id, bankRoutingNumber: users.bankRoutingNumber, bankAccountNumber: users.bankAccountNumber })
    .from(users);
  for (const u of userRows) {
    const update: Partial<Record<(typeof BANKING_USER_COLS)[number], string>> = {};
    for (const col of BANKING_USER_COLS) {
      const v = u[col];
      if (typeof v !== "string" || !v.startsWith("enc:")) continue;
      res.scanned++;
      if (isBankingCiphertextOnCurrentKey(v)) { res.skipped++; continue; }
      try {
        update[col] = reencryptBankingVerified(v);
      } catch (e) {
        res.errors.push({ column: `users.${col}`, id: u.id, error: (e as Error).message });
      }
    }
    if (Object.keys(update).length) {
      await db.update(users).set(update).where(eq(users.id, u.id));
      for (const col of Object.keys(update)) { res.reencrypted++; bump(`users.${col}`); }
    }
  }

  // webhook_endpoints.secret + .old_secret (both banking-key encrypted)
  const whRows = await db
    .select({ id: webhookEndpoints.id, secret: webhookEndpoints.secret, oldSecret: webhookEndpoints.oldSecret })
    .from(webhookEndpoints);
  for (const w of whRows) {
    const update: Partial<Record<(typeof WEBHOOK_COLS)[number], string>> = {};
    for (const col of WEBHOOK_COLS) {
      const v = w[col];
      if (typeof v !== "string" || !v.startsWith("enc:")) continue;
      res.scanned++;
      if (isBankingCiphertextOnCurrentKey(v)) { res.skipped++; continue; }
      try {
        update[col] = reencryptBankingVerified(v);
      } catch (e) {
        res.errors.push({ column: `webhook_endpoints.${WEBHOOK_COL_NAMES[col]}`, id: w.id, error: (e as Error).message });
      }
    }
    if (Object.keys(update).length) {
      await db.update(webhookEndpoints).set(update).where(eq(webhookEndpoints.id, w.id));
      for (const col of Object.keys(update) as (typeof WEBHOOK_COLS)[number][]) { res.reencrypted++; bump(`webhook_endpoints.${WEBHOOK_COL_NAMES[col]}`); }
    }
  }

  // orgs smtp fields
  const orgRows = await db
    .select({ id: orgs.id, smtpPass: orgs.smtpPass, emailOauthRefreshToken: orgs.emailOauthRefreshToken })
    .from(orgs);
  for (const o of orgRows) {
    const update: Partial<Record<(typeof SMTP_ORG_COLS)[number], string>> = {};
    for (const col of SMTP_ORG_COLS) {
      const v = o[col];
      if (typeof v !== "string" || !isSmtpEncrypted(v)) continue;
      res.scanned++;
      if (isSmtpCiphertextOnCurrentKey(v)) { res.skipped++; continue; }
      try {
        update[col] = reencryptSmtpVerified(v);
      } catch (e) {
        res.errors.push({ column: `orgs.${col}`, id: o.id, error: (e as Error).message });
      }
    }
    if (Object.keys(update).length) {
      await db.update(orgs).set(update).where(eq(orgs.id, o.id));
      for (const col of Object.keys(update)) { res.reencrypted++; bump(`orgs.${col}`); }
    }
  }

  return res;
}

export function registerFieldCryptoRoutes(app: Express): void {
  app.get("/api/admin/field-crypto/status", requirePlatformOperator, async (_req: Request, res: Response) => {
    try {
      const stats = await collectStatus();
      res.json({
        ok: true,
        stats,
        totalEncrypted: stats.reduce((a, s) => a + s.encrypted, 0),
        totalPending: stats.reduce((a, s) => a + s.pending, 0),
      });
    } catch (e) {
      console.error("[field-crypto] status failed:", (e as Error).message);
      res.status(500).json({ message: "field-crypto status failed" });
    }
  });

  app.post("/api/admin/field-crypto/reencrypt", requirePlatformOperator, async (req: Request, res: Response) => {
    try {
      const result = await reencryptAll();
      let auditWritten = false;
      try {
        // audit_logs.org_id is NOT NULL with an FK; attribute this operator
        // maintenance action to the operator's own org (a cross-tenant op).
        await storage.createAuditLog({
          orgId: req.session.orgId as string,
          userId: req.session.userId ?? null,
          action: "FIELD_CRYPTO_REENCRYPT",
          entityType: "system",
          entityId: "field-crypto",
          details: {
            scanned: result.scanned,
            reencrypted: result.reencrypted,
            skipped: result.skipped,
            byColumn: result.byColumn,
            errorCount: result.errors.length,
          },
        });
        auditWritten = true;
      } catch (logErr) {
        console.error("[field-crypto] reencrypt audit log failed:", (logErr as Error).message);
      }
      console.log(
        `[field-crypto] reencrypt done — scanned=${result.scanned} reencrypted=${result.reencrypted} skipped=${result.skipped} errors=${result.errors.length} auditWritten=${auditWritten}`,
      );
      // Surface a missing audit trail for this sensitive bank-data mutation
      // rather than silently swallowing it (ok=false flags it to the operator).
      res.json({ ok: result.errors.length === 0 && auditWritten, auditWritten, ...result });
    } catch (e) {
      console.error("[field-crypto] reencrypt failed:", (e as Error).message);
      res.status(500).json({ message: "field-crypto reencrypt failed" });
    }
  });
}
