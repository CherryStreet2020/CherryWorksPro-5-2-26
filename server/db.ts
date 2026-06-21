import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const isProduction = (process.env.NODE_ENV || "").toLowerCase().trim() === "production";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ...(isProduction ? { ssl: { rejectUnauthorized: true } } : {}),
});

pool.query('SELECT 1').then(() => console.log('[db] Connection pool verified')).catch(err => { console.error('[db] FATAL: Database connection failed at startup:', err.message); process.exit(1); });

// Without a handler, an error on an IDLE pooled client (e.g. Postgres failover or
// the backend terminating an idle connection) is emitted as an unhandled 'error'
// event on the Pool and crashes the whole process. Log it and let node-postgres
// evict the broken client; live queries get a fresh connection (audit #12/#22).
pool.on('error', (err) => {
  console.error('[db] idle pool client error (connection will be recycled):', err.message);
});

export const db = drizzle(pool, { schema });
