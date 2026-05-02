import { db } from "./db";
import { exchangeRates } from "../shared/schema";
import { eq, and } from "drizzle-orm";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ExchangeRateResult {
  rate: number;
  rateStr: string;
  stale: boolean;
  lastUpdated: Date | null;
  error?: string;
}

export function convertCurrencySafe(amountCents: number, rateStr: string): number {
  const [whole, frac = ""] = rateStr.split(".");
  const rateParts = BigInt(whole + frac.padEnd(8, "0").slice(0, 8));
  const result = BigInt(amountCents) * rateParts;
  return Number(result) / 1e8;
}

export async function getExchangeRate(baseCurrency: string, targetCurrency: string, orgId: string): Promise<ExchangeRateResult> {
  if (baseCurrency === targetCurrency) return { rate: 1, rateStr: "1", stale: false, lastUpdated: new Date() };

  const conditions = [
    eq(exchangeRates.baseCurrency, baseCurrency),
    eq(exchangeRates.targetCurrency, targetCurrency),
    eq(exchangeRates.orgId, orgId),
  ];

  const cached = await db.select().from(exchangeRates)
    .where(and(...conditions))
    .limit(1);

  if (cached.length > 0) {
    const age = Date.now() - new Date(cached[0].fetchedAt).getTime();
    if (age < CACHE_TTL_MS) {
      const rateStr = cached[0].rate;
      const stale = age > STALE_THRESHOLD_MS;
      if (stale) {
        console.warn(`[exchange-rates] Using stale rate for ${baseCurrency}→${targetCurrency} (age: ${Math.round(age / 3600000)}h, threshold: ${STALE_THRESHOLD_MS / 3600000}h)`);
      }
      return {
        rate: Number(rateStr),
        rateStr,
        stale,
        lastUpdated: new Date(cached[0].fetchedAt),
      };
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let resp: Response;
    try {
      resp = await fetch(`https://api.frankfurter.app/latest?from=${baseCurrency}&to=${targetCurrency}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rate = data.rates?.[targetCurrency];
    if (!rate) throw new Error(`No rate for ${targetCurrency}`);

    const now = new Date();
    if (cached.length > 0) {
      await db.update(exchangeRates)
        .set({ rate: String(rate), fetchedAt: now })
        .where(eq(exchangeRates.id, cached[0].id));
    } else {
      await db.insert(exchangeRates).values({
        orgId: orgId || null,
        baseCurrency,
        targetCurrency,
        rate: String(rate),
      });
    }

    const rateStr = String(rate);
    return { rate: Number(rate), rateStr, stale: false, lastUpdated: now };
  } catch (err) {
    if (cached.length > 0) {
      const fetchedAt = new Date(cached[0].fetchedAt);
      const age = Date.now() - fetchedAt.getTime();
      const rateStr = cached[0].rate;
      console.warn(`Exchange rate API failed for ${baseCurrency}→${targetCurrency}, using cached rate (age: ${Math.round(age / 3600000)}h):`, err);
      return {
        rate: Number(rateStr),
        rateStr,
        stale: age > STALE_THRESHOLD_MS,
        lastUpdated: fetchedAt,
        error: "Exchange rate API unavailable, using cached rate",
      };
    }
    console.error(`Exchange rate fetch failed for ${baseCurrency}→${targetCurrency} with no cache:`, err);
    return {
      rate: 0,
      rateStr: "0",
      stale: false,
      lastUpdated: null,
      error: "Exchange rate unavailable - please enter manually",
    };
  }
}

export async function getMultipleRates(baseCurrency: string, targets: string[], orgId: string): Promise<Record<string, ExchangeRateResult>> {
  const result: Record<string, ExchangeRateResult> = {};
  for (const t of targets) {
    result[t] = await getExchangeRate(baseCurrency, t, orgId);
  }
  return result;
}
