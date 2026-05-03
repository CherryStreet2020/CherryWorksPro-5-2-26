/**
 * Per-role pre-authenticated session helpers (Task #435).
 *
 * Builds on Task #432's `seedAdminPage` worker-fixture pattern. Each
 * Playwright worker mints ONE isolated org with three users (ADMIN,
 * MANAGER, TEAM_MEMBER), logs each role in once, and caches the
 * resulting `storageState` to disk under
 * `test-results/storage/seed-<role>-w<N>.json`. Specs that destructure
 * `seedManagerPage` / `seedTeamMemberPage` then get a fresh `Page`
 * with cookies preloaded — no per-test login dance.
 *
 * Trade-off: per-role sessions are **read-only by convention**.
 * Multiple tests in the same worker share the same backing user, so
 * mutating state on `seedManagerPage` (creating clients, deleting
 * brands, etc.) WILL leak across tests in that worker. Specs that
 * mutate must use the per-test `isolatedOrg` fixture instead.
 *
 * The per-worker org is a regular isolated org — slug-prefixed
 * `e2e_iso_<runId>_` — so the existing global-teardown sweep cleans
 * it up alongside everything else if the worker crashes mid-run.
 */
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  writeFileSync as writeFileSyncFs,
  renameSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  request as pwRequest,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import {
  ISO_SLUG_PREFIX,
  getRunId,
  deleteIsolatedOrg,
} from "./isolation";
import { BASE } from "./auth";

let _pool: Pool | null = null;
function pool(): Pool {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[e2e sessions] DATABASE_URL is not set; cannot mint per-role sessions.",
    );
  }
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

export async function closeSessionsPool(): Promise<void> {
  if (_pool) {
    await _pool.end().catch(() => undefined);
    _pool = null;
  }
}

export type RoleSeedRole = "ADMIN" | "MANAGER" | "TEAM_MEMBER";

export interface RoleSeedOrg {
  orgId: string;
  slug: string;
  users: Record<RoleSeedRole, { id: string; email: string; password: string }>;
}

const STORAGE_DIR = resolve(process.cwd(), "test-results/storage");

/**
 * Mint a single isolated BUSINESS-tier org with one user per role and
 * a completed firm profile (so AdminSetupGate doesn't swallow admin
 * navigation in any spec that uses `seedAdminPage` from this org).
 */
export async function createRoleSeedOrg(): Promise<RoleSeedOrg> {
  const localId = randomUUID().replace(/-/g, "").slice(0, 12);
  const slug = `${ISO_SLUG_PREFIX}${getRunId()}_roles_${localId}`;
  const orgName = `E2E Roles ${localId}`;

  const users: RoleSeedOrg["users"] = {
    ADMIN: {
      id: "",
      email: `roles-admin-${localId}@e2e-${localId}.test`,
      password: `RolesPass!${localId}`,
    },
    MANAGER: {
      id: "",
      email: `roles-manager-${localId}@e2e-${localId}.test`,
      password: `RolesPass!${localId}`,
    },
    TEAM_MEMBER: {
      id: "",
      email: `roles-member-${localId}@e2e-${localId}.test`,
      password: `RolesPass!${localId}`,
    },
  };

  const p = pool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const orgRow = await client.query<{ id: string }>(
      `INSERT INTO orgs (
         name, slug, plan_tier, subscription_status, max_team_members,
         email, address_city
       )
       VALUES ($1, $2, 'BUSINESS', 'active', 999999, $3, 'E2E City')
       RETURNING id`,
      [orgName, slug, `firm-${localId}@e2e.test`],
    );
    const orgId = orgRow.rows[0].id;

    for (const role of Object.keys(users) as RoleSeedRole[]) {
      const u = users[role];
      const hashed = await bcrypt.hash(u.password, 10);
      const userRow = await client.query<{ id: string }>(
        `INSERT INTO users (
           org_id, email, password, name, first_name, last_name, role,
           is_active, onboarding_complete, temp_password
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, false)
         RETURNING id`,
        [
          orgId,
          u.email,
          hashed,
          `Roles ${role} ${localId}`,
          "Roles",
          role,
          role,
        ],
      );
      u.id = userRow.rows[0].id;
    }

    await client.query("COMMIT");
    return { orgId, slug, users };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sanitize an arbitrary string into a filesystem-safe slug fragment.
 * Keeps `[A-Za-z0-9_-]`, replaces everything else with `_`.
 */
function fsSlug(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, "_");
}

/**
 * Login as the given user and return the path to the cached
 * storageState file.
 *
 * The cache key includes:
 *   - the global e2e runId       (isolates across full test runs)
 *   - the Playwright project name (isolates across concurrent
 *                                  projects: anonymous, serial, etc.)
 *   - the worker index            (isolates across workers in a project)
 *   - the role                    (admin/manager/team_member)
 *
 * Without all four dimensions, two concurrent projects starting at
 * workerIndex=0 would clobber each other's storage state — and
 * because we used to early-return on `existsSync`, one worker could
 * silently consume another's session. The cache is also written
 * atomically (temp file + rename) so a crash mid-write can't leave a
 * truncated JSON behind.
 */
export async function persistRoleStorageState(
  workerIndex: number,
  role: RoleSeedRole,
  email: string,
  password: string,
  projectName?: string,
): Promise<string> {
  mkdirSync(STORAGE_DIR, { recursive: true });
  const runId = getRunId();
  const project = fsSlug(projectName ?? "default");
  const file = resolve(
    STORAGE_DIR,
    `seed-${runId}-${project}-w${workerIndex}-${role.toLowerCase()}.json`,
  );
  if (existsSync(file)) return file;

  const ctx: APIRequestContext = await pwRequest.newContext({ baseURL: BASE });
  try {
    const r = await ctx.post(`${BASE}/api/auth/login`, {
      data: { email, password },
    });
    if (r.status() !== 200) {
      throw new Error(
        `[e2e sessions] login as ${role} ${email} failed: ${r.status()}`,
      );
    }
    const state = await ctx.storageState();
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSyncFs(tmp, JSON.stringify(state), "utf8");
    try {
      renameSync(tmp, file);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
  } finally {
    await ctx.dispose();
  }
  return file;
}

/**
 * Open a `Page` pre-loaded with the given role's storageState. Caller
 * is responsible for closing the underlying context.
 */
export async function openPageWithStorageState(
  browser: Browser,
  storageStatePath: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ storageState: storageStatePath });
  const page = await ctx.newPage();
  return { page, close: () => ctx.close() };
}

export async function teardownRoleSeedOrg(seed: RoleSeedOrg): Promise<void> {
  await deleteIsolatedOrg(seed.orgId).catch(() => undefined);
}
