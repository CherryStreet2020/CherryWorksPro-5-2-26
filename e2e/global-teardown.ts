/**
 * Global teardown — sweeps any isolated-test orgs left over by this
 * run (Task #432). Per-test fixtures already clean up on the happy
 * path; this is the safety net for SIGINTs and crashes.
 *
 * Scoped to the CURRENT run id (set by `globalSetup` and persisted to
 * `test-results/e2e-run-id.txt`). A concurrent suite invocation has a
 * different run id baked into its slugs, so this sweep cannot touch
 * its tenants. Truly abandoned runs (older than 6h) are mopped up by
 * the next `globalSetup`, never here.
 */
import {
  closeIsolationPool,
  sweepCurrentRunOrgs,
} from "../tests/helpers/po/isolation";

export default async function globalTeardown() {
  if (!process.env.DATABASE_URL) return;
  try {
    const { swept, failed } = await sweepCurrentRunOrgs();
    if (swept > 0 || failed > 0) {
      console.log(
        `[e2e global-teardown] swept ${swept} isolated org(s); ${failed} failed (logged above).`,
      );
    }
  } catch (err) {
    console.warn("[e2e global-teardown] sweep failed:", err);
  } finally {
    await closeIsolationPool();
  }
}
