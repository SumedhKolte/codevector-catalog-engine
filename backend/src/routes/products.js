import { pool } from '../db.js';
import { encodeCursor, decodeCursor } from '../lib/cursor.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /api/products
 *
 * Bidirectional keyset (cursor) pagination over products, newest first.
 *
 * Query params:
 *   - limit:    page size (1..100, default 20)
 *   - category: optional exact-match category filter
 *   - cursor / after: page FORWARD (older) — pass pageInfo.nextCursor
 *   - before:         page BACKWARD (newer) — pass pageInfo.prevCursor
 *
 * Why no "jump to page N":
 *   Cursor pagination pages by VALUE ("rows after the one I last saw"), not by
 *   POSITION ("skip 920 rows"). That's the whole point — a value boundary stays
 *   correct while rows are inserted, whereas a position shifts under every write
 *   (causing duplicates/skips). The price is that you get Prev/Next, not random
 *   page access. See ARCHITECTURE.md.
 *
 * How both directions use ONE index:
 *   The index is (created_at DESC, id DESC).
 *     - Forward  : WHERE (created_at, id) <  boundary  ORDER BY ... DESC  (index forward)
 *     - Backward : WHERE (created_at, id) >  boundary  ORDER BY ... ASC   (index backward)
 *   A B-Tree can be scanned in either direction, so the same index serves both.
 *   The backward query is fetched ascending then reversed so the page is always
 *   returned newest-first for display.
 */
export default async function productsRoutes(fastify) {
  fastify.get('/api/products', async (request) => {
    const { limit, category, after, before } = parseQuery(request.query);

    // Category filter is shared by both directions.
    const baseParams = [];
    const baseWhere = [];
    if (category) {
      baseParams.push(category);
      baseWhere.push(`category = $${baseParams.length}`);
    }

    let rows;
    let hasNextPage;
    let hasPrevPage;

    const started = process.hrtime.bigint();

    if (before) {
      // ---- BACKWARD: rows NEWER than the boundary, ascending, then reversed ----
      const params = [...baseParams];
      const where = [...baseWhere];
      const { createdAt, id } = decodeCursor(before);
      params.push(createdAt);
      const pCreated = params.length;
      params.push(id);
      const pId = params.length;
      where.push(`(created_at, id) > ($${pCreated}::timestamptz, $${pId}::bigint)`);
      params.push(limit + 1);
      const pLimit = params.length;

      const sql = `
        SELECT id, name, category, price, created_at, updated_at
        FROM products
        WHERE ${where.join(' AND ')}
        ORDER BY created_at ASC, id ASC
        LIMIT $${pLimit}
      `;
      const res = await pool.query(sql, params);

      // The extra row means there are even-newer rows -> a previous page exists.
      const hasMoreNewer = res.rows.length > limit;
      const pageAsc = hasMoreNewer ? res.rows.slice(0, limit) : res.rows;
      rows = pageAsc.reverse(); // back to newest-first for display
      hasPrevPage = hasMoreNewer;
      hasNextPage = true; // we arrived here from an older page, so it still exists
    } else {
      // ---- FORWARD: rows OLDER than the boundary (or top of feed), descending ----
      const params = [...baseParams];
      const where = [...baseWhere];
      if (after) {
        const { createdAt, id } = decodeCursor(after);
        params.push(createdAt);
        const pCreated = params.length;
        params.push(id);
        const pId = params.length;
        where.push(`(created_at, id) < ($${pCreated}::timestamptz, $${pId}::bigint)`);
      }
      params.push(limit + 1);
      const pLimit = params.length;
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const sql = `
        SELECT id, name, category, price, created_at, updated_at
        FROM products
        ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${pLimit}
      `;
      const res = await pool.query(sql, params);

      hasNextPage = res.rows.length > limit;
      rows = hasNextPage ? res.rows.slice(0, limit) : res.rows;
      hasPrevPage = !!after; // first page (no cursor) has no previous
    }

    const dbMs = Number(process.hrtime.bigint() - started) / 1e6;

    const first = rows[0];
    const last = rows[rows.length - 1];

    request.log.info(
      { category, limit, direction: before ? 'backward' : 'forward', returned: rows.length, dbMs },
      'products query'
    );

    return {
      data: rows.map(serialize),
      pageInfo: {
        count: rows.length,
        hasNextPage,
        hasPrevPage,
        // nextCursor pages forward (older); prevCursor pages backward (newer).
        nextCursor: hasNextPage && last ? encodeCursor(last.created_at, last.id) : null,
        prevCursor: hasPrevPage && first ? encodeCursor(first.created_at, first.id) : null,
      },
      meta: { dbMs: Number(dbMs.toFixed(2)) },
    };
  });

  /**
   * GET /api/categories
   * Distinct category list for the filter dropdown.
   */
  fastify.get('/api/categories', async () => {
    const { rows } = await pool.query(
      'SELECT DISTINCT category FROM products ORDER BY category ASC'
    );
    return { data: rows.map((r) => r.category) };
  });
}

function parseQuery(query) {
  let limit = Number.parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const category = strOrNull(query.category);
  // `cursor` is kept as an alias for `after` (forward) for backward-compat.
  const after = strOrNull(query.after) ?? strOrNull(query.cursor);
  const before = strOrNull(query.before);

  return { limit, category, after, before };
}

function strOrNull(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function serialize(row) {
  return {
    id: String(row.id), // bigint -> string to stay JSON-safe
    name: row.name,
    category: row.category,
    price: Number(row.price), // NUMERIC comes back as string from pg
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
