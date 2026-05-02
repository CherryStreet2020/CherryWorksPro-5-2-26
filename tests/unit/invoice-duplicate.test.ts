import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let cookie = "";
let csrfToken = "";

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin.test@cwpro.dev",
      password: "admin123",
    }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map(c => c.split(";")[0]).join("; ");
  csrfToken = res.headers.get("x-csrf-token") || "";
  return res;
}

function authHeaders(extra: Record<string, string> = {}) {
  return { Cookie: cookie, "X-CSRF-Token": csrfToken, ...extra };
}

async function authFetch(url: string, init?: RequestInit) {
  return fetch(`${BASE}${url}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
}

describe("Invoice duplicate", () => {
  beforeAll(async () => {
    await login();
  });

  it("duplicate creates DRAFT with matching lines and new number", async () => {
    const listRes = await authFetch("/api/invoices");
    expect(listRes.ok).toBe(true);
    const invoices = await listRes.json();

    const source = invoices.find((inv: any) => inv.lines && inv.lines.length > 0);
    if (!source) {
      console.log("No invoices with lines found; skipping");
      return;
    }

    const dupRes = await authFetch(`/api/invoices/${source.id}/duplicate`, {
      method: "POST",
    });
    expect(dupRes.ok).toBe(true);
    const dup = await dupRes.json();

    expect(dup.status).toBe("DRAFT");
    expect(dup.id).not.toBe(source.id);
    expect(dup.clientId).toBe(source.clientId);
    expect(dup.lines.length).toBe(source.lines.length);

    for (let i = 0; i < source.lines.length; i++) {
      expect(dup.lines[i].description).toBe(source.lines[i].description);
      expect(Number(dup.lines[i].quantity)).toBeCloseTo(Number(source.lines[i].quantity), 1);
      expect(Number(dup.lines[i].unitRate)).toBeCloseTo(Number(source.lines[i].unitRate), 1);
    }

    expect(dup.publicToken).toBeNull();
    expect(Number(dup.paidAmount)).toBe(0);
  });

  it("duplicate preserves discount and tax settings", async () => {
    const listRes = await authFetch("/api/invoices");
    const invoices = await listRes.json();

    const source = invoices.find(
      (inv: any) => inv.discountType && inv.discountType !== "NONE" && inv.lines.length > 0,
    );
    if (!source) {
      console.log("No invoice with discount found; skipping");
      return;
    }

    const dupRes = await authFetch(`/api/invoices/${source.id}/duplicate`, {
      method: "POST",
    });
    expect(dupRes.ok).toBe(true);
    const dup = await dupRes.json();

    expect(dup.discountType).toBe(source.discountType);
    expect(Number(dup.discountValue)).toBeCloseTo(Number(source.discountValue), 2);
    expect(Number(dup.taxRate)).toBeCloseTo(Number(source.taxRate), 2);
  });

  it("duplicate of non-existent invoice returns 404", async () => {
    const res = await authFetch("/api/invoices/nonexistent-id/duplicate", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
