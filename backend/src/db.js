// Postgres connection pool (node-postgres).
import pg from 'pg';
import { config } from './config.js';

// --- Type parsers -----------------------------------------------------------
// IMPORTANT for cursor correctness:
// By default node-postgres parses TIMESTAMPTZ (OID 1184) into a JS Date, which
// only has millisecond precision. Postgres NOW() stores microseconds. If we
// build cursors from a millisecond-truncated timestamp we can skip or duplicate
// rows that share the same millisecond but differ in microseconds.
//
// To keep keyset pagination exact, we tell pg to hand us the raw timestamp
// string (full precision) instead of a Date. We then pass that exact string
// back into the WHERE clause, so the comparison is loss-free.
pg.types.setTypeParser(1184, (v) => v); // timestamptz
pg.types.setTypeParser(1114, (v) => v); // timestamp (no tz), just in case

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  // Keep a couple of warm connections so the first request after idle doesn't
  // pay TLS + auth handshake latency.
  min: 2,
  // Enable TCP keepalive so sockets stay open and we skip reconnect overhead
  // between requests (meaningful against a remote DB like Supabase).
  keepAlive: true,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
});

// CRITICAL: node-postgres emits an 'error' event on idle clients when the
// backend drops a connection (e.g. Supabase closing idle sockets, or hitting a
// connection limit during a burst of requests). If nothing listens for it, Node
// treats it as an uncaught exception and CRASHES THE PROCESS. Handling it here
// lets the pool quietly discard the dead client and open a fresh one next query.
pool.on('error', (err) => {
  console.error('[pg pool] idle client error (recovered):', err.message);
});

export async function closePool() {
  await pool.end();
}
