# EXPLAIN ANALYZE evidence

> Placeholder. Generate the real query plans by running, from `backend/`:
>
> ```bash
> npm run explain
> ```
>
> This overwrites the file with live `EXPLAIN (ANALYZE, BUFFERS)` output for the
> exact queries the API runs (first page, forward cursor, backward cursor,
> category filter, and the OFFSET anti-pattern), proving the keyset queries use
> an **Index Scan** and the OFFSET query does not scale.

What to look for once generated:

- Queries 1–4 (keyset): `Index Scan using idx_products_pagination` (or
  `... Backward`, or `idx_products_category_pagination`) and **no `Seq Scan`**,
  **no `Sort`** node — the index already provides the order.
- Query 5 (OFFSET): much higher actual time and rows removed/skipped — it does
  the work we deliberately avoid.

See [ARCHITECTURE.md](../ARCHITECTURE.md) §2 for the indexing rationale and
[BENCHMARKS.md](../BENCHMARKS.md) for timing.
