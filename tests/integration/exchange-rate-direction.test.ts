/**
 * Audit #9: foreign-currency invoices were converting to base currency with an
 * INVERTED (reciprocal) exchange rate. getExchangeRate(base, target) fetched
 * Frankfurter from=base&to=target and stored rates[target] = target-per-base, but
 * every base-currency roll-up MULTIPLIES the foreign amount by exchangeRate, which
 * requires base-per-target. A EUR 100 invoice therefore recorded ~92 USD instead
 * of ~108.75.
 *
 * The fix flips the source: getExchangeRate now fetches from=target&to=base and
 * reads rates[base] = base-per-target, so multiplying a target-denominated amount
 * by the stored rate yields the correct base amount everywhere.
 *
 * These tests mock the Frankfurter fetch with a URL-aware rate table (1 EUR =
 * 1.0875 USD, 1 USD = 0.9195 EUR) and assert the stored/returned rate is the
 * base-per-foreign side. On the pre-fix code getExchangeRate('USD','EUR') would
 * fetch from=USD&to=EUR and return 0.9195 — these assertions fail.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.BANKING_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.SMTP_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

import { pool } from "../../server/db";
import { getExchangeRate, getMultipleRates } from "../../server/exchange-rates";

// 1 EUR = 1.0875 USD; 1 USD = 0.9195 EUR (reciprocal). The mock answers in
// Frankfurter's shape: latest?from=X&to=Y → { base: X, rates: { [Y]: <Y per 1 X> } }.
const RATES: Record<string, Record<string, number>> = {
  EUR: { USD: 1.0875 },
  USD: { EUR: 0.9195 },
};

let fetchCalls: string[] = [];
// Track the random orgIds this suite caches under so teardown only deletes its
// own rows (not other orgs' / concurrent fixtures' USD↔EUR cache).
const insertedOrgIds: string[] = [];
function freshOrg(): string {
  const id = randomUUID();
  insertedOrgIds.push(id);
  return id;
}

beforeEach(() => {
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetchCalls.push(String(url));
    const u = new URL(String(url));
    const from = u.searchParams.get("from")!;
    const to = u.searchParams.get("to")!;
    const rate = RATES[from]?.[to];
    return {
      ok: rate !== undefined,
      status: rate !== undefined ? 200 : 404,
      json: async () => ({ amount: 1, base: from, date: "2026-06-21", rates: rate !== undefined ? { [to]: rate } : {} }),
    } as any;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Only delete rows this suite created — scoped by its own orgIds.
  if (insertedOrgIds.length) {
    await pool.query(`DELETE FROM exchange_rates WHERE org_id = ANY($1::text[])`, [insertedOrgIds]).catch(() => undefined);
  }
});

describe("getExchangeRate stores base-per-target (audit #9)", () => {
  it("USD base / EUR invoice returns base-per-foreign (~1.0875), not the reciprocal (~0.9195)", async () => {
    const orgId = freshOrg(); // fresh org → cache miss → forces a fetch
    const result = await getExchangeRate("USD", "EUR", orgId);

    expect(result.rate).toBeCloseTo(1.0875, 4);
    expect(result.rate).not.toBeCloseTo(0.9195, 4);
    // Stored-string contract (what gets snapshotted onto invoices.exchangeRate).
    expect(result.rateStr).toBe("1.0875");
  });

  it("fetches Frankfurter as from=TARGET&to=BASE and reads rates[BASE]", async () => {
    const orgId = freshOrg();
    await getExchangeRate("USD", "EUR", orgId);

    expect(fetchCalls).toHaveLength(1);
    const u = new URL(fetchCalls[0]);
    expect(u.searchParams.get("from")).toBe("EUR"); // target
    expect(u.searchParams.get("to")).toBe("USD"); // base
  });

  it("a EUR 100 amount rolls up to ~108.75 base via multiply (not 92)", async () => {
    const orgId = freshOrg();
    const { rate } = await getExchangeRate("USD", "EUR", orgId);

    // Consumers do foreignAmount * exchangeRate (e.g. AR = total * exchangeRate).
    const baseAmount = 100 * rate;
    expect(baseAmount).toBeCloseTo(108.75, 2);
    expect(baseAmount).not.toBeCloseTo(91.95, 1);
  });

  it("same-currency short-circuits to 1 without fetching", async () => {
    const result = await getExchangeRate("USD", "USD", freshOrg());
    expect(result.rate).toBe(1);
    expect(fetchCalls).toHaveLength(0);
  });

  it("getMultipleRates keeps the lookup/display direction (target-per-base) unchanged by the flip", async () => {
    // The /api/exchange-rates endpoint quotes "1 base = N target". For base USD,
    // target EUR that is EUR-per-USD (~0.9195), NOT base-per-target (~1.0875).
    const results = await getMultipleRates("USD", ["EUR"], freshOrg());
    expect(results.EUR.rate).toBeCloseTo(0.9195, 4);
    expect(results.EUR.rate).not.toBeCloseTo(1.0875, 4);
  });
});
