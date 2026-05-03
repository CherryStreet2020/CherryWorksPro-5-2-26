import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { auditLogs } from "@shared/schema";
import { trackSession } from "./session-routes";
import { randomBytes, createHash, createHmac } from "crypto";

function generateTOTPSecret(): string {
  const buffer = randomBytes(20);
  return base32Encode(buffer);
}

function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let result = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substring(i, i + 5).padEnd(5, "0");
    result += alphabet[parseInt(chunk, 2)];
  }
  return result;
}

function generateTOTP(secret: string, timeStep = 30): string {
  const time = Math.floor(Date.now() / 1000 / timeStep);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(time, 4);

  const secretBuffer = base32Decode(secret);
  const hmac = createHmac("sha1", secretBuffer).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 |
    (hmac[offset + 1] & 0xff) << 16 |
    (hmac[offset + 2] & 0xff) << 8 |
    (hmac[offset + 3] & 0xff)) % 1000000;
  return code.toString().padStart(6, "0");
}

function base32Decode(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of encoded.toUpperCase()) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(5).toString("hex").toUpperCase();
    codes.push(`${code.substring(0, 5)}-${code.substring(5)}`);
  }
  return codes;
}

interface MfaRow {
  user_id: string;
  org_id: string;
  secret: string;
  method: string;
  enabled: boolean;
  recovery_codes: string[];
  used_recovery_codes: string[];
  webauthn_credentials: any[];
  enforce_for_admins: boolean;
  enrolled_at: Date;
  last_verified_at: Date | null;
}

export async function getMfa(userId: string): Promise<MfaRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM mfa_enrollments WHERE user_id = $1`, [userId]
  );
  return rows[0] || null;
}

export async function isOrgMfaEnforcedForAdmins(orgId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM mfa_enrollments WHERE org_id = $1 AND enforce_for_admins = true LIMIT 1`, [orgId]
  );
  return rows.length > 0;
}

async function upsertMfa(userId: string, orgId: string, data: Partial<MfaRow>): Promise<void> {
  const existing = await getMfa(userId);
  if (existing) {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (data.secret !== undefined) { sets.push(`secret = $${idx}`); params.push(data.secret); idx++; }
    if (data.enabled !== undefined) { sets.push(`enabled = $${idx}`); params.push(data.enabled); idx++; }
    if (data.recovery_codes !== undefined) { sets.push(`recovery_codes = $${idx}`); params.push(JSON.stringify(data.recovery_codes)); idx++; }
    if (data.used_recovery_codes !== undefined) { sets.push(`used_recovery_codes = $${idx}`); params.push(JSON.stringify(data.used_recovery_codes)); idx++; }
    if (data.webauthn_credentials !== undefined) { sets.push(`webauthn_credentials = $${idx}`); params.push(JSON.stringify(data.webauthn_credentials)); idx++; }
    if (data.enforce_for_admins !== undefined) { sets.push(`enforce_for_admins = $${idx}`); params.push(data.enforce_for_admins); idx++; }
    if (data.last_verified_at !== undefined) { sets.push(`last_verified_at = $${idx}`); params.push(data.last_verified_at); idx++; }
    if (sets.length > 0) {
      params.push(userId);
      await pool.query(`UPDATE mfa_enrollments SET ${sets.join(", ")} WHERE user_id = $${idx}`, params);
    }
  } else {
    await pool.query(
      `INSERT INTO mfa_enrollments (user_id, org_id, secret, method, enabled, recovery_codes, used_recovery_codes, webauthn_credentials, enforce_for_admins)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, orgId, data.secret || "", data.method || "totp", data.enabled || false,
       JSON.stringify(data.recovery_codes || []), JSON.stringify(data.used_recovery_codes || []),
       JSON.stringify(data.webauthn_credentials || []), data.enforce_for_admins || false]
    );
  }
}

export function registerMfaRoutes(app: Express) {

app.get("/api/mfa/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const mfa = await getMfa(userId);

    return res.json({
      enabled: mfa?.enabled || false,
      totp: mfa?.enabled || false,
      webauthn: (mfa?.webauthn_credentials?.length || 0) > 0,
      webauthnCredentialCount: mfa?.webauthn_credentials?.length || 0,
      recoveryCodesRemaining: mfa ? (mfa.recovery_codes.length - mfa.used_recovery_codes.length) : 0,
      enforceForAdmins: mfa?.enforce_for_admins || false,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/mfa/totp/setup", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;

    const secret = generateTOTPSecret();
    const recoveryCodes = generateRecoveryCodes();

    const userResult = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    const email = userResult.rows[0]?.email || "user@example.com";

    const existing = await getMfa(userId);
    await upsertMfa(userId, orgId, {
      secret,
      enabled: false,
      recovery_codes: recoveryCodes,
      used_recovery_codes: [],
      webauthn_credentials: existing?.webauthn_credentials || [],
      enforce_for_admins: existing?.enforce_for_admins || false,
    });

    const otpauthUrl = `otpauth://totp/CherryWorksPro:${email}?secret=${secret}&issuer=CherryWorksPro&algorithm=SHA1&digits=6&period=30`;

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'MFA_TOTP_SETUP_INITIATED', 'user', $2, $3)`,
      [orgId, userId, JSON.stringify({ method: "totp" })]
    );

    return res.json({
      success: true,
      secret,
      otpauthUrl,
      recoveryCodes,
      qrCodeData: otpauthUrl,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/mfa/totp/verify", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const { code } = req.body;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ message: "code is required" });
    }

    const mfa = await getMfa(userId);
    if (!mfa) {
      return res.status(400).json({ message: "MFA not set up. Call /api/mfa/totp/setup first." });
    }

    const expected = generateTOTP(mfa.secret);
    const prevStep = generateTOTP(mfa.secret, 30);

    const devBypassSetup = process.env.NODE_ENV !== "production" && code === "000000";
    if (code === expected || code === prevStep || devBypassSetup) {
      await upsertMfa(userId, orgId, { enabled: true, last_verified_at: new Date() });

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, 'MFA_TOTP_ENABLED', 'user', $2, $3)`,
        [orgId, userId, JSON.stringify({ method: "totp" })]
      );

      // Setup completes the second factor for a "setup"-branch login;
      // clear the pending flag so /api/auth/me and protected routes work.
      if (req.session.mfaPending && req.session.mfaPendingReason === "setup") {
        req.session.mfaPending = false;
        req.session.mfaPendingReason = undefined;
      }

      return res.json({ success: true, enabled: true, message: "TOTP MFA enabled" });
    }

    return res.status(400).json({ success: false, message: "Invalid TOTP code" });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/mfa/totp/validate", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { code } = req.body;

    const mfa = await getMfa(userId);
    if (!mfa || !mfa.enabled) {
      return res.json({ valid: true, mfaRequired: false });
    }

    const expected = generateTOTP(mfa.secret);
    // The "000000" dev-bypass MUST be gated by a non-production env. Leaving
    // it open in prod would be a permanent MFA backdoor.
    const devBypass = process.env.NODE_ENV !== "production" && code === "000000";
    if (code === expected || devBypass) {
      await upsertMfa(userId, req.session.orgId!, { last_verified_at: new Date() });
      // Clear the pending flag so requireAuth/auth/me will accept this session.
      req.session.mfaPending = false;
      req.session.mfaPendingReason = undefined;
      trackSession(req).catch(() => {});
      return res.json({ valid: true, mfaRequired: true, verified: true });
    }

    const recoveryIdx = mfa.recovery_codes.indexOf(code);
    if (recoveryIdx !== -1 && !mfa.used_recovery_codes.includes(code)) {
      const usedCodes = [...mfa.used_recovery_codes, code];
      await upsertMfa(userId, req.session.orgId!, { used_recovery_codes: usedCodes });

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
         VALUES (gen_random_uuid(), $1, $2, 'MFA_RECOVERY_CODE_USED', 'user', $2, $3)`,
        [req.session.orgId, userId, JSON.stringify({ codesRemaining: mfa.recovery_codes.length - usedCodes.length })]
      );

      req.session.mfaPending = false;
      req.session.mfaPendingReason = undefined;
      trackSession(req).catch(() => {});
      return res.json({ valid: true, recoveryCodeUsed: true, codesRemaining: mfa.recovery_codes.length - usedCodes.length });
    }

    return res.status(401).json({ valid: false, message: "Invalid code" });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/mfa/webauthn/register", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const { credentialId, publicKey, name } = req.body;

    const existing = await getMfa(userId);

    const credential = {
      id: credentialId || randomBytes(16).toString("hex"),
      publicKey: publicKey || randomBytes(32).toString("hex"),
      name: name || "Security Key",
      registeredAt: new Date().toISOString(),
    };

    const creds = [...(existing?.webauthn_credentials || []), credential];
    await upsertMfa(userId, orgId, {
      secret: existing?.secret || "",
      webauthn_credentials: creds,
    });

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'MFA_WEBAUTHN_REGISTERED', 'user', $2, $3)`,
      [orgId, userId, JSON.stringify({ credentialName: credential.name })]
    );

    return res.json({
      success: true,
      credential: { id: credential.id, name: credential.name, registeredAt: credential.registeredAt },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/mfa/webauthn/credentials", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const mfa = await getMfa(userId);
    const creds = (mfa?.webauthn_credentials || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      registeredAt: c.registeredAt,
    }));
    return res.json({ credentials: creds, count: creds.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/mfa/recovery-codes/regenerate", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const mfa = await getMfa(userId);
    if (!mfa) {
      return res.status(400).json({ message: "MFA not set up" });
    }

    const newCodes = generateRecoveryCodes();
    await upsertMfa(userId, orgId, { recovery_codes: newCodes, used_recovery_codes: [] });

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'MFA_RECOVERY_CODES_REGENERATED', 'user', $2, $3)`,
      [orgId, userId, JSON.stringify({ codeCount: newCodes.length })]
    );

    return res.json({ success: true, recoveryCodes: newCodes, count: newCodes.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/mfa/enforce-admins", requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!(await requirePlanTier(req, res, ["ENTERPRISE"], "MFA Enforcement Org-Wide"))) return;
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const { enforce } = req.body;

    await upsertMfa(userId, orgId, { enforce_for_admins: !!enforce });

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'MFA_ENFORCE_ADMINS_TOGGLED', 'org', $1, $3)`,
      [orgId, userId, JSON.stringify({ enforce: !!enforce })]
    );

    return res.json({ success: true, enforceForAdmins: !!enforce });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/mfa/disable", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;
    const mfa = await getMfa(userId);
    if (!mfa) {
      return res.json({ success: true, message: "MFA was not enabled" });
    }

    await upsertMfa(userId, orgId, { enabled: false, webauthn_credentials: [] });

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'MFA_DISABLED', 'user', $2, $3)`,
      [orgId, userId, JSON.stringify({ method: "all" })]
    );

    return res.json({ success: true, message: "MFA disabled" });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
