const BASE = "http://localhost:5000";
const ITERATIONS = 20;

interface TimingResult {
  endpoint: string;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "perfadmin@perftest.com", password: "Password123!" }),
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie?.() || [];
  const sid = cookies.find(c => c.startsWith("connect.sid="))?.split(";")[0] || "";
  const csrf = cookies.find(c => c.startsWith("csrf-token="))?.split(";")[0]?.split("=")[1] || "";
  return { cookie: `${sid}; csrf-token=${csrf}`, csrf };
}

async function measure(url: string, cookie: string, csrf: string, iterations: number): Promise<number[]> {
  const timings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await fetch(`${BASE}${url}`, {
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
    const body = await res.text();
    const elapsed = performance.now() - start;
    timings.push(elapsed);
    if (res.status !== 200) {
      console.error(`  ${url} returned ${res.status}: ${body.substring(0, 100)}`);
    }
  }
  return timings.sort((a, b) => a - b);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, idx)]);
}

function computeStats(endpoint: string, sorted: number[]): TimingResult {
  return {
    endpoint,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

async function main() {
  console.log("=== Performance Test ===");
  console.log(`Iterations per endpoint: ${ITERATIONS}\n`);

  const { cookie, csrf } = await login();
  console.log("Authenticated as perf admin\n");

  const endpoints = [
    "/api/invoices",
    "/api/reports",
    "/api/reports/utilization",
    "/api/dashboard",
  ];

  const results: TimingResult[] = [];

  for (const ep of endpoints) {
    console.log(`Testing ${ep}...`);
    const timings = await measure(ep, cookie, csrf, ITERATIONS);
    const stats = computeStats(ep, timings);
    results.push(stats);
    console.log(`  p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms mean=${stats.mean}ms`);
  }

  console.log("\n=== Results ===");
  console.log("Endpoint                       | p50   | p95   | p99   | min   | max   | mean");
  console.log("-".repeat(90));
  for (const r of results) {
    const ep = r.endpoint.padEnd(30);
    console.log(`${ep} | ${String(r.p50).padStart(5)} | ${String(r.p95).padStart(5)} | ${String(r.p99).padStart(5)} | ${String(r.min).padStart(5)} | ${String(r.max).padStart(5)} | ${String(r.mean).padStart(5)}`);
  }

  const allPass = results.every(r => r.p95 < 500);
  console.log(`\np95 < 500ms: ${allPass ? "PASS" : "FAIL"}`);

  const output = results.map(r => `${r.endpoint}: p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms min=${r.min}ms max=${r.max}ms mean=${r.mean}ms`).join("\n");
  const fs = await import("fs");
  fs.writeFileSync("/tmp/perf-results.txt", output);

  process.exit(allPass ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
