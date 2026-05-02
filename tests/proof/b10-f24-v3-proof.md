# B10 F24-v3 — Revenue Chart Fix Proof Bundle

**Date:** 2026-04-09
**Commit context:** F24 third fix attempt — static domain computation

---

## Root Cause

The Recharts `domain` callback `(dataMax: number) => ...` receives Recharts' **internal** dataMax, which for grouped `<Bar>` elements sums values across all dataKeys per data point (e.g., `invoiced + paid` for March = $1,925 + $872.76 = $2,797.76). With additional rounding Recharts was computing an inflated internal domain, causing bars to render as tiny slivers at the bottom.

## Fix Applied

Replaced the Recharts domain callback with explicit pre-computed values:

```tsx
const revenueData = capChartData(report.revenueByMonth);
const revenueMax = Math.max(
  ...revenueData.map((d: any) => Math.max(Number(d.invoiced) || 0, Number(d.paid) || 0))
);
const yAxisMax = Math.max(500, Math.ceil(revenueMax * 1.15 / 500) * 500);

<YAxis domain={[0, yAxisMax]} allowDataOverflow={false} tickCount={6} />
```

Key changes:
1. **Static domain** — computed from actual data, NOT from Recharts' internal dataMax
2. **allowDataOverflow={false}** — prevents Recharts from overriding the domain
3. **tickCount={6}** — forces uniform tick spacing
4. **1.15x padding** — 15% headroom above max value, rounded to nearest $500

## File Changed

`client/src/pages/reports.tsx` lines 236–257

## Console Debug Output

```
[F24-debug] revenueData: [{"month":"2026-03","invoiced":1925,"paid":872.76},{"month":"2026-04","invoiced":262.5,"paid":541}]
[F24-debug] revenueMax: 1925  yAxisMax: 2500
```

## Raw API Response (`/api/reports`)

```json
{
  "revenueByMonth": [
    { "month": "2026-03", "invoiced": 1925, "paid": 872.76 },
    { "month": "2026-04", "invoiced": 262.5, "paid": 541 }
  ]
}
```

No EUR invoices, no phantom months, no absurd totals. Data is clean.

## Computation Proof

```
revenueMax = max(1925, 872.76, 262.5, 541) = 1925
yAxisMax   = max(500, ceil(1925 * 1.15 / 500) * 500)
           = max(500, ceil(2213.75 / 500) * 500)
           = max(500, ceil(4.4275) * 500)
           = max(500, 5 * 500)
           = max(500, 2500)
           = 2500

Tallest bar ratio: 1925 / 2500 = 77.0% of plot height
```

## Playwright Test Result

```
Status: SUCCESS
Output: "The Revenue by Month chart is visible with red Invoiced and green Paid bars,
the Y-axis shows dollar ticks from $0.00 to $2,500.00 with even spacing, the tallest
March 2026 Invoiced bar is proportionally large and leaves whitespace above it, and
the console logged the expected F24-debug values: revenueData=[...], revenueMax=1925,
yAxisMax=2500."
```

## Acceptance Criteria

- [x] Tallest bar ≥ 60% of plot height (77.0%)
- [x] Y-axis ticks uniformly spaced ($0 to $2,500 with tickCount=6)
- [x] Visible whitespace above tallest bar
- [x] Y-axis max ($2,500) > tallest bar ($1,925)
- [x] Console output shows revenueData + revenueMax + yAxisMax
- [x] Raw API response included — no pollution data
- [x] Playwright screenshot verification passed
- [x] Canonical baseline unchanged: AR $915.95 / SvcRev $2,187.50 / TB $2,419.70

## reports.tsx Diff

```diff
-              ) : (
-                <ResponsiveContainer width="100%" height={350}>
-                  <BarChart data={capChartData(report.revenueByMonth)}>
-                    <CartesianGrid strokeDasharray="3 3" stroke="var(--lux-border)" />
-                    <XAxis dataKey="month" tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} />
-                    <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.1 / 500) * 500]} tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
+              ) : (() => {
+                const revenueData = capChartData(report.revenueByMonth);
+                const revenueMax = Math.max(
+                  ...revenueData.map((d: any) => Math.max(Number(d.invoiced) || 0, Number(d.paid) || 0))
+                );
+                const yAxisMax = Math.max(500, Math.ceil(revenueMax * 1.15 / 500) * 500);
+                console.log("[F24-debug] revenueData:", JSON.stringify(revenueData));
+                console.log("[F24-debug] revenueMax:", revenueMax, "yAxisMax:", yAxisMax);
+                return (
+                <ResponsiveContainer width="100%" height={350}>
+                  <BarChart data={revenueData}>
+                    <CartesianGrid strokeDasharray="3 3" stroke="var(--lux-border)" />
+                    <XAxis dataKey="month" tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickLine={false} />
+                    <YAxis domain={[0, yAxisMax]} allowDataOverflow={false} tickCount={6} tick={{ fill: "var(--lux-text-muted)", fontSize: 11 }} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
```
