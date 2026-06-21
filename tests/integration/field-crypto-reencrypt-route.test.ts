/**
 * Route-level test for the operator-gated field-crypto rotation endpoints
 * (`GET /api/admin/field-crypto/status`, `POST /api/admin/field-crypto/reencrypt`).
 *
 * Crypto correctness of the leaf helpers is covered by
 * tests/unit/field-crypto-rotation.test.ts. This exercises the HTTP + DB flow:
 *   1. A tenant ADMIN (not in the operator allow-list) gets 404 on both verbs
 *      and no data is mutated (requirePlatformOperator hides existence).
 *   2. A platform operator can see old-key rows as pending, re-encrypt them
 *      (including webhook_endpoints.old_secret and the org OAuth token), and
 *      then see them on the current key — with plaintext preserved.
 *   3. Re-running is idempotent (already-current rows untouched).
 *   4. The re-encryption writes a durable FIELD_CRYPTO_REENCRYPT audit row.
 *
 * Mirrors the in-process Express + real DB pattern of
 * tests/integration/email-alert-pinned-orgs-route.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const ADMIN_USER_ID = "user-admin-fieldcrypto";
const OPERATOR_USER_ID = "user-operator-fieldcrypto";
const ADMIN_EMAIL = "admin-fieldcrypto@example.com";
const OPERATOR_EMAIL = "operator-fieldcrypto@example.com";
let currentUserId: string = ADMIN_USER_ID;

const userRecords: Record<string, { id: string; email: string; isActive: boolean; role: string }> = {
  [ADMIN_USER_ID]: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, isActive: true, role: "ADMIN" },
  [OPERATOR_USER_ID]: { id: OPERATOR_USER_ID, email: OPERATOR_EMAIL, isActive: true, role: "ADMIN" },
};

vi.mock("../../server/storage", async () => {
  const actual = await vi.importActual<typeof import("../../server/storage")>("../../server/storage");
  // Override only getUserById (used by requirePlatformOperator) ON the real
  // storage singleton, preserving its prototype methods (createAuditLog, etc.).
  // A `{ ...actual.storage }` spread would drop those prototype methods.
  (actual.storage as unknown as { getUserById: unknown }).getUserById = vi.fn(async (id: string) => userRecords[id]);
  return actual;
});

import { db } from "../../server/db";
import { orgs, webhookEndpoints, auditLogs } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { registerFieldCryptoRoutes } from "../../server/routes/field-crypto-routes";
import { decryptField, isBankingCiphertextOnCurrentKey } from "../../server/storage";
import { decryptSmtpPassword, isSmtpCiphertextOnCurrentKey } from "../../server/email";

// A distinct "previous" key — the role the OLD key plays during the rotation.
const OLD_KEY = "f".repeat(64);

function bankingEncryptUnder(secret: string, plaintext: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:v2:" + salt.toString("hex") + ":" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}
function smtpEncryptUnder(secret: string, plaintext: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt.toString("hex"), 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v2:" + salt.toString("hex") + ":" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

const SESSION_ORG_ID = randomUUID(); // operator's own org (audit attribution)
const DATA_ORG_ID = randomUUID();    // org carrying an old-key OAuth token
const WEBHOOK_ID = randomUUID();
const ORIGINAL_OPERATOR_EMAILS = process.env.PLATFORM_OPERATOR_EMAILS;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: currentUserId, orgId: SESSION_ORG_ID };
    next();
  });
  registerFieldCryptoRoutes(app);
  return app;
}

async function request(app: Express, init: { method: "GET" | "POST"; path: string }): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${init.path}`, { method: init.method });
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
        server.close(() => resolve({ status: res.status, body }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

beforeAll(async () => {
  process.env.BANKING_ENCRYPTION_KEY_OLD = OLD_KEY;
  process.env.SMTP_ENCRYPTION_KEY_OLD = OLD_KEY;
  await db.insert(orgs).values([
    { id: SESSION_ORG_ID, name: "FieldCrypto Session Org", slug: `fc-session-${SESSION_ORG_ID.slice(0, 8)}` },
    {
      id: DATA_ORG_ID,
      name: "FieldCrypto Data Org",
      slug: `fc-data-${DATA_ORG_ID.slice(0, 8)}`,
      emailProviderType: "m365",
      emailOauthRefreshToken: smtpEncryptUnder(OLD_KEY, "refresh-token-plain"),
    },
  ]);
  await db.insert(webhookEndpoints).values({
    id: WEBHOOK_ID,
    orgId: DATA_ORG_ID,
    url: "https://example.com/hook",
    secret: bankingEncryptUnder(OLD_KEY, "wh-secret-plain"),
    oldSecret: bankingEncryptUnder(OLD_KEY, "wh-old-secret-plain"),
  });
});

afterAll(async () => {
  await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, WEBHOOK_ID));
  // Leave orgs (append-only audit_logs FK pins SESSION_ORG_ID); fresh UUIDs avoid collisions.
  if (ORIGINAL_OPERATOR_EMAILS === undefined) delete process.env.PLATFORM_OPERATOR_EMAILS;
  else process.env.PLATFORM_OPERATOR_EMAILS = ORIGINAL_OPERATOR_EMAILS;
  delete process.env.BANKING_ENCRYPTION_KEY_OLD;
  delete process.env.SMTP_ENCRYPTION_KEY_OLD;
});

describe("field-crypto rotation endpoints — gating + re-encryption", () => {
  it("404s both verbs for a non-operator ADMIN and mutates nothing", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
    currentUserId = ADMIN_USER_ID;
    const app = buildApp();

    expect((await request(app, { method: "GET", path: "/api/admin/field-crypto/status" })).status).toBe(404);
    expect((await request(app, { method: "POST", path: "/api/admin/field-crypto/reencrypt" })).status).toBe(404);

    // Seeded webhook secret is still under the OLD key — gating short-circuited before any write.
    const [wh] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, WEBHOOK_ID));
    expect(isBankingCiphertextOnCurrentKey(wh.secret)).toBe(false);
  });

  it("operator: re-encrypts old-key values onto the current key, preserving plaintext, idempotently, with audit", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
    currentUserId = OPERATOR_USER_ID;
    const app = buildApp();

    // status reports our seeded old-key rows as pending.
    const status = await request(app, { method: "GET", path: "/api/admin/field-crypto/status" });
    expect(status.status).toBe(200);
    expect(status.body.totalPending).toBeGreaterThanOrEqual(3); // wh.secret + wh.old_secret + org oauth token

    // reencrypt.
    const re = await request(app, { method: "POST", path: "/api/admin/field-crypto/reencrypt" });
    expect(re.status).toBe(200);
    expect(re.body.ok).toBe(true);
    expect(re.body.auditWritten).toBe(true);
    expect(re.body.errors).toHaveLength(0);
    expect(re.body.reencrypted).toBeGreaterThanOrEqual(3);

    // Our specific rows are now on the current key, plaintext preserved.
    const [wh] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, WEBHOOK_ID));
    expect(isBankingCiphertextOnCurrentKey(wh.secret)).toBe(true);
    expect(isBankingCiphertextOnCurrentKey(wh.oldSecret)).toBe(true);
    expect(decryptField(wh.secret)).toBe("wh-secret-plain");
    expect(decryptField(wh.oldSecret as string)).toBe("wh-old-secret-plain");

    const [org] = await db.select().from(orgs).where(eq(orgs.id, DATA_ORG_ID));
    expect(isSmtpCiphertextOnCurrentKey(org.emailOauthRefreshToken)).toBe(true);
    expect(decryptSmtpPassword(org.emailOauthRefreshToken as string)).toBe("refresh-token-plain");

    // A durable audit row was written under the operator's org.
    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "FIELD_CRYPTO_REENCRYPT"), eq(auditLogs.orgId, SESSION_ORG_ID)));
    expect(audits.length).toBeGreaterThanOrEqual(1);

    // Idempotent: a second run leaves our now-current rows untouched and intact.
    const re2 = await request(app, { method: "POST", path: "/api/admin/field-crypto/reencrypt" });
    expect(re2.status).toBe(200);
    const [wh2] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, WEBHOOK_ID));
    expect(decryptField(wh2.secret)).toBe("wh-secret-plain");
    expect(isBankingCiphertextOnCurrentKey(wh2.secret)).toBe(true);
  });
});
