# Benchmarks — OFFSET vs Keyset pagination

This document explains how the benchmark works, how to read the dashboard chart,
and where to record your own numbers. The benchmark backs the central claim of
the project: **keyset (cursor) pagination is fast at any depth; OFFSET is not.**

---

## What is measured

For a given **depth** (how many rows deep into the feed), both strategies return
the **same 20 rows**:

| Strategy | Query (simplified) | Cost |
|----------|--------------------|------|
| OFFSET   | `... ORDER BY created_at DESC, id DESC OFFSET <depth> LIMIT 20` | **O(n)** — Postgres produces and discards `depth` rows first |
| Keyset   | `... WHERE (created_at, id) < (<cursor>) ORDER BY created_at DESC, id DESC LIMIT 20` | **O(log n)** — single index seek, then read 20 rows |

The API reports **two timings** per run:

- **`dbExec`** — Postgres' own execution time, taken from `EXPLAIN (ANALYZE,
  FORMAT JSON)`. This excludes the network and is the honest measure of the
  algorithm.
- **`wallClock`** — time measured in Node around the query. This includes the
  round-trip to the database, so against a remote DB (e.g. Supabase) it is
  dominated by network latency (typically 5–15 ms regardless of query).

> **Why both?** A keyset query executes in ~0.05 ms inside Postgres but a remote
> client still sees ~8–10 ms because of the network. That 8–10 ms is the network
> floor, not slow SQL. `dbExec` isolates the query so the chart shows the real
> algorithmic difference.

---

## Endpoints

```bash
# Single depth (returns dbExec + wallClock + speedup)
GET /api/benchmark?depth=200000

# Sweep across multiple depths (for the chart)
GET /api/benchmark/sweep?depths=1000,10000,100000,1000000
```

Max supported depth: **10,000,000**.

---

## How to read the dashboard chart

In the UI → **Benchmark** tab → **Run full sweep**:

- **Red line (OFFSET)** climbs as depth increases — each extra row of depth is
  extra work the database must do and throw away.
- **Green line (Keyset)** stays flat near zero — its cost does not depend on
  depth, because it seeks straight to the cursor via the B-Tree index.

The growing gap between the two lines *is* the reason this project uses keyset
pagination.

---

## Expected shape of results

Exact numbers depend on hardware, cache state, and DB location. The **shape** is
what matters: OFFSET grows roughly linearly with depth; keyset stays constant.

```
dbExec (Postgres execution time, ms)

OFFSET  ┤                                          ●  ← grows with depth
        ┤                                  ●
        ┤                        ●
        ┤            ●
KEYSET  ┤●─────●─────●───────────●──────────────────●  ← flat, ~0.05 ms
        └┬─────┬─────┬───────────┬──────────────────┬─
         1k   10k   100k        1M                 10M
```

---

## Record your run here

Fill this in after running the sweep against your seeded database:

| Depth      | OFFSET dbExec (ms) | Keyset dbExec (ms) | Speedup |
|------------|--------------------|--------------------|---------|
| 1,000      |                    |                    |         |
| 10,000     |                    |                    |         |
| 100,000    |                    |                    |         |
| 1,000,000  |                    |                    |         |
| 10,000,000 |                    |                    |         |

Wall-clock (network-inclusive) for the live feed, single page:

| Metric              | Value (ms) |
|---------------------|------------|
| Keyset dbExec       |            |
| Keyset wallClock    |            |
| Network overhead    | wallClock − dbExec |

---

## Verifying the index is actually used

The speed comes from the composite B-Tree indexes. Confirm Postgres uses an
index seek (not a sequential scan):

```sql
EXPLAIN ANALYZE
SELECT id, name, category, price, created_at, updated_at
FROM products
WHERE (created_at, id) < ('2025-01-01 00:00:00+00', 999999999)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Look for `Index Scan using idx_products_pagination` (or `Index Only Scan`) and
**not** `Seq Scan`. See [ARCHITECTURE.md](./ARCHITECTURE.md) §2 for the indexing
rationale.
