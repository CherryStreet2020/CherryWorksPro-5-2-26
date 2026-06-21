/**
 * Security regression (audit #4): the /api/admin/secrets routes mutate
 * process-global env (process.env[STRIPE_SECRET_KEY] etc.) which is shared by
 * EVERY tenant in the single-process server. They were gated by requireAdmin —
 * a per-tenant role — so any customer org's ADMIN could rotate the platform-wide
 * Stripe/SMTP secret. The fix gates them with requirePlatformOperator instead.
 *
 * In-process Express + mocked operator allow-list, mirroring
 * tests/integration/field-crypto-reencrypt-route.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const ADMIN_USER_ID = "user-admin-secrets";
const OPERATOR_USER_ID = "user-operator-secrets";
const ADMIN_EMAIL = "admin-secrets@example.com";
const OPERATOR_EMAIL = "operator-secrets@example.com";
let currentUserId: string = ADMIN_USER_ID;

const userRecords: Record<string, { id: string; email: string; isActive: boolean; role: string }> = {
  [ADMIN_USER_ID]: { id: ADMIN_USER_ID, email: ADMIN_EMAIL, isActive: true, role: "ADMIN" },
  [OPERATOR_USER_ID]: { id: OPERATOR_USER_ID, email: OPERATOR_EMAIL, isActive: true, role: "ADMIN" },
};

vi.mock("../../server/storage", async () => {
  const actual = await vi.importActual<typeof import("../../server/storage")>("../../server/storage");
  (actual.storage as unknown as { getUserById: unknown }).getUserById = vi.fn(async (id: string) => userRecords[id]);
  return actual;
});

import { registerSecretsRoutes } from "../../server/routes/secrets-routes";

const SESSION_ORG_ID = randomUUID();
const ORIGINAL_OPERATOR_EMAILS = process.env.PLATFORM_OPERATOR_EMAILS;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: currentUserId, orgId: SESSION_ORG_ID };
    next();
  });
  registerSecretsRoutes(app);
  return app;
}

async function request(
  app: Express,
  init: { method: "GET" | "POST"; path: string; body?: any },
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${init.path}`, {
          method: init.method,
          headers: init.body ? { "Content-Type": "application/json" } : undefined,
          body: init.body ? JSON.stringify(init.body) : undefined,
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
        server.close(() => resolve({ status: res.status, body }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

beforeAll(() => {
  process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
});
afterAll(() => {
  if (ORIGINAL_OPERATOR_EMAILS === undefined) delete process.env.PLATFORM_OPERATOR_EMAILS;
  else process.env.PLATFORM_OPERATOR_EMAILS = ORIGINAL_OPERATOR_EMAILS;
});

describe("secrets routes require platform operator, not tenant admin (audit #4)", () => {
  it("a tenant ADMIN (not on the operator allow-list) gets 404 on every secrets endpoint and mutates no env", async () => {
    currentUserId = ADMIN_USER_ID;
    const app = buildApp();
    const sentinelBefore = process.env.STRIPE_SECRET_KEY;

    expect((await request(app, { method: "GET", path: "/api/admin/secrets" })).status).toBe(404);
    expect(
      (await request(app, {
        method: "POST",
        path: "/api/admin/secrets/rotate",
        body: { envVar: "STRIPE_SECRET_KEY", newValue: "sk_live_attacker_should_never_land" },
      })).status,
    ).toBe(404);
    expect((await request(app, { method: "GET", path: "/api/admin/secrets/alerts" })).status).toBe(404);
    expect(
      (await request(app, {
        method: "POST",
        path: "/api/admin/secrets/mark-rotated",
        body: { envVar: "STRIPE_SECRET_KEY" },
      })).status,
    ).toBe(404);

    // The 404 fires in the gate, before the handler — the global secret is untouched.
    expect(process.env.STRIPE_SECRET_KEY).toBe(sentinelBefore);
  });

  it("a platform operator can reach the secrets listing", async () => {
    currentUserId = OPERATOR_USER_ID;
    const app = buildApp();
    const res = await request(app, { method: "GET", path: "/api/admin/secrets" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.secrets)).toBe(true);
  });
});
