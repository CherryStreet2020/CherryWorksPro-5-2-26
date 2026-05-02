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
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length > 0) {
    cookie = raw.map(c => c.split(";")[0]).join("; ");
  } else {
    const sc = res.headers.get("set-cookie") || "";
    cookie = sc.split(";")[0];
  }
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

describe("H2: AR No Plug — zero AR_RECONCILE_REPAIR JEs and canonical matches GL 1200", () => {
  beforeAll(async () => {
    await login();
    expect(cookie.length).toBeGreaterThan(0);
  });

  it("no journal entries exist with source AR_RECONCILE_REPAIR or AR_AUTO_RECONCILE", async () => {
    const jes = await get("/api/gl/journal-entries?limit=500");
    const repairs = jes.filter((j: any) =>
      j.sourceType === "AR_RECONCILE_REPAIR" || j.sourceType === "AR_AUTO_RECONCILE"
    );
    expect(repairs.length).toBe(0);
  });

  it("canonical AR matches GL 1200 balance with zero diff", async () => {
    const reconcile = await get("/api/gl/reconcile");
    expect(reconcile.diff).toBe("0.00");
  });

  it("canonical AR equals GL 1200 balance numerically", async () => {
    const arRes = await get("/api/ar/outstanding");
    const reconcile = await get("/api/gl/reconcile");
    expect(arRes.outstandingAR).toBe(parseFloat(reconcile.gl_1200_balance));
  });
});
