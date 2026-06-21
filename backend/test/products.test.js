// Integration tests (Vitest + Supertest) against a real database.
//
// These require a reachable, seeded Postgres (set DATABASE_URL). If the env
// still holds the placeholder, the whole suite is skipped so `npm test` doesn't
// fail on a fresh checkout. (Cursor unit tests in cursor.test.js always run.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../src/app.js';
import { closePool } from '../src/db.js';
import { encodeCursor } from '../src/lib/cursor.js';

const hasRealDb =
  !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('YOUR_PASSWORD');

const suite = hasRealDb ? describe : describe.skip;

suite('Product catalog API', () => {
  let app;
  let request;

  beforeAll(async () => {
    app = await buildApp({ silent: true });
    await app.ready();
    request = supertest(app.server);
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  // ---- response shape & types ---------------------------------------------
  describe('response shape', () => {
    it('returns the documented envelope', async () => {
      const res = await request.get('/api/products?limit=5').expect(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pageInfo');
      expect(res.body.pageInfo).toHaveProperty('count');
      expect(res.body.pageInfo).toHaveProperty('hasNextPage');
      expect(res.body.pageInfo).toHaveProperty('nextCursor');
      expect(res.body.meta).toHaveProperty('dbMs');
    });

    it('serializes each product with correct types', async () => {
      const res = await request.get('/api/products?limit=5').expect(200);
      for (const p of res.body.data) {
        expect(typeof p.id).toBe('string'); // bigint as string
        expect(typeof p.name).toBe('string');
        expect(typeof p.category).toBe('string');
        expect(typeof p.price).toBe('number');
        expect(Number.isFinite(p.price)).toBe(true);
        expect(typeof p.created_at).toBe('string');
        expect(typeof p.updated_at).toBe('string');
      }
    });
  });

  // ---- pagination ----------------------------------------------------------
  describe('pagination', () => {
    it('respects the requested limit', async () => {
      const res = await request.get('/api/products?limit=7').expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(7);
    });

    it('defaults to 20 when limit is omitted', async () => {
      const res = await request.get('/api/products').expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });

    it('clamps limit to a maximum of 100', async () => {
      const res = await request.get('/api/products?limit=1000').expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(100);
    });

    it('falls back to default for a non-numeric limit', async () => {
      const res = await request.get('/api/products?limit=abc').expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });

    it('orders newest-first (created_at desc, id desc tiebreak)', async () => {
      const res = await request.get('/api/products?limit=50').expect(200);
      const rows = res.body.data;
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        // (created_at, id) must be strictly decreasing.
        const ok =
          prev.created_at > cur.created_at ||
          (prev.created_at === cur.created_at && BigInt(prev.id) > BigInt(cur.id));
        expect(ok).toBe(true);
      }
    });

    it('pages through the feed with no duplicates and no skips', async () => {
      const seen = new Set();
      let cursor = null;
      for (let page = 0; page < 8; page++) {
        const url = `/api/products?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await request.get(url).expect(200);
        for (const p of res.body.data) {
          expect(seen.has(p.id)).toBe(false);
          seen.add(p.id);
        }
        if (!res.body.pageInfo.hasNextPage) break;
        cursor = res.body.pageInfo.nextCursor;
      }
      expect(seen.size).toBeGreaterThan(0);
    });

    it('reports end-of-feed for a cursor past the oldest row', async () => {
      // Every seeded row is within the last ~2 years, so a year-2000 cursor is
      // older than all of them -> empty page, no next.
      const endCursor = encodeCursor('2000-01-01 00:00:00+00', 0);
      const res = await request
        .get(`/api/products?cursor=${encodeURIComponent(endCursor)}`)
        .expect(200);
      expect(res.body.data.length).toBe(0);
      expect(res.body.pageInfo.hasNextPage).toBe(false);
      expect(res.body.pageInfo.nextCursor).toBeNull();
    });

    it('stays stable when rows are inserted mid-pagination', async () => {
      const p1 = await request.get('/api/products?limit=20').expect(200);
      const page1Ids = new Set(p1.body.data.map((p) => p.id));
      const cursor = p1.body.pageInfo.nextCursor;

      await request.post('/api/simulate-inserts?count=50').expect(200);

      const p2 = await request
        .get(`/api/products?limit=20&cursor=${encodeURIComponent(cursor)}`)
        .expect(200);
      for (const p of p2.body.data) {
        expect(page1Ids.has(p.id)).toBe(false);
      }
    });
  });

  // ---- bidirectional pagination -------------------------------------------
  describe('bidirectional (prev/next)', () => {
    it('first page has no previous page', async () => {
      const res = await request.get('/api/products?limit=10').expect(200);
      expect(res.body.pageInfo.hasPrevPage).toBe(false);
      expect(res.body.pageInfo.prevCursor).toBeNull();
      expect(res.body.pageInfo.hasNextPage).toBe(true);
    });

    it('going forward then back returns the original page', async () => {
      // Page 1
      const p1 = await request.get('/api/products?limit=12').expect(200);
      const p1Ids = p1.body.data.map((p) => p.id);

      // Page 2 (forward)
      const p2 = await request
        .get(`/api/products?limit=12&cursor=${encodeURIComponent(p1.body.pageInfo.nextCursor)}`)
        .expect(200);
      expect(p2.body.pageInfo.hasPrevPage).toBe(true);

      // Back to page 1 using p2's prevCursor (before)
      const back = await request
        .get(`/api/products?limit=12&before=${encodeURIComponent(p2.body.pageInfo.prevCursor)}`)
        .expect(200);

      expect(back.body.data.map((p) => p.id)).toEqual(p1Ids);
    });

    it('returns the backward page newest-first (same ordering as forward)', async () => {
      const p1 = await request.get('/api/products?limit=10').expect(200);
      const p2 = await request
        .get(`/api/products?limit=10&cursor=${encodeURIComponent(p1.body.pageInfo.nextCursor)}`)
        .expect(200);
      const back = await request
        .get(`/api/products?limit=10&before=${encodeURIComponent(p2.body.pageInfo.prevCursor)}`)
        .expect(200);

      const times = back.body.data.map((p) => p.created_at);
      const sorted = [...times].sort().reverse();
      expect(times).toEqual(sorted); // still descending
    });
  });

  // ---- cursor validation ---------------------------------------------------
  describe('cursor validation', () => {
    it('rejects a malformed cursor with 400', async () => {
      const res = await request.get('/api/products?cursor=not-a-real-cursor').expect(400);
      expect(res.body.error).toBe('invalid_cursor');
    });

    it('treats an empty cursor as no cursor', async () => {
      await request.get('/api/products?cursor=').expect(200);
    });
  });

  // ---- category filter -----------------------------------------------------
  describe('category filter', () => {
    it('returns only the requested category', async () => {
      const cats = await request.get('/api/categories').expect(200);
      const category = cats.body.data[0];
      const res = await request
        .get(`/api/products?limit=20&category=${encodeURIComponent(category)}`)
        .expect(200);
      for (const p of res.body.data) {
        expect(p.category).toBe(category);
      }
    });

    it('returns an empty page for a nonexistent category', async () => {
      const res = await request
        .get('/api/products?category=__does_not_exist__')
        .expect(200);
      expect(res.body.data.length).toBe(0);
      expect(res.body.pageInfo.hasNextPage).toBe(false);
    });

    it('paginates within a category without duplicates', async () => {
      const cats = await request.get('/api/categories').expect(200);
      const category = encodeURIComponent(cats.body.data[0]);
      const seen = new Set();
      let cursor = null;
      for (let page = 0; page < 3; page++) {
        const url = `/api/products?limit=20&category=${category}${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`;
        const res = await request.get(url).expect(200);
        for (const p of res.body.data) {
          expect(seen.has(p.id)).toBe(false);
          seen.add(p.id);
        }
        if (!res.body.pageInfo.hasNextPage) break;
        cursor = res.body.pageInfo.nextCursor;
      }
    });
  });

  // ---- categories ----------------------------------------------------------
  describe('GET /api/categories', () => {
    it('returns a non-empty list of strings', async () => {
      const res = await request.get('/api/categories').expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const c of res.body.data) expect(typeof c).toBe('string');
    });
  });

  // ---- simulate-inserts ----------------------------------------------------
  describe('POST /api/simulate-inserts', () => {
    it('inserts 50 by default', async () => {
      const res = await request.post('/api/simulate-inserts').expect(200);
      expect(res.body.inserted).toBe(50);
      expect(Array.isArray(res.body.sample)).toBe(true);
    });

    it('honours a custom count', async () => {
      const res = await request.post('/api/simulate-inserts?count=10').expect(200);
      expect(res.body.inserted).toBe(10);
    });

    it('clamps count to a maximum of 500', async () => {
      const res = await request.post('/api/simulate-inserts?count=99999').expect(200);
      expect(res.body.inserted).toBe(500);
    });
  });

  // ---- benchmark -----------------------------------------------------------
  describe('GET /api/benchmark', () => {
    it('returns dbExec, wallClock and a speedup; keyset beats offset', async () => {
      const res = await request.get('/api/benchmark?depth=50000').expect(200);
      expect(res.body.dbExec.offsetMs).toBeTypeOf('number');
      expect(res.body.dbExec.keysetMs).toBeTypeOf('number');
      expect(res.body.wallClock).toHaveProperty('offsetMs');
      // The whole point: keyset executes faster than offset at depth.
      expect(res.body.dbExec.keysetMs).toBeLessThanOrEqual(res.body.dbExec.offsetMs);
    }, 30000);

    it('returns a sweep with one result per depth', async () => {
      const res = await request.get('/api/benchmark/sweep?depths=1000,10000').expect(200);
      expect(res.body.results.length).toBe(2);
      expect(res.body.results[0]).toHaveProperty('offsetMs');
      expect(res.body.results[0]).toHaveProperty('keysetMs');
    }, 30000);
  });

  // ---- health & rate limiting ---------------------------------------------
  describe('health & rate limiting', () => {
    it('GET /health returns alive', async () => {
      const res = await request.get('/health').expect(200);
      expect(res.body).toEqual({ status: 'alive' });
    });

    it('attaches rate-limit headers to API routes', async () => {
      const res = await request.get('/api/products?limit=1').expect(200);
      expect(res.headers).toHaveProperty('x-ratelimit-limit');
    });

    it('exempts /health from rate limiting (no rate-limit headers)', async () => {
      const res = await request.get('/health').expect(200);
      expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    });
  });
});
