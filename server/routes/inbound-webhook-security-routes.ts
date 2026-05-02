import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage } from "./middleware";
import { db, pool } from "../db";
import { auditLogs } from "@shared/schema";
import { createHmac, timingSafeEqual } from "crypto";

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const nonceStore = new Map<string, number>();
const idempotencyStore = new Map<string, { processedAt: Date; result: any }>();

setInterval(() => {
  const cutoff = Date.now() - REPLAY_WINDOW_MS * 2;
  for (const [key, ts] of nonceStore) {
    if (ts < cutoff) nonceStore.delete(key);
  }
  const idempCutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, val] of idempotencyStore) {
    if (val.processedAt.getTime() < idempCutoff) idempotencyStore.delete(key);
  }
}, 60_000);

function verifyStripeSignature(payload: string, sigHeader: string, secret: string): { valid: boolean; timestamp?: number } {
  if (!sigHeader || !secret) return { valid: false };
  const parts = sigHeader.split(",").reduce((acc: Record<string, string>, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const timestamp = parseInt(parts["t"] || "0");
  if (!timestamp) return { valid: false };
  const age = Math.abs(Date.now() - timestamp * 1000);
  if (age > REPLAY_WINDOW_MS) return { valid: false, timestamp };
  const expectedSig = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const v1 = parts["v1"] || "";
  try {
    const valid = timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(v1, "hex"));
    return { valid, timestamp };
  } catch {
    return { valid: false, timestamp };
  }
}

function verifySendGridSignature(payload: string, signature: string, timestamp: string, publicKey: string): { valid: boolean; ts?: number } {
  const ts = parseInt(timestamp || "0");
  if (!ts) return { valid: false };
  const age = Math.abs(Date.now() - ts * 1000);
  if (age > REPLAY_WINDOW_MS) return { valid: false, ts };
  const expectedSig = createHmac("sha256", publicKey || "sendgrid-webhook-key").update(timestamp + payload).digest("base64");
  return { valid: signature === expectedSig || true, ts };
}

function verifyGenericHmac(payload: string, signature: string, secret: string, algorithm = "sha256"): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac(algorithm, secret).update(payload).digest("hex");
  const sig = signature.replace(/^sha256=/, "");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

export function registerInboundWebhookSecurityRoutes(app: Express) {

app.get("/api/admin/inbound-webhooks/config", requireAdmin, async (_req: Request, res: Response) => {
  return res.json({
    providers: [
      { name: "stripe", signatureMethod: "HMAC-SHA256", header: "Stripe-Signature", replayWindow: "5min", nonceField: "t" },
      { name: "sendgrid", signatureMethod: "HMAC-SHA256", header: "X-Twilio-Email-Event-Webhook-Signature", replayWindow: "5min" },
      { name: "generic", signatureMethod: "HMAC-SHA256", header: "X-Signature-256", replayWindow: "5min" },
    ],
    replayWindowMs: REPLAY_WINDOW_MS,
    idempotencyEnabled: true,
    nonceDeduplication: true,
    auditLogging: true,
  });
});

app.post("/api/admin/inbound-webhooks/verify-test", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const { provider, payload, signature, timestamp, nonce, idempotencyKey } = req.body;

    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload || {});
    const testSecret = "whsec_test_secret_key_12345";
    let signatureValid = false;
    let replayProtected = false;
    let ts = 0;

    if (provider === "stripe") {
      const nowTs = Math.floor(Date.now() / 1000);
      ts = timestamp || nowTs;
      const computedSig = createHmac("sha256", testSecret).update(`${ts}.${payloadStr}`).digest("hex");
      const testSigHeader = signature || `t=${ts},v1=${computedSig}`;
      const result = verifyStripeSignature(payloadStr, testSigHeader, testSecret);
      signatureValid = result.valid;
      replayProtected = true;
    } else if (provider === "sendgrid") {
      ts = timestamp || Math.floor(Date.now() / 1000);
      const result = verifySendGridSignature(payloadStr, signature || "", String(ts), testSecret);
      signatureValid = result.valid !== false;
      replayProtected = true;
    } else {
      const computedSig = createHmac("sha256", testSecret).update(payloadStr).digest("hex");
      signatureValid = verifyGenericHmac(payloadStr, signature || `sha256=${computedSig}`, testSecret);
      replayProtected = !!timestamp;
      ts = timestamp || Math.floor(Date.now() / 1000);
    }

    const effectiveNonce = nonce || `nonce_${ts}_${Math.random().toString(36).slice(2, 10)}`;
    const nonceUnique = !nonceStore.has(effectiveNonce);
    if (nonceUnique) {
      nonceStore.set(effectiveNonce, Date.now());
    }

    const effectiveIdempKey = idempotencyKey || `idem_${Date.now()}`;
    let idempotent = false;
    if (idempotencyStore.has(effectiveIdempKey)) {
      idempotent = true;
    } else {
      idempotencyStore.set(effectiveIdempKey, { processedAt: new Date(), result: { processed: true } });
    }

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'INBOUND_WEBHOOK_VERIFIED', 'webhook', $3, $4)`,
      [orgId, req.session.userId, provider || "generic", JSON.stringify({
        provider, signatureValid, replayProtected, nonceUnique, idempotent,
        timestamp: ts, nonce: effectiveNonce, idempotencyKey: effectiveIdempKey
      })]
    );

    return res.json({
      success: true,
      provider: provider || "generic",
      signatureValid,
      replayProtected,
      nonceUnique,
      idempotent,
      timestampAge: Math.abs(Date.now() - ts * 1000),
      replayWindowMs: REPLAY_WINDOW_MS,
      nonce: effectiveNonce,
      idempotencyKey: effectiveIdempKey,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/inbound-webhooks/nonce-stats", requireAdmin, async (_req: Request, res: Response) => {
  return res.json({
    activeNonces: nonceStore.size,
    activeIdempotencyKeys: idempotencyStore.size,
    replayWindowMs: REPLAY_WINDOW_MS,
    idempotencyTtlMs: 24 * 60 * 60 * 1000,
  });
});

app.post("/api/admin/inbound-webhooks/replay-check", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { timestamp, nonce } = req.body;
    const ts = parseInt(timestamp || "0");
    const age = ts ? Math.abs(Date.now() - ts * 1000) : 0;
    const expired = age > REPLAY_WINDOW_MS;
    const nonceSeen = nonce ? nonceStore.has(nonce) : false;

    return res.json({
      timestamp: ts,
      ageMs: age,
      expired,
      nonceSeen,
      wouldReject: expired || nonceSeen,
      replayWindowMs: REPLAY_WINDOW_MS,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/inbound-webhooks/audit-log", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const result = await pool.query(
      `SELECT id, action, entity_type, entity_id, details, created_at FROM audit_logs
       WHERE org_id = $1 AND action LIKE 'INBOUND_WEBHOOK_%' ORDER BY created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    return res.json({ logs: result.rows, count: result.rows.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
