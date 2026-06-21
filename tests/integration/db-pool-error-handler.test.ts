/**
 * Audit #12/#22: a pg Pool that emits an 'error' event (e.g. an idle client
 * dropped during Postgres failover) with NO 'error' listener makes Node throw,
 * crashing the process. db.ts must register a pool-level error handler so such
 * idle-client errors are logged and the connection recycled instead.
 */
import { describe, it, expect } from "vitest";
import { pool } from "../../server/db";

describe("db pool has an idle-client error handler (audit #12/#22)", () => {
  it("registers an 'error' listener so idle-client errors don't crash the process", () => {
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
  });
});
