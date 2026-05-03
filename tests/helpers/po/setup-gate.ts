/**
 * AdminSetupGate helpers (Task #435).
 *
 * The audit (functionality-audit.md §6.1.1) flags `AdminSetupGate` as a
 * silent swallowing gate: when an ADMIN user lands on a route while the
 * org's "firm profile" is incomplete, every non-allow-listed route
 * renders the Getting Started shell instead of the page the test is
 * actually trying to assert against. The seeded `dean@cherrystconsulting.com`
 * org passes this gate by accident of fixture data; freshly minted
 * isolated orgs do NOT — and would silently fail every admin-side
 * spec.
 *
 * `firmProfileComplete` (server/routes/settings-routes.ts) resolves to
 * `true` if ANY of `address_street`, `address_city`, `email`, or
 * `phone` is set on the org row. We set `email` because it's the
 * cheapest / most semantically harmless field.
 *
 * `clearFirmProfile` exists so the small handful of specs that DO want
 * to assert the gated state (e.g. an audit-§6.1.1 regression test)
 * can opt out of the default-true behavior.
 */
import { Pool } from "pg";

let _pool: Pool | null = null;
function pool(): Pool {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[e2e setup-gate] DATABASE_URL is not set; cannot toggle firm profile.",
    );
  }
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

export async function closeSetupGatePool(): Promise<void> {
  if (_pool) {
    await _pool.end().catch(() => undefined);
    _pool = null;
  }
}

export const FIRM_PROFILE_EMAIL = "firm@e2e.test";

/**
 * Mark the org as having completed the firm profile so AdminSetupGate
 * passes through to the requested page. Idempotent.
 */
export async function completeFirmProfile(orgId: string): Promise<void> {
  await pool().query(
    `UPDATE orgs
        SET email = COALESCE(email, $1),
            address_city = COALESCE(address_city, 'E2E City'),
            updated_at = NOW()
      WHERE id = $2`,
    [FIRM_PROFILE_EMAIL, orgId],
  );
}

/**
 * Strip every field that satisfies the `firmProfileComplete` predicate
 * so the gate engages on the next page load. For specs asserting the
 * gated surface itself.
 */
export async function clearFirmProfile(orgId: string): Promise<void> {
  await pool().query(
    `UPDATE orgs
        SET address_street = NULL,
            address_city = NULL,
            email = NULL,
            phone = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [orgId],
  );
}
