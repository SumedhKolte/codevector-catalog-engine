# Architecture & design rationale

This document explains *why* the system is built the way it is. The core problem
is two-fold: pagination must be **fast at 200k–1M rows** and **correct while the
data is changing**.

---

## 1. Keyset (cursor) pagination, not `OFFSET`

### The problem with `OFFSET`
`... ORDER BY created_at DESC, id DESC OFFSET 200000 LIMIT 20` forces Postgres to
**produce and then throw away 200,000 rows** before it can return 20. That's
`O(offset)` work per page, so deep pages get linearly slower. Worse, `OFFSET` is
**unstable under writes**: if a new product is inserted at the front while a user
is browsing, every subsequent page shifts by one — the user sees a **duplicate**
at the page boundary, or **misses** a row.

### The keyset approach
We page by *value*, not by *position*:

```sql
SELECT id, name, category, price, created_at, updated_at
FROM products
WHERE (created_at, id) < ($cursorCreatedAt, $cursorId)   -- "strictly older than what I last saw"
ORDER BY created_at DESC, id DESC
LIMIT $n;
```

- The cursor encodes the `(created_at, id)` of the **last row of the previous page**.
- A **row-value comparison** `(created_at, id) < (a, b)` is exactly the right
  predicate for `(created_at DESC, id DESC)` ordering: it returns rows that come
  strictly *after* the cursor in the sort.
- `id` is a tiebreaker so rows that share a `created_at` still have a total,
  stable order (the task explicitly allows many rows to share column values).

### Why it's correct while data changes
New or updated rows get a newer `created_at` (the `updated_at` trigger and
`DEFAULT NOW()` guarantee this). Newer rows therefore live at the **front** of
the feed — *above* any cursor a user already holds. They can never appear after
the cursor, so paging past them is impossible: **no duplicates, no skips**, even
if 50 rows are inserted mid-browse.

### Why it's fast
The comparison maps onto a single B-Tree index seek (see §2). Every page —
page 1 or page 50,000 — costs `O(log n)` to locate the start, then a sequential
read of `n` rows. Page cost is independent of depth. The `/api/benchmark`
endpoint demonstrates this empirically.

---

## 2. Indexing strategy (B-Tree)

```sql
CREATE INDEX idx_products_pagination
  ON products (created_at DESC, id DESC);

CREATE INDEX idx_products_category_pagination
  ON products (category, created_at DESC, id DESC);
```

- **`idx_products_pagination`** matches the unfiltered feed's `ORDER BY` exactly.
  Because the index is already in `(created_at DESC, id DESC)` order, Postgres
  satisfies both the `WHERE (created_at, id) < (...)` seek **and** the ordering
  from the index — no sort node, no heap scan to order.
- **`idx_products_category_pagination`** puts `category` as the **leading
  column** so a filtered feed (`WHERE category = $1`) seeks to that category's
  slice and then walks it in `(created_at DESC, id DESC)` order. Without category
  leading, Postgres couldn't combine the equality filter with the ordered range
  scan efficiently.
- B-Tree (not hash/GIN) because we need **range** (`<`) and **ordered** access,
  which is precisely what a B-Tree provides. `EXPLAIN ANALYZE` on the products
  query shows an `Index Scan` (or `Index Only Scan`), never a `Seq Scan`.

---

## 3. The timestamp-precision subtlety (a real bug this code avoids)

PostgreSQL `TIMESTAMPTZ` stores **microseconds**; a JavaScript `Date` only holds
**milliseconds**. `node-postgres` parses `timestamptz` into a `Date` by default,
which **silently truncates** the microseconds.

If we built a cursor from that truncated value, the row-value comparison could
exclude a not-yet-seen row that shares the same millisecond but has a larger
microsecond fraction — i.e. **skip a product**. To prevent this, `db.js`
registers a type parser that hands back the **raw full-precision timestamp
string**, and the cursor carries that exact string straight back into
`$1::timestamptz`. The comparison is therefore loss-free.

```js
pg.types.setTypeParser(1184, (v) => v); // timestamptz -> raw string, not Date
```

---

## 4. Why Fastify

- **Throughput & low overhead** — Fastify's radix-tree router and schema-based
  serialization are among the fastest in the Node ecosystem; for a read-heavy
  list API that matters.
- **First-class structured logging** — Pino is built in, so every request and
  query is emitted as structured JSON with near-zero cost. Pretty-printed in dev,
  raw JSON in production (drop straight into a log aggregator).
- **Plugin ecosystem** — `@fastify/rate-limit` and `@fastify/cors` are official,
  so cross-cutting concerns are a couple of `register()` calls.
- **Testability** — the app is built by a factory (`buildApp`) with no port
  binding, so tests run it in-process with Supertest.

---

## 5. Bulk seeding (no slow loops)

`scripts/seed.js` inserts in batches of `SEED_BATCH_SIZE` (default 10,000) using
a single statement per batch:

```sql
INSERT INTO products (name, category, price, created_at, updated_at)
SELECT n, c, p, t, t
FROM unnest($1::text[], $2::text[], $3::numeric[], $4::timestamptz[]) AS u(n, c, p, t);
```

- **One round trip and one parse per 10,000 rows** instead of 200,000 individual
  `INSERT`s. Round-trip latency, not raw insert cost, dominates naïve seeders;
  batching collapses it. On a typical free-tier Supabase instance this seeds
  200k rows in seconds rather than many minutes.
- `created_at` is spread across the last ~2 years so "newest first" is meaningful
  and pages contain realistic timestamp spreads.
- Could be pushed further with `COPY`, but `UNNEST` keeps the script readable and
  is more than fast enough at this scale.

---

## 6. Other decisions

- **`id` as `BIGINT` returned as a string** in JSON to stay safe above
  `Number.MAX_SAFE_INTEGER`.
- **Rate limiting** (100 req/min) protects every route except `/health`, which
  the keep-alive workflow pings frequently.
- **Graceful shutdown** closes in-flight requests and the pg pool on
  `SIGINT`/`SIGTERM` so deploys don't drop connections.
- **`hasNextPage` without `COUNT`** — we fetch `limit + 1` rows and check for the
  extra one, avoiding an expensive `COUNT(*)` on every request.

---

## Short note (choices · improvements · AI usage)

**What I chose and why.** Keyset pagination over `OFFSET` is the whole point of
the task — it's the only approach that is *both* O(log n) fast at depth *and*
stable while rows are inserted. Postgres because composite B-Tree indexes +
row-value comparison express keyset pagination cleanly. Fastify for throughput
and built-in Pino logging.

**What I'd improve with more time.**
- Add JSON schema validation on query params for automatic 400s + faster serialization.
- Cache the `/api/categories` result (it changes rarely).
- Use `COPY` in the seeder for 1M+ rows.
- Add a "live region" in the UI that surfaces newly inserted rows at the top
  (a "N new products — refresh" pill), like Twitter/Reddit feeds.
- Connection pooling via PgBouncer / Supabase pooler for high concurrency, and
  `EXPLAIN ANALYZE` snapshots committed as evidence.

**How I used AI.** AI helped scaffold boilerplate (Fastify plugin wiring, the
React/Tailwind components, config files) and draft these docs quickly. The part
that needed real attention — and where AI's first instinct was wrong — was the
**timestamp precision** issue (§3): a naïve cursor built from a JS `Date` loses
microseconds and can skip rows. I caught that and fixed it with a `pg` type
parser that preserves the full-precision timestamp string. I also kept the data
volume configurable and defaulted it to the actual requested 200k rather than
over-committing to 1M for every local run.
