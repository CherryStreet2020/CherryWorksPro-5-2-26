/**
 * Per-test org isolation helpers (Task #432).
 *
 * Creates a fresh org + admin user directly in the database so a single
 * Playwright spec can mutate that tenant's data without racing against
 * the shared seed admin (`dean@cherrystconsulting.com`) used by the
 * existing serial specs. The org is tagged with the
 * `e2e_iso_<runId>_` slug prefix so `e2e/global-teardown.ts` can sweep
 * THIS RUN's stale rows from aborted runs without touching another
 * concurrent run's tenants.
 *
 * Why direct DB inserts (vs. POST /api/auth/signup):
 *   - The signup endpoint enforces a 3-orgs-per-domain-per-24h rate
 *     limit that would trip almost immediately under N parallel workers.
 *   - Signup also creates a Stripe customer; we don't want to talk to
 *     Stripe from the test suite, and many CI envs have no
 *     STRIPE_SECRET_KEY (the endpoint returns 503 in that case).
 *   - Direct insert lets us pin `plan_tier` and `subscription_status`
 *     so the org bypasses paywalls without flipping live billing.
 *
 * Why a per-run id:
 *   - Architect review of the initial #432 cut flagged that a global
 *     "delete e2e_iso_* older than 1h" sweep can race a long-running
 *     concurrent CI shard and nuke its still-active tenants. Scoping
 *     every per-run cleanup to the current `E2E_RUN_ID` makes
 *     cross-run interference impossible. Truly abandoned runs are
 *     mopped up by the separate `sweepAbandonedRuns` helper, which is
 *     deliberately only invoked from `globalSetup` (never teardown)
 *     and only for runs older than its `olderThanMs` cutoff (default
 *     6h — well past any realistic suite runtime).
 */
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { request as pwRequest, type APIRequestContext } from "@playwright/test";

export const ISO_SLUG_PREFIX = "e2e_iso_";
const RUN_ID_FILE = resolve(process.cwd(), "test-results/e2e-run-id.txt");

export interface IsolatedOrg {
  orgId: string;
  userId: string;
  email: string;
  password: string;
  slug: string;
  runId: string;
}

let _sharedPool: Pool | null = null;
function pool(): Pool {
  if (_sharedPool) return _sharedPool;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[e2e isolation] DATABASE_URL is not set; cannot create isolated org. " +
      "Run the dev workflow (which provisions the DB) before invoking this fixture.",
    );
  }
  _sharedPool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _sharedPool;
}

export async function closeIsolationPool(): Promise<void> {
  if (_sharedPool) {
    await _sharedPool.end().catch(() => undefined);
    _sharedPool = null;
  }
}

let _runId: string | null = null;

/**
 * Returns the stable run id for this Playwright invocation. Resolution
 * order (highest precedence first):
 *   1. process.env.E2E_RUN_ID (set in-process by globalSetup)
 *   2. test-results/e2e-run-id.txt (written by globalSetup; read by
 *      worker processes that don't share env with the controller)
 *   3. Fresh randomUUID — single-process / unit-test fallback only.
 */
export function getRunId(): string {
  if (_runId) return _runId;
  if (process.env.E2E_RUN_ID) {
    _runId = process.env.E2E_RUN_ID;
    return _runId;
  }
  try {
    if (existsSync(RUN_ID_FILE)) {
      const v = readFileSync(RUN_ID_FILE, "utf8").trim();
      if (v) {
        _runId = v;
        process.env.E2E_RUN_ID = v;
        return v;
      }
    }
  } catch {
    /* fall through to generation */
  }
  _runId = randomUUID().replace(/-/g, "").slice(0, 12);
  process.env.E2E_RUN_ID = _runId;
  return _runId;
}

/**
 * Called by globalSetup to mint a stable run id and persist it for
 * worker processes. Idempotent — re-invoking returns the existing id.
 */
export function initRunId(): string {
  if (_runId || process.env.E2E_RUN_ID) return getRunId();
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  _runId = id;
  process.env.E2E_RUN_ID = id;
  try {
    mkdirSync(resolve(process.cwd(), "test-results"), { recursive: true });
    writeFileSync(RUN_ID_FILE, id, "utf8");
  } catch (err) {
    console.warn("[e2e isolation] failed to persist run id marker:", err);
  }
  return id;
}

function slugForRun(localId: string): string {
  return `${ISO_SLUG_PREFIX}${getRunId()}_${localId}`;
}

/**
 * Create a brand-new org + ADMIN user. The caller is responsible for
 * calling `deleteIsolatedOrg(orgId)` in an `afterEach`/fixture teardown.
 * The global-teardown sweeper is a safety net for aborted runs only.
 */
export async function createIsolatedOrg(opts: {
  /** Plan tier the org should land on. Defaults to BUSINESS so all
   * paywalled features are unlocked. */
  planTier?: string;
  /** Subscription status. Defaults to "active". */
  subscriptionStatus?: string;
  /**
   * Task #435 — Pre-populate the firm-profile fields so AdminSetupGate
   * (audit §6.1.1) lets ADMIN navigation through to the requested
   * page. Defaults to true to match every existing spec's working
   * assumption that admin pages render their actual content. Specs
   * asserting the gated surface itself should pass `false`.
   */
  firmProfileComplete?: boolean;
} = {}): Promise<IsolatedOrg> {
  const planTier = opts.planTier ?? "BUSINESS";
  const subscriptionStatus = opts.subscriptionStatus ?? "active";
  const firmProfileComplete = opts.firmProfileComplete ?? true;
  const localId = randomUUID().replace(/-/g, "").slice(0, 12);
  const slug = slugForRun(localId);
  const orgName = `E2E Iso ${localId}`;
  const email = `iso-${localId}@e2e-${localId}.test`;
  const password = `IsoPass!${localId}`;
  const hashed = await bcrypt.hash(password, 10);

  const p = pool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const orgRow = await client.query<{ id: string }>(
      `INSERT INTO orgs (
         name, slug, plan_tier, subscription_status, max_team_members,
         email, address_city
       )
       VALUES ($1, $2, $3, $4, 999999, $5, $6)
       RETURNING id`,
      [
        orgName,
        slug,
        planTier,
        subscriptionStatus,
        firmProfileComplete ? `firm-${localId}@e2e.test` : null,
        firmProfileComplete ? "E2E City" : null,
      ],
    );
    const orgId = orgRow.rows[0].id;
    const userRow = await client.query<{ id: string }>(
      `INSERT INTO users (
         org_id, email, password, name, first_name, last_name, role,
         is_active, onboarding_complete, temp_password
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'ADMIN', true, true, false)
       RETURNING id`,
      [orgId, email, hashed, `Iso Admin ${localId}`, "Iso", "Admin"],
    );
    await client.query("COMMIT");
    return {
      orgId,
      userId: userRow.rows[0].id,
      email,
      password,
      slug,
      runId: getRunId(),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Add an extra user (MANAGER / TEAM_MEMBER / etc.) to an already-created
 * isolated org. Returns the new user's email + plaintext password so the
 * caller can sign in via the public /api/auth/login route. Lets a single
 * spec exercise per-role variants (e.g. dashboard role gating) without
 * sharing a seed org with other workers.
 */
export async function addUserToIsolatedOrg(
  orgId: string,
  role: "ADMIN" | "MANAGER" | "TEAM_MEMBER",
): Promise<{ userId: string; email: string; password: string }> {
  const localId = randomUUID().replace(/-/g, "").slice(0, 12);
  const email = `iso-${role.toLowerCase()}-${localId}@e2e-${localId}.test`;
  const password = `IsoPass!${localId}`;
  const hashed = await bcrypt.hash(password, 10);
  const p = pool();
  const r = await p.query<{ id: string }>(
    `INSERT INTO users (
       org_id, email, password, name, first_name, last_name, role,
       is_active, onboarding_complete, temp_password
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, false)
     RETURNING id`,
    [orgId, email, hashed, `Iso ${role} ${localId}`, "Iso", role.replace("_", " "), role],
  );
  return { userId: r.rows[0].id, email, password };
}

/** Cached list of `org_id`-bearing tables to avoid hitting
 * information_schema on every cleanup. The schema doesn't change
 * during a single test run. */
let _orgIdTablesCache: string[] | null = null;
async function discoverOrgIdTables(): Promise<string[]> {
  if (_orgIdTablesCache) return _orgIdTablesCache;
  const p = pool();
  const r = await p.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.columns
      WHERE column_name = 'org_id'
        AND table_schema = current_schema()
        AND table_name <> 'orgs'`,
  );
  // `users` last among child tables — many other tables FK to users,
  // so we want their org-scoped rows gone before we touch users.
  const all = r.rows.map((row) => row.table_name);
  const others = all.filter((t) => t !== "users");
  const ordered = users(all) ? [...others, "users"] : others;
  _orgIdTablesCache = ordered;
  return ordered;
}
function users(arr: string[]): boolean {
  return arr.includes("users");
}

/**
 * Best-effort teardown of an isolated org. Discovers every table with
 * an `org_id` column at runtime, deletes the org's rows from each (in
 * a sensible order), then deletes the `orgs` row itself. Returns
 * `true` only if the parent `orgs` row was successfully removed
 * (verified by the affected-row count). Per-table failures are logged
 * so they're discoverable but not thrown — one flaky cleanup must
 * never fail an otherwise-green test.
 */
export async function deleteIsolatedOrg(orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const p = pool();
  let tables: string[];
  try {
    tables = await discoverOrgIdTables();
  } catch (err) {
    console.warn(`[e2e isolation] org_id table discovery failed for ${orgId}:`, err);
    return false;
  }

  // Two intertwined hazards we have to defuse:
  //
  //  (a) `audit_logs` is protected by the immutability trigger
  //      `prevent_audit_log_modification` (see migration 0017). The
  //      sanctioned bypass is to set the transaction-local GUC
  //      `app.allow_audit_log_modification = 'on'` via `set_config(..., true)`
  //      inside the same transaction as the DELETE. That bypass is
  //      explicitly intended for this scenario and never reaches
  //      production traffic.
  //
  //  (b) Several routes (notably `auth-routes.ts` LOGIN_FAILED and
  //      `middleware.ts` request logging) write audit rows via
  //      `storage.createAuditLog(...).catch(() => {})` — fire-and-forget
  //      promises that can land on a *different* pooled connection
  //      AFTER our cleanup transaction commits its child deletes but
  //      before it commits the parent DELETE on `orgs`. The single-
  //      transaction sweep narrows the window dramatically (FK is
  //      enforced row-by-row inside the txn), but a racing committed
  //      insert from another connection can still trip the parent
  //      DELETE. We bound that with a small retry loop.
  const MAX_ATTEMPTS = 5;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      // Sanctioned escape hatch from migration 0017. `set_config(..., true)`
      // makes the GUC transaction-local — it cannot leak to the next
      // statement on this pooled connection.
      await client.query(
        `SELECT set_config('app.allow_audit_log_modification', 'on', true)`,
      );
      // Defuse FK ordering between sibling org-scoped tables. The
      // `discoverOrgIdTables()` list is in arbitrary information_schema
      // order, so e.g. `clients` can be deleted before
      // `client_activities` — even though both carry `org_id`, the
      // `client_activities.client_id` FK to `clients` blocks the
      // parent delete and the org never goes away. Over hundreds of
      // runs this leaked 450+ orphaned `e2e_iso_*` orgs and made
      // `sweepAbandonedRuns` a 5-15 min stall during global-setup.
      //
      // `session_replication_role = 'replica'` skips FK trigger
      // checks for the duration of THIS transaction on THIS pooled
      // connection only. We are deleting an entire org subtree by
      // org_id on every table that carries one, so referential
      // integrity is preserved by construction — there is nothing
      // left to be inconsistent with once COMMIT runs.
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
      for (const t of tables) {
        // Wrap each per-table DELETE in its own SAVEPOINT so a single
        // FK violation only rolls back THAT delete instead of poisoning
        // the whole transaction. Without the savepoint, the first
        // failure aborts the txn and every subsequent DELETE in this
        // loop logs "current transaction is aborted, commands ignored"
        // — a single global-setup used to spew hundreds of those lines
        // and bury real failures (task #456). Savepoints keep the
        // outer txn (and the audit-log GUC set above) alive across
        // per-table errors.
        await client.query(`SAVEPOINT del_tbl`);
        try {
          // `t` comes from information_schema, not user input — safe
          // to interpolate as a quoted identifier.
          await client.query(`DELETE FROM "${t}" WHERE org_id = $1`, [orgId]);
          await client.query(`RELEASE SAVEPOINT del_tbl`);
        } catch (err) {
          await client
            .query(`ROLLBACK TO SAVEPOINT del_tbl`)
            .catch(() => undefined);
          await client
            .query(`RELEASE SAVEPOINT del_tbl`)
            .catch(() => undefined);
          console.warn(
            `[e2e isolation] DELETE "${t}" for org ${orgId} failed (attempt ${attempt}):`,
            err,
          );
          // A failed child delete will likely cause the parent delete
          // to fail too; let it surface in the retry loop rather than
          // ROLLBACK-ing here so we still attempt the parent.
        }
      }
      const r = await client.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
      await client.query("COMMIT");
      return (r.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      lastErr = err;
      const code = (err as { code?: string } | null)?.code;
      if (code !== "23503") {
        console.warn(
          `[e2e isolation] DELETE orgs WHERE id=${orgId} failed (attempt ${attempt}):`,
          err,
        );
        return false;
      }
      // FK violation: a fire-and-forget audit_logs insert (or similar)
      // committed on another connection after our child sweep. Brief
      // exponential backoff, then retry the whole transaction.
      await new Promise((res) => setTimeout(res, 100 * attempt));
    } finally {
      client.release();
    }
  }
  console.warn(
    `[e2e isolation] DELETE orgs WHERE id=${orgId} still FK-blocked after ` +
      `${MAX_ATTEMPTS} attempts:`,
    lastErr,
  );
  return false;
}

/**
 * Sweep all isolated orgs belonging to the CURRENT run id. Safe to
 * call in `globalTeardown`: it cannot touch another concurrent run's
 * tenants because they have a different run id baked into their slug.
 */
export async function sweepCurrentRunOrgs(): Promise<{
  swept: number;
  failed: number;
}> {
  const runId = getRunId();
  const p = pool();
  // `starts_with(slug, $1)` (Postgres 11+) is used instead of
  // `slug LIKE $1` because the slug prefix `e2e_iso_<runId>_`
  // contains literal underscores — and `_` is a single-character
  // wildcard inside `LIKE` patterns. Without an `ESCAPE` clause a
  // `LIKE 'e2e_iso_%'` predicate would also match e.g. `e2eXisoY...`,
  // which risks deleting unrelated tenants. `starts_with` does literal
  // prefix matching and sidesteps the wildcard issue entirely.
  const r = await p.query<{ id: string }>(
    `SELECT id FROM orgs WHERE starts_with(slug, $1)`,
    [`${ISO_SLUG_PREFIX}${runId}_`],
  );
  let swept = 0;
  let failed = 0;
  for (const row of r.rows) {
    const ok = await deleteIsolatedOrg(row.id);
    if (ok) swept++;
    else failed++;
  }
  return { swept, failed };
}

/**
 * Sweep abandoned isolated orgs from PRIOR runs. Only call from
 * `globalSetup` — never teardown — so we can't race a still-active
 * concurrent run that's also working through its own setup. The
 * `olderThanMs` default (6h) is intentionally conservative: well past
 * any realistic suite runtime, but still automatic enough that
 * abandoned rows don't accumulate forever.
 *
 * Returns `{swept, failed, runsTouched}` where `runsTouched` is the
 * count of distinct prior run ids that contributed at least one row.
 */
export async function sweepAbandonedRuns(
  olderThanMs = 6 * 60 * 60 * 1000,
): Promise<{ swept: number; failed: number; runsTouched: number }> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const currentRunId = getRunId();
  const p = pool();
  // See `sweepCurrentRunOrgs` for why we use `starts_with` over `LIKE`
  // (literal `_` in our prefix would be interpreted as a `LIKE`
  // wildcard, broadening the match). Same reasoning applies to the
  // `NOT starts_with(...)` exclusion of the current run.
  const r = await p.query<{ id: string; slug: string }>(
    `SELECT id, slug
       FROM orgs
      WHERE starts_with(slug, $1)
        AND created_at < $2
        AND NOT starts_with(slug, $3)`,
    [ISO_SLUG_PREFIX, cutoff, `${ISO_SLUG_PREFIX}${currentRunId}_`],
  );
  let swept = 0;
  let failed = 0;
  const seenRuns = new Set<string>();
  for (const row of r.rows) {
    const m = row.slug.match(
      new RegExp(`^${ISO_SLUG_PREFIX}([^_]+)_`),
    );
    if (m) seenRuns.add(m[1]);
    const ok = await deleteIsolatedOrg(row.id);
    if (ok) swept++;
    else failed++;
  }
  return { swept, failed, runsTouched: seenRuns.size };
}

export const BASE = `http://localhost:${process.env.PORT || 5000}`;

/**
 * Returns a fresh APIRequestContext logged in as the given isolated
 * org's admin, with CSRF token already fetched. Caller must
 * `.dispose()` the context (the fixture does this automatically).
 */
export async function buildIsolatedRequest(
  iso: IsolatedOrg,
): Promise<{ request: APIRequestContext; csrf: string }> {
  // Per-call source IP isolates this context from the per-IP login
  // limiter (15min/100). Without it, running >100 isolatedOrg-using
  // specs in a single worker exhausts the bucket — Express has
  // `trust proxy = 1`, so X-Forwarded-For becomes req.ip and is
  // what express-rate-limit's default keyGenerator hashes on.
  const b = randomBytes(2);
  const sourceIp = `198.51.${b[0]}.${(b[1] % 254) + 1}`;
  const ctx = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "X-Forwarded-For": sourceIp },
  });
  const loginRes = await ctx.post(`${BASE}/api/auth/login`, {
    data: { email: iso.email, password: iso.password },
  });
  if (loginRes.status() !== 200) {
    await ctx.dispose();
    throw new Error(
      `[e2e isolation] login as ${iso.email} (org ${iso.orgId}) failed: ${loginRes.status()}`,
    );
  }
  const csrfRes = await ctx.get(`${BASE}/api/csrf-token`);
  if (csrfRes.status() !== 200) {
    await ctx.dispose();
    throw new Error(`[e2e isolation] csrf-token fetch failed: ${csrfRes.status()}`);
  }
  const csrf = csrfRes.headers()["x-csrf-token"] || "";
  return { request: ctx, csrf };
}
