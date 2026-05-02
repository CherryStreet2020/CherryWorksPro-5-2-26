/**
 * Task #306 — Route test for the operator-only marketing retry-policies
 * endpoint. Mounts `registerMarketingRetryPoliciesRoutes` on a fresh
 * Express app with a stubbed session + storage + pool so we can assert
 * the gating contract (404 when not an operator) and the response
 * envelope independently of the live database.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http, { type Server } from "http";
import { AddressInfo } from "net";

const getUserById = vi.fn(async (_id: string) => ({
  id: "user-1",
  email: "ops@example.com",
  isActive: true,
  role: "ADMIN",
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getUserById: (...a: any[]) => getUserById(...(a as [string])),
  },
}));

const poolQuery = vi.fn();
vi.mock("../../server/db", () => ({
  pool: { query: (...a: any[]) => poolQuery(...a) },
  db: {},
}));

// Pin module-level defaults so the route's WHERE clause is deterministic
// across the suite. The constants are read once at import time, so we
// set the env vars before importing.
process.env.MARKETING_SEND_MAX_ATTEMPTS = "5";
process.env.MARKETING_SEND_RETRY_BASE_MS = String(5 * 60 * 1000);

import { registerMarketingRetryPoliciesRoutes } from "../../server/routes/marketing-retry-policies-routes";

let server: Server;
let baseUrl: string;
let sessionUserId: string | undefined = "user-1";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: sessionUserId,
      orgId: "org-1",
      destroy: (cb: () => void) => cb(),
    };
    next();
  });
  registerMarketingRetryPoliciesRoutes(app);
  return app;
}

beforeEach(async () => {
  poolQuery.mockReset();
  getUserById.mockReset();
  getUserById.mockImplementation(async (_id: string) => ({
    id: "user-1",
    email: "ops@example.com",
    isActive: true,
    role: "ADMIN",
  }));
  sessionUserId = "user-1";
  delete process.env.PLATFORM_OPERATOR_EMAILS;
  if (server) await new Promise<void>((r) => server.close(() => r()));
  const app = buildApp();
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("Task #306 — GET /api/admin/marketing/retry-policies", () => {
  it("404s when PLATFORM_OPERATOR_EMAILS is unset", async () => {
    const r = await fetch(`${baseUrl}/api/admin/marketing/retry-policies`);
    expect(r.status).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("404s for a tenant ADMIN whose email is not in the allow-list", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "someone-else@example.com";
    try {
      const r = await fetch(`${baseUrl}/api/admin/marketing/retry-policies`);
      expect(r.status).toBe(404);
      expect(poolQuery).not.toHaveBeenCalled();
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });

  it("returns the empty list with platform defaults when every org is on defaults", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "ops@example.com";
    poolQuery.mockResolvedValueOnce({ rows: [] });
    try {
      const r = await fetch(`${baseUrl}/api/admin/marketing/retry-policies`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toEqual({
        defaults: { maxAttempts: 5, retryBaseMs: 5 * 60 * 1000 },
        orgs: [],
      });
      // Query is parameterized against the live defaults so an env shift
      // re-baselines the list automatically.
      expect(poolQuery).toHaveBeenCalledTimes(1);
      const args = poolQuery.mock.calls[0];
      expect(args[1]).toEqual([5, 5 * 60 * 1000]);
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });

  it("returns deviating orgs with deltas vs. the platform defaults", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "OPS@Example.com";
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "org-aggressive",
          name: "Aggressive Co",
          marketing_send_max_attempts: 20,
          marketing_send_retry_base_ms: 60_000,
        },
        {
          id: "org-cautious",
          name: "Cautious LLC",
          marketing_send_max_attempts: 2,
          marketing_send_retry_base_ms: 30 * 60 * 1000,
        },
      ],
    });
    try {
      const r = await fetch(`${baseUrl}/api/admin/marketing/retry-policies`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.defaults).toEqual({ maxAttempts: 5, retryBaseMs: 5 * 60 * 1000 });
      expect(body.orgs).toHaveLength(2);
      expect(body.orgs[0]).toEqual({
        orgId: "org-aggressive",
        orgName: "Aggressive Co",
        maxAttempts: 20,
        retryBaseMs: 60_000,
        attemptsDelta: 15,
        retryBaseMsDelta: 60_000 - 5 * 60 * 1000,
      });
      expect(body.orgs[1]).toEqual({
        orgId: "org-cautious",
        orgName: "Cautious LLC",
        maxAttempts: 2,
        retryBaseMs: 30 * 60 * 1000,
        attemptsDelta: -3,
        retryBaseMsDelta: 30 * 60 * 1000 - 5 * 60 * 1000,
      });
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });

  it("500s with a sanitized message when the DB query fails", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "ops@example.com";
    poolQuery.mockRejectedValueOnce(new Error("connection refused"));
    try {
      const r = await fetch(`${baseUrl}/api/admin/marketing/retry-policies`);
      expect(r.status).toBe(500);
      const body = await r.json();
      expect(typeof body.message).toBe("string");
    } finally {
      delete process.env.PLATFORM_OPERATOR_EMAILS;
    }
  });
});
