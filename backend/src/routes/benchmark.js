import { pool } from '../db.js';

const PAGE_SIZE = 20;
const MAX_DEPTH = 10_000_000;
// Default depths for the sweep chart. 10M is offered in the single-run dropdown
// but kept out of the default sweep so the sweep stays responsive (a 10M OFFSET
// scan takes seconds; running it for every depth would make the sweep slow).
const DEFAULT_SWEEP = [1000, 10000, 100000, 1000000];

/**
 * GET /api/benchmark?depth=200000
 *
 * Compares OFFSET vs keyset pagination at a given depth and reports BOTH:
 *   - wallClock: time measured in Node (includes network round-trip to the DB)
 *   - dbExec:    Postgres' own execution time via EXPLAIN ANALYZE (no network)
 *
 * The dbExec numbers are the honest measure of the algorithm: OFFSET is O(n)
 * (it scans and discards `depth` rows), keyset is O(log n) (index seek). The
 * wallClock numbers show what a real client experiences (network-dominated).
 */
export default async function benchmarkRoutes(fastify) {
  fastify.get('/api/benchmark', async (request) => {
    const depth = clampDepth(request.query.depth);
    const boundary = await getBoundary(depth);
    if (!boundary) return { error: `depth ${depth} exceeds row count`, depth };

    const offset = await measureOffset(depth);
    const keyset = await measureKeyset(boundary);

    const speedup =
      keyset.dbExecMs > 0 ? Number((offset.dbExecMs / keyset.dbExecMs).toFixed(1)) : null;

    request.log.info({ depth, offset, keyset, speedup }, 'benchmark');

    return {
      depth,
      pageSize: PAGE_SIZE,
      // Top-level kept for backward-compat with the simple bar view.
      offsetMs: offset.dbExecMs,
      keysetMs: keyset.dbExecMs,
      speedup,
      wallClock: { offsetMs: offset.wallMs, keysetMs: keyset.wallMs },
      dbExec: { offsetMs: offset.dbExecMs, keysetMs: keyset.dbExecMs },
      note:
        'dbExec = Postgres execution time (no network). wallClock = measured in Node (includes network round-trip).',
    };
  });

  /**
   * GET /api/benchmark/sweep?depths=1000,10000,100000,1000000
   * Runs the benchmark across several depths in one call so the dashboard can
   * draw a "latency vs depth" chart. Uses Postgres execution time (dbExec) so
   * the curve isolates the algorithm from network jitter.
   */
  fastify.get('/api/benchmark/sweep', async (request) => {
    const depths = parseDepths(request.query.depths);
    const results = [];

    for (const depth of depths) {
      const boundary = await getBoundary(depth);
      if (!boundary) {
        results.push({ depth, skipped: true, reason: 'exceeds row count' });
        continue;
      }
      const offset = await measureOffset(depth);
      const keyset = await measureKeyset(boundary);
      results.push({
        depth,
        offsetMs: offset.dbExecMs,
        keysetMs: keyset.dbExecMs,
      });
    }

    request.log.info({ depths, results }, 'benchmark sweep');
    return { pageSize: PAGE_SIZE, results };
  });
}

// --- helpers ---------------------------------------------------------------

// Resolve the (created_at, id) at a given depth so the keyset query returns the
// SAME page as the OFFSET query (fair comparison). This lookup is not measured.
async function getBoundary(depth) {
  const { rows } = await pool.query(
    `SELECT created_at, id FROM products ORDER BY created_at DESC, id DESC OFFSET $1 LIMIT 1`,
    [depth]
  );
  return rows[0] ?? null;
}

const OFFSET_SQL = `SELECT id, created_at FROM products ORDER BY created_at DESC, id DESC OFFSET $1 LIMIT $2`;
const KEYSET_SQL = `SELECT id, created_at FROM products WHERE (created_at, id) < ($1::timestamptz, $2::bigint) ORDER BY created_at DESC, id DESC LIMIT $3`;

async function measureOffset(depth) {
  const wallMs = await wall(() => pool.query(OFFSET_SQL, [depth, PAGE_SIZE]));
  const dbExecMs = await explainExec(OFFSET_SQL, [depth, PAGE_SIZE]);
  return { wallMs, dbExecMs };
}

async function measureKeyset(boundary) {
  const params = [boundary.created_at, boundary.id, PAGE_SIZE];
  const wallMs = await wall(() => pool.query(KEYSET_SQL, params));
  const dbExecMs = await explainExec(KEYSET_SQL, params);
  return { wallMs, dbExecMs };
}

// Wall-clock time of a DB call as seen from Node (includes the network).
async function wall(fn) {
  const start = process.hrtime.bigint();
  await fn();
  return round(Number(process.hrtime.bigint() - start) / 1e6);
}

// Postgres' own execution time via EXPLAIN ANALYZE (excludes the network).
async function explainExec(sql, params) {
  const { rows } = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON, TIMING TRUE) ${sql}`, params);
  let plan = rows[0]['QUERY PLAN'];
  if (typeof plan === 'string') plan = JSON.parse(plan);
  return round(plan[0]['Execution Time']);
}

function round(n) {
  return Number(n.toFixed(3));
}

function clampDepth(raw) {
  let n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) n = 200000;
  return Math.min(n, MAX_DEPTH);
}

function parseDepths(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_SWEEP;
  const parsed = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => Math.min(n, MAX_DEPTH));
  return parsed.length ? parsed : DEFAULT_SWEEP;
}
