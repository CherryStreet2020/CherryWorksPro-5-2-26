/**
 * Integration suites that tick the real send loop each dispatch EVERY due
 * campaign and enrollment in the shared test DB, so two of them running in
 * parallel workers send each other's rows. Each such suite holds this
 * session-level advisory lock from the start of its beforeAll to the end of
 * its afterAll (after cleanup), so they run one at a time.
 */
import { Client } from "pg";

const SEND_LOOP_SUITE_LOCK = 0x5e9d_100c;

export async function acquireSendLoopSuiteLock(): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [SEND_LOOP_SUITE_LOCK]);
  return async () => {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [SEND_LOOP_SUITE_LOCK]);
    } finally {
      await client.end();
    }
  };
}
