import { pool } from '../db.js';
import { CATEGORIES, randomProductName, randomPrice } from '../lib/generator.js';

/**
 * POST /api/simulate-inserts
 *
 * Rapidly inserts N (default 50) brand-new products. Used to prove pagination
 * stability: a client can keep paging with its cursor while this runs, and will
 * never see these new rows mid-stream (they land at the front of the feed) nor
 * skip/duplicate any existing row.
 */
export default async function simulateRoutes(fastify) {
  fastify.post('/api/simulate-inserts', async (request) => {
    const count = clampCount(request.query.count);

    const names = [];
    const categories = [];
    const prices = [];
    for (let i = 0; i < count; i++) {
      names.push(randomProductName());
      categories.push(CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]);
      prices.push(randomPrice());
    }

    // Single multi-row insert via UNNEST — one round trip, not N.
    // created_at/updated_at default to NOW() so they sort to the front.
    const sql = `
      INSERT INTO products (name, category, price)
      SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[])
      RETURNING id, name, category, price, created_at
    `;
    const { rows } = await pool.query(sql, [names, categories, prices]);

    request.log.info({ inserted: rows.length }, 'simulate-inserts');

    return {
      inserted: rows.length,
      sample: rows.slice(0, 5).map((r) => ({
        id: String(r.id),
        name: r.name,
        category: r.category,
        price: Number(r.price),
        created_at: r.created_at,
      })),
    };
  });
}

function clampCount(raw) {
  let n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) n = 50;
  return Math.min(n, 500);
}
