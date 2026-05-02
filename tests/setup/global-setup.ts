/**
 * Vitest global setup — Sprint 2h.2 Phase B.
 *
 * Spawns a dedicated test server on port 5100 with NODE_ENV=test set so
 * that `loginLimiter` enters its `isTestEnv ? 1000 : 100` branch. This
 * prevents the parallel Vitest suite (~86 files sharing one client IP)
 * from tripping the production rate-limit cap of 100 logins / 15min.
 *
 * Determinism guarantees:
 *  - Always force-kill anything currently bound to :5100 before spawning
 *    so each Vitest run starts from a clean in-memory rate-limit / lockout
 *    state. Reusing a previously running server would defeat the purpose
 *    of this harness.
 *  - Always spawn a fresh child and tear it (and its tree) down at the
 *    end of the run, regardless of how it exits.
 *
 * The test server is a child process — server/index.ts is not modified.
 * The dev workflow on port 5000 continues to run independently.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const TEST_PORT = 5100;
const HEALTH_URL = `http://127.0.0.1:${TEST_PORT}/api/health`;
const READY_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

let child: ChildProcess | null = null;

async function waitForHealth(): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw new Error(
    `[vitest globalSetup] Test server did not become healthy on ${HEALTH_URL} within ${READY_TIMEOUT_MS}ms (last: ${String(lastErr)})`,
  );
}

async function isPortBound(): Promise<boolean> {
  try {
    await fetch(HEALTH_URL);
    // Any HTTP response means *something* is bound; we must reclaim the port.
    return true;
  } catch {
    return false;
  }
}

function killWhateverIsOnPort(): void {
  // Best-effort: find any pids bound to TEST_PORT (LISTEN) and SIGKILL them.
  // We do this synchronously so spawn() below sees a free port.
  try {
    const probe = spawnSync("bash", ["-lc", `ss -ltnp 'sport = :${TEST_PORT}' 2>/dev/null | awk 'NR>1{print $0}' | grep -oE 'pid=[0-9]+' | sort -u | sed 's/pid=//'`], { encoding: "utf8" });
    const pids = (probe.stdout || "").trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      console.log(`[vitest globalSetup] Killing stray pid ${pid} on :${TEST_PORT}`);
      try { process.kill(Number(pid), "SIGKILL"); } catch { /* already gone */ }
    }
  } catch (err) {
    console.warn(`[vitest globalSetup] port-reclaim probe failed: ${String(err)}`);
  }
}

async function reclaimPort(): Promise<void> {
  if (!(await isPortBound())) return;
  console.log(`[vitest globalSetup] :${TEST_PORT} is occupied — reclaiming for a clean state`);
  killWhateverIsOnPort();
  // Give the kernel a moment to release the socket
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if (!(await isPortBound())) return;
  }
  throw new Error(`[vitest globalSetup] could not free port ${TEST_PORT} after kill attempts`);
}

export async function setup(): Promise<void> {
  process.env.TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;

  // Always start from a clean port so the in-memory loginLimiter / lockout
  // maps are fresh. Never reuse an existing server.
  await reclaimPort();

  console.log(`[vitest globalSetup] Spawning test server on :${TEST_PORT} (NODE_ENV=test)`);
  child = spawn("npx", ["tsx", "server/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      VITEST: "true",
      E2E_SEED_ENABLED: "true",
      MARKETING_OS_ENABLED: "true",
      VITE_MARKETING_OS_ENABLED: "true",
      EMAIL_OAUTH_ENABLED: "true",
      VITE_EMAIL_OAUTH_ENABLED: "true",
      PORT: String(TEST_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Run in its own process group so we can SIGKILL the entire tree on teardown.
    detached: true,
  });

  // Surface fatal errors during boot
  child.stderr?.on("data", (buf: Buffer) => {
    const s = buf.toString();
    if (s.includes("FATAL") || s.includes("EADDRINUSE")) {
      process.stderr.write(`[test-server stderr] ${s}`);
    }
  });

  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[vitest globalSetup] Test server exited with code=${code} signal=${signal}`);
    }
  });

  await waitForHealth();
  console.log(`[vitest globalSetup] Test server ready on :${TEST_PORT}`);
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid = signal entire process group (we used detached:true above).
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

export async function teardown(): Promise<void> {
  console.log("[vitest globalSetup] Shutting down test server");

  if (child && child.pid && !child.killed) {
    const pid = child.pid;
    killGroup(pid, "SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        killGroup(pid, "SIGKILL");
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
      child!.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  // Belt-and-suspenders: if anything is still bound to TEST_PORT (e.g. a
  // grandchild spawned by tsx, or a process we didn't own), kill it too.
  try {
    if (await isPortBound()) {
      console.log(`[vitest globalSetup] :${TEST_PORT} still bound after child exit — final cleanup`);
      killWhateverIsOnPort();
    }
  } catch {
    /* nothing left to do */
  }
}
