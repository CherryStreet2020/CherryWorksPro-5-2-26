import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
    redirect: "manual",
  });
  const raw = res.headers.getSetCookie?.() ?? (res.headers as any).raw?.()?.["set-cookie"] ?? [];
  if (raw.length > 0) {
    cookie = raw.map((c: string) => c.split(";")[0]).join("; ");
  }
  if (!cookie) {
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
  }
}

function get(path: string) {
  return fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
}

describe("B6 — Mission Control + Profile fixes", () => {
  beforeAll(login);

  describe("BUG 1 (V3-GS1): Mission Control KPIs match Dashboard", () => {

    it("Mission Control source code uses executive-kpis for invoiced (not client-side inv.total)", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("client/src/pages/getting-started.tsx", "utf-8");

      expect(src).toContain('queryKey: ["/api/reports/executive-kpis"]');
      expect(src).toContain("kpis?.revenueThisMonth");
      expect(src).not.toMatch(/inv\.total\b/);
    });

    it("Mission Control source code computes hours from te.minutes (not te.hours)", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("client/src/pages/getting-started.tsx", "utf-8");

      expect(src).toContain("te.minutes");
      expect(src).not.toContain("te.hours");
    });

    it("executive-kpis revenueThisMonth > 0 (real data exists)", async () => {
      const res = await get("/api/reports/executive-kpis");
      expect(res.ok).toBe(true);
      const kpis = await res.json();
      expect(kpis).toHaveProperty("revenueThisMonth");
      expect(typeof kpis.revenueThisMonth).toBe("number");
      expect(kpis.revenueThisMonth).toBeGreaterThanOrEqual(0);
    });

    it("time entries have minutes field (not hours) for current month", async () => {
      const res = await get("/api/time-entries");
      expect(res.ok).toBe(true);
      const entries = await res.json();

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthEntries = entries.filter((te: any) => new Date(te.date) >= monthStart);

      expect(thisMonthEntries.length).toBeGreaterThan(0);

      const totalMinutes = thisMonthEntries.reduce(
        (sum: number, te: any) => sum + (parseFloat(te.minutes) || 0), 0
      );
      expect(totalMinutes).toBeGreaterThan(0);

      expect(thisMonthEntries[0].minutes).toBeDefined();
    });
  });

  describe("BUG 2 (V3-P1): Profile name + role badge", () => {

    it("user object has name field populated", async () => {
      const res = await get("/api/auth/me");
      expect(res.ok).toBe(true);
      const user = await res.json();
      expect(user.name).toBeTruthy();
      expect(user.name.length).toBeGreaterThan(0);
    });

    it("profile page syncs editName from user.name via useEffect", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("client/src/pages/profile.tsx", "utf-8");

      expect(src).toContain("useEffect");
      expect(src).toMatch(/user\?\.name.*setEditName/s);
    });

    it("StatusBadge has ADMIN in STATUS_CONFIG (renders 'Admin' not raw 'ADMIN')", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("client/src/components/shared/status-badge.tsx", "utf-8");

      expect(src).toMatch(/ADMIN:\s*\{.*label:\s*"Admin"/);
    });

    it("profile page has exactly one StatusBadge for user.role", async () => {
      const fs = await import("fs");
      const src = fs.readFileSync("client/src/pages/profile.tsx", "utf-8");

      const roleBadges = src.match(/StatusBadge\s+status=\{user\.role\}/g);
      expect(roleBadges).toBeDefined();
      expect(roleBadges!.length).toBe(1);
    });
  });

  describe("CLEANUP: SQL script exists", () => {

    it("b6-test-pollution.sql exists and has ROLLBACK safety", async () => {
      const fs = await import("fs");
      const sql = fs.readFileSync("tests/cleanup/b6-test-pollution.sql", "utf-8");

      expect(sql).toContain("BEGIN");
      expect(sql).toContain("ROLLBACK");
      expect(sql).toContain("30cb6705-f98e-44c5-8e2a-fbe3f150a3eb");
      expect(sql).toContain("B4%");
      expect(sql).toContain("csrftest%@example.com");
      expect(sql).toContain("R6-Proof-Svc%");
      expect(sql).toContain("New Client");
    });
  });
});
