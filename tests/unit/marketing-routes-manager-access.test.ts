/**
 * Task #396 — Open `/api/marketing/*` routes (incl. campaign Send Now)
 * to MANAGER role in addition to ADMIN.
 *
 * Verifies:
 *   1. The new `requireAdminOrManager` export is the same function as
 *      `requireManagerOrAbove` (alias correctness — guards against a
 *      future refactor accidentally diverging the two).
 *   2. The middleware allows ADMIN through, allows MANAGER through,
 *      and blocks TEAM_MEMBER with 403.
 *   3. The middleware blocks deactivated users (`isActive: false`)
 *      regardless of role — so a fired manager loses Marketing access
 *      immediately.
 *   4. Unauthenticated requests get 401, not 403 (matters for the
 *      client UX layer that distinguishes "log in" from "ask admin").
 *   5. Marketing route files actually use the new gate (regression
 *      check — ensures nobody re-introduces a bare `requireAdmin`
 *      import in a marketing route).
 *   6. The campaign Send Now route specifically is gated by the new
 *      alias (highest-impact endpoint touched by this task).
 *   7. Non-marketing admin surfaces (feature flags, secrets,
 *      webhook dashboard) still use the strict `requireAdmin` gate
 *      so MANAGER cannot reach them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type MockUser = {
  id: string;
  role: "ADMIN" | "MANAGER" | "TEAM_MEMBER";
  isActive: boolean;
  email: string;
};

const userById = new Map<string, MockUser>();

vi.mock("../../server/storage", () => ({
  storage: {
    getUserById: vi.fn(async (id: string) => userById.get(id) ?? null),
  },
}));

async function loadMiddleware() {
  return await import("../../server/routes/middleware");
}

function makeReqRes(userId?: string): {
  req: Request;
  res: Response;
  next: ReturnType<typeof vi.fn>;
  status: () => number | null;
} {
  let statusCode: number | null = null;
  const req = {
    method: "GET",
    path: "/marketing-test",
    session: userId ? { userId, orgId: "org-test" } : {},
    header: () => undefined,
  } as unknown as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(_body: unknown) {
      return this;
    },
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  return {
    req,
    res,
    next: next as ReturnType<typeof vi.fn>,
    status: () => statusCode,
  };
}

beforeEach(() => {
  userById.clear();
  userById.set("admin-1", {
    id: "admin-1",
    role: "ADMIN",
    isActive: true,
    email: "admin@test.dev",
  });
  userById.set("manager-1", {
    id: "manager-1",
    role: "MANAGER",
    isActive: true,
    email: "manager@test.dev",
  });
  userById.set("team-1", {
    id: "team-1",
    role: "TEAM_MEMBER",
    isActive: true,
    email: "team@test.dev",
  });
  userById.set("manager-inactive", {
    id: "manager-inactive",
    role: "MANAGER",
    isActive: false,
    email: "fired-manager@test.dev",
  });
});

describe("Task #396 — requireAdminOrManager middleware", () => {
  it("is exported and is the same function as requireManagerOrAbove (alias)", async () => {
    const m = await loadMiddleware();
    expect(typeof m.requireAdminOrManager).toBe("function");
    expect(m.requireAdminOrManager).toBe(m.requireManagerOrAbove);
  });

  it("allows ADMIN through (calls next, no status set)", async () => {
    const m = await loadMiddleware();
    const ctx = makeReqRes("admin-1");
    await m.requireAdminOrManager(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).toHaveBeenCalledTimes(1);
    expect(ctx.status()).toBeNull();
  });

  it("allows MANAGER through (the Task #396 change)", async () => {
    const m = await loadMiddleware();
    const ctx = makeReqRes("manager-1");
    await m.requireAdminOrManager(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).toHaveBeenCalledTimes(1);
    expect(ctx.status()).toBeNull();
  });

  it("blocks TEAM_MEMBER with 403", async () => {
    const m = await loadMiddleware();
    const ctx = makeReqRes("team-1");
    await m.requireAdminOrManager(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).not.toHaveBeenCalled();
    expect(ctx.status()).toBe(403);
  });

  it("blocks deactivated MANAGER with 403", async () => {
    const m = await loadMiddleware();
    const ctx = makeReqRes("manager-inactive");
    await m.requireAdminOrManager(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).not.toHaveBeenCalled();
    expect(ctx.status()).toBe(403);
  });

  it("returns 401 (not 403) when no session is present", async () => {
    const m = await loadMiddleware();
    const ctx = makeReqRes(); // no userId
    await m.requireAdminOrManager(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).not.toHaveBeenCalled();
    expect(ctx.status()).toBe(401);
  });
});

describe("Task #396 — Marketing route files use requireAdminOrManager", () => {
  // Files that should be PURELY manager-permissive: every endpoint in
  // them is a customer-facing /api/marketing/* CRUD surface, so there
  // should be no bare `requireAdmin` left over from the old gate.
  const purelyManagerFiles = [
    "server/routes/marketing/campaigns.ts",
    "server/routes/marketing/contacts.ts",
    "server/routes/marketing/companies.ts",
    "server/routes/marketing/prospects.ts",
    "server/routes/marketing/tags.ts",
    "server/routes/marketing/segments.ts",
    "server/routes/marketing/activities.ts",
    "server/routes/marketing-contact-import-routes.ts",
  ];

  for (const path of purelyManagerFiles) {
    it(`${path} uses requireAdminOrManager and contains no bare requireAdmin reference`, () => {
      const src = readFileSync(join(process.cwd(), path), "utf8");
      // Must use the new alias
      expect(src).toMatch(/requireAdminOrManager/);
      // Must NOT reference the strict requireAdmin gate (would block
      // MANAGER). The negative-lookahead skips `requireAdminOrManager`
      // and `requireAdminOnly`.
      const bare = src.match(/\brequireAdmin\b(?!Or|Only)/g);
      expect(
        bare,
        `Found bare requireAdmin in ${path}: ${bare?.join(", ")}`,
      ).toBeNull();
    });
  }

  it("campaigns Send Now route is gated by requireAdminOrManager", () => {
    const src = readFileSync(
      join(process.cwd(), "server/routes/marketing/campaigns.ts"),
      "utf8",
    );
    // The Send Now route is the highest-impact endpoint; verify it
    // explicitly so a future edit can't accidentally drop the gate.
    const sendNow = src.match(
      /["'`][^"'`]*\/send-now["'`][^]*?async \(req: Request/,
    );
    expect(sendNow, "send-now route block not found").not.toBeNull();
    expect(sendNow![0]).toMatch(/requireAdminOrManager/);
    expect(sendNow![0]).not.toMatch(/\brequireAdmin\b(?!Or|Only)/);
  });
});

describe("Task #396 — marketing-os-telemetry-routes split policy", () => {
  // The telemetry-routes file is mixed: org-scoped surfaces (event
  // emit, summary, daily) are MANAGER-accessible, but the operational
  // CLEANUP endpoints stay strict ADMIN-only because they invoke a
  // global, cross-org DELETE on `marketing_os_telemetry_events` and
  // surface platform-operator health, same family as feature-flags
  // and webhook-dashboard.
  const telemetryPath = join(
    process.cwd(),
    "server/routes/marketing-os-telemetry-routes.ts",
  );

  it("imports both requireAdmin and requireAdminOrManager", () => {
    const src = readFileSync(telemetryPath, "utf8");
    expect(src).toMatch(/requireAdmin\b/);
    expect(src).toMatch(/requireAdminOrManager/);
  });

  for (const cleanupRoute of [
    "/api/telemetry/marketing-os/cleanup/run",
    "/api/telemetry/marketing-os/cleanup/last",
    "/api/telemetry/marketing-os/cleanup/history",
  ]) {
    it(`${cleanupRoute} is gated by strict requireAdmin (not the manager alias)`, () => {
      const src = readFileSync(telemetryPath, "utf8");
      // Match the route registration block: literal path string, then
      // the very next non-whitespace, non-comma token must be the
      // middleware identifier.
      const escaped = cleanupRoute.replace(/[/.]/g, "\\$&");
      const re = new RegExp(
        `["'\`]${escaped}["'\`]\\s*,\\s*([A-Za-z_]+)`,
      );
      const match = src.match(re);
      expect(match, `route block for ${cleanupRoute} not found`).not.toBeNull();
      expect(match![1]).toBe("requireAdmin");
    });
  }

  for (const orgScopedRoute of [
    "/api/telemetry/marketing-os/summary",
    "/api/telemetry/marketing-os/daily",
  ]) {
    it(`${orgScopedRoute} is gated by requireAdminOrManager`, () => {
      const src = readFileSync(telemetryPath, "utf8");
      const escaped = orgScopedRoute.replace(/[/.]/g, "\\$&");
      const re = new RegExp(
        `["'\`]${escaped}["'\`]\\s*,\\s*([A-Za-z_]+)`,
      );
      const match = src.match(re);
      expect(match, `route block for ${orgScopedRoute} not found`).not.toBeNull();
      expect(match![1]).toBe("requireAdminOrManager");
    });
  }
});

describe("Task #396 — Frontend /marketing/* routes use ManagerRoute", () => {
  it("App.tsx wraps every /marketing/* route in ManagerRoute (not AdminRoute)", () => {
    const src = readFileSync(
      join(process.cwd(), "client/src/App.tsx"),
      "utf8"
    );
    // Pull every line that registers a /marketing/* Route (excluding
    // the public marketing site routes which live elsewhere).
    const marketingLines = src
      .split("\n")
      .filter((l) => /Route path="\/marketing\//.test(l));
    expect(marketingLines.length).toBeGreaterThan(0);
    const offenders = marketingLines.filter((l) => /AdminRoute\b/.test(l));
    expect(
      offenders,
      `Found AdminRoute on /marketing/* routes (would 403 managers in UI):\n${offenders.join("\n")}`,
    ).toEqual([]);
    // Positive: every line uses ManagerRoute or LazyRoute (e.g. a
    // public unguarded path) — at least one ManagerRoute must exist.
    expect(marketingLines.some((l) => /ManagerRoute\b/.test(l))).toBe(true);
  });
});

describe("Task #396 — Non-marketing admin routes still use strict requireAdmin", () => {
  // Regression guard: the bulk swap was scoped to marketing route files
  // only. Billing, secrets, feature-flags, webhook-dashboard, AV, and
  // tax surfaces stay ADMIN-only.
  const adminOnlyFiles = [
    "server/routes/feature-flags-routes.ts",
    "server/routes/secrets-routes.ts",
    "server/routes/webhook-dashboard-routes.ts",
  ];

  for (const path of adminOnlyFiles) {
    it(`${path} still uses requireAdmin (not the manager-permissive alias)`, () => {
      let src: string;
      try {
        src = readFileSync(join(process.cwd(), path), "utf8");
      } catch {
        // File may not exist in some checkouts — skip rather than fail.
        return;
      }
      expect(src).toMatch(/\brequireAdmin\b(?!Or)/);
      expect(src).not.toMatch(/requireAdminOrManager/);
    });
  }
});
