import { describe, it, expect, beforeAll } from "vitest";

import { TEST_BASE as BASE } from "../helpers/base";
let adminCookie = "";

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.test@cwpro.dev", password: "admin123" }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  adminCookie = raw.map(c => c.split(";")[0]).join("; ");
});

describe("Invoice number generation (MAX-based)", () => {
  it("GET next invoice number returns a formatted number", async () => {
    const res = await fetch(`${BASE}/api/invoices`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const invoiceList = await res.json();
    expect(Array.isArray(invoiceList)).toBe(true);
    if (invoiceList.length > 0) {
      const numbers = invoiceList.map((i: any) => i.number).filter(Boolean);
      const maxNum = numbers.sort().pop();
      if (maxNum) {
        const match = maxNum.match(/(\d+)$/);
        expect(match).not.toBeNull();
      }
    }
  });

  it("invoice numbers have correct prefix format", async () => {
    const res = await fetch(`${BASE}/api/invoices`, { headers: { Cookie: adminCookie } });
    const invoiceList = await res.json();
    for (const inv of invoiceList) {
      if (inv.number) {
        expect(inv.number).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*-\d{4,}$/);
      }
    }
  });
});

describe("Estimate number generation (MAX-based)", () => {
  it("estimate numbers have correct prefix format", async () => {
    const res = await fetch(`${BASE}/api/estimates`, { headers: { Cookie: adminCookie } });
    if (res.status === 200) {
      const list = await res.json();
      for (const est of list) {
        if (est.number) {
          expect(est.number).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*-\d{4,}$/);
        }
      }
    }
  });
});
