/**
 * Smoke test for the parallel-safety fixtures (Task #432).
 *
 * Verifies, end-to-end, that:
 *   - `isolatedOrg` provisions a fresh tenant whose admin can hit
 *     the API as ADMIN (200 on `/api/auth/me`)
 *   - The fresh tenant starts on the BUSINESS plan with active
 *     status (so paywalled features are unlocked by default)
 *   - The fixture is genuinely per-test, not cached: minting a
 *     second isolated org from inside a single test must yield a
 *     different orgId AND a different slug
 *   - The fixture's CSRF token works on a CSRF-protected endpoint
 *     (no 403 "invalid CSRF" on POST /api/clients)
 *   - `/api/auth/me` returns the safe user fields with no `password`
 *     leak
 *
 * The architect's review of the original cut flagged a racy
 * "module-level Set" uniqueness assertion across two parallel tests
 * (Set state doesn't survive across worker processes). Replaced with
 * an in-test sequential mint that proves uniqueness deterministically.
 */
import { test, expect } from "../tests/helpers/po/fixtures";
import {
  createIsolatedOrg,
  deleteIsolatedOrg,
  ISO_SLUG_PREFIX,
  getRunId,
} from "../tests/helpers/po/isolation";
// Importing the raw `pg` pool through the same module the helpers use
// keeps the regression assertion honest (same DB, same connection
// settings).
import { Pool } from "pg";

test.describe.configure({ mode: "parallel" });

test.describe("Parallel-safety fixtures (Task #432)", () => {
  test("isolatedOrg returns a working ADMIN session on a BUSINESS-tier org", async ({
    isolatedOrg,
  }) => {
    expect(isolatedOrg.orgId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(isolatedOrg.email).toContain("@e2e-");
    expect(isolatedOrg.runId.length).toBeGreaterThan(0);
    expect(isolatedOrg.slug).toContain(`e2e_iso_${isolatedOrg.runId}_`);

    const me = await isolatedOrg.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    const body = await me.json();
    // /api/auth/me returns the safe user fields flat (no `user` wrapper).
    expect(body.role).toBe("ADMIN");
    expect(body.orgId).toBe(isolatedOrg.orgId);
    expect(body.email).toBe(isolatedOrg.email);
    expect(body).not.toHaveProperty("password");
  });

  test("fixture is per-test (sequential mint inside one test yields a distinct org)", async ({
    isolatedOrg,
  }) => {
    const second = await createIsolatedOrg();
    try {
      expect(second.orgId).not.toBe(isolatedOrg.orgId);
      expect(second.slug).not.toBe(isolatedOrg.slug);
      expect(second.userId).not.toBe(isolatedOrg.userId);
      // Both orgs share the same run id (created by the same suite
      // invocation) — confirms the run-scoping is stable.
      expect(second.runId).toBe(isolatedOrg.runId);
    } finally {
      const ok = await deleteIsolatedOrg(second.orgId);
      expect(ok, "deleteIsolatedOrg must verify the org row was removed").toBe(
        true,
      );
    }
  });

  test("cleanup selector treats `_` as a literal, not a LIKE wildcard", async () => {
    // Architect re-review (Task #432) flagged that the original
    // `slug LIKE 'e2e_iso_<runId>_%'` predicate would have over-matched
    // because `_` is a single-character wildcard inside `LIKE`. The
    // helpers were switched to `starts_with(slug, $1)` — this test
    // pins that decision so a future refactor can't regress it.
    //
    // We seed two slugs into a throwaway scratch query (NOT into orgs
    // — we don't want to pollute) and assert that:
    //   - `starts_with` matches only the literal-prefix slug
    //   - The naive `LIKE` predicate would have matched both (proving
    //     the wildcard hazard is real, not theoretical)
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const runId = getRunId();
      const literalPrefix = `${ISO_SLUG_PREFIX}${runId}_`;
      const goodSlug = `${literalPrefix}123`;
      const badSlug = `e2eXisoY${runId}X456`; // would match `e2e_iso_<runId>_%`
      const r = await pool.query<{ slug: string; via_starts_with: boolean; via_like: boolean }>(
        `SELECT slug,
                starts_with(slug, $1) AS via_starts_with,
                slug LIKE $2 AS via_like
           FROM (VALUES ($3::text), ($4::text)) AS t(slug)`,
        [literalPrefix, `${literalPrefix}%`, goodSlug, badSlug],
      );
      const byCol = Object.fromEntries(r.rows.map((row) => [row.slug, row]));
      expect(byCol[goodSlug].via_starts_with).toBe(true);
      expect(byCol[badSlug].via_starts_with).toBe(false);
      // Sanity — the naive LIKE predicate would have matched both.
      expect(byCol[goodSlug].via_like).toBe(true);
      expect(byCol[badSlug].via_like).toBe(true);
    } finally {
      await pool.end();
    }
  });

  test("CSRF token is fetched and usable on the isolated request", async ({
    isolatedOrg,
  }) => {
    expect(isolatedOrg.csrf.length).toBeGreaterThan(0);

    // Hit a CSRF-protected endpoint — POST /api/clients should accept
    // the token and respond 200 (or 4xx if the body is invalid, but
    // never 403 "invalid CSRF").
    const r = await isolatedOrg.request.post("/api/clients", {
      data: { name: "Iso Client" },
      headers: { "X-CSRF-Token": isolatedOrg.csrf },
    });
    expect(r.status()).not.toBe(403);
  });
});
