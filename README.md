# Product Catalog — fast, stable pagination over 200k+ products

A small backend that lets you browse products **newest-first**, **filter by
category**, and **paginate** through them — built so that pagination stays
**correct while data is changing** (no duplicates, no skips) and **fast at scale**.

- **Backend:** Node.js + [Fastify](https://fastify.dev/), PostgreSQL via `pg`, Pino logs, rate limiting.
- **Database:** PostgreSQL (works on Supabase / Neon / local).
- **Frontend (bonus):** React + Vite + Tailwind — a Live Feed and a Cursor-vs-OFFSET benchmark view.

The headline decision is **keyset (cursor) pagination** instead of `OFFSET`.
The full reasoning is in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Repository layout

```
backend/                 Fastify API + seeder + tests
  src/
    app.js               Fastify app factory (plugins, error handling, routes)
    server.js            Entry point (binds port, graceful shutdown)
    config.js            Env-driven config
    db.js                pg Pool (+ timestamptz precision fix for cursors)
    lib/cursor.js        Opaque cursor encode/decode
    lib/generator.js     Mock data generation (shared by seeder + simulate)
    routes/
      products.js        GET /api/products (keyset pagination), GET /api/categories
      simulate.js        POST /api/simulate-inserts
      benchmark.js       GET /api/benchmark (OFFSET vs keyset)
      health.js          GET /health
  scripts/
    schema.sql           Table, indexes, updated_at trigger
    migrate.js           Applies schema.sql
    seed.js              Bulk seeder (batched UNNEST inserts)
  test/products.test.js  Vitest + Supertest integration tests
frontend/                React + Vite + Tailwind UI
.github/workflows/       keep-alive.yml (pings /health every 10 min)
render.yaml              Render Blueprint for the backend
```

---

## Quick start (local)

### 0. Prerequisites
- Node.js 18+
- A PostgreSQL database. Easiest: a free [Supabase](https://supabase.com) project.

### 1. Backend

```bash
cd backend
cp .env.example .env        # then edit .env with your DATABASE_URL
npm install
npm run migrate             # creates table + indexes + trigger
npm run seed                # inserts SEED_COUNT rows (default 200,000)
npm start                   # http://localhost:8080
```

> **Seeding fewer rows while developing:** set `SEED_COUNT=20000` in `.env`.
> The architecture scales to 1,000,000 — set `SEED_COUNT=1000000` to stress test.

Sanity check:

```bash
curl http://localhost:8080/health
curl "http://localhost:8080/api/products?limit=5"
```

### 2. Frontend (optional)

```bash
cd frontend
cp .env.example .env        # set VITE_API_URL=http://localhost:8080
npm install
npm run dev                 # http://localhost:5173
```

### 3. Tests

```bash
cd backend
npm test
```

The suite runs against the database in `DATABASE_URL` (it expects it to be
seeded). If `DATABASE_URL` still contains the placeholder it is skipped, so a
fresh checkout won't fail.

---

## API

| Method | Path                     | Description |
|--------|--------------------------|-------------|
| GET    | `/health`                | Liveness probe → `{ "status": "alive" }` (exempt from rate limiting) |
| GET    | `/api/products`          | Keyset-paginated feed, newest first |
| GET    | `/api/categories`        | Distinct categories for the filter |
| POST   | `/api/simulate-inserts`  | Inserts N new products (default 50) to test stability |
| GET    | `/api/benchmark`         | Times OFFSET vs keyset at a given depth |

### `GET /api/products`

Query params: `limit` (1–100, default 20), `category` (optional), `cursor`/`after`
(page **forward**/older — pass `pageInfo.nextCursor`), `before` (page **backward**/newer
— pass `pageInfo.prevCursor`).

Pagination is **bidirectional** (Prev/Next), not jump-to-page — that's inherent
to cursor pagination and is what keeps it stable under writes. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

```jsonc
{
  "data": [
    { "id": "200050", "name": "Premium Headphones 4821", "category": "Electronics",
      "price": 129.99, "created_at": "2026-06-22 10:15:03.412+00", "updated_at": "..." }
  ],
  "pageInfo": { "count": 20, "hasNextPage": true, "nextCursor": "MjAyNi0wNi0yMi..." },
  "meta": { "dbMs": 0.84 }
}
```

To get the next page, pass back `pageInfo.nextCursor` as `?cursor=`. The cursor
is opaque — treat it as a token.

---

## How correctness-while-changing is guaranteed

We sort by `(created_at DESC, id DESC)` and page with a row-value comparison:

```sql
WHERE (created_at, id) < ($cursor_created_at, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT $n
```

Newly inserted/updated products get a newer `created_at`, so they appear at the
**front** of the feed and never shift the rows you've already paged past.
Result: you can keep paginating while the catalog changes and you will **never
see a row twice or miss one**. The `id` is the tiebreaker for rows that share a
`created_at`.

Try it: in the UI hit **"Simulate Traffic (+50)"** and keep clicking **"Load
more"** — the Duplicates counter stays at **0**. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the full explanation (including the timestamp-precision subtlety this code handles).

---

## Deployment

- **Backend → Render:** [`render.yaml`](./render.yaml) Blueprint (root dir `backend`, build `npm install`, start `npm start`, health check `/health`).
- **Frontend → Vercel:** root dir `frontend`, build `npm run build`, output `dist`; [`frontend/vercel.json`](./frontend/vercel.json) rewrites all routes to `index.html` so the SPA doesn't 404 on refresh.
- **Keep-alive:** [`.github/workflows/keep-alive.yml`](./.github/workflows/keep-alive.yml) pings `/health` every 10 minutes to avoid Render free-tier cold starts.

Step-by-step deployment instructions are in [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Notes on choices, AI usage, and what I'd improve

See the short note at the bottom of [ARCHITECTURE.md](./ARCHITECTURE.md).
